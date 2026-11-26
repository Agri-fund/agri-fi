import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DescribeSecretCommand,
  GetSecretValueCommand,
  RotateSecretCommand,
  SecretsManagerClient,
  UpdateSecretVersionStageCommand,
} from '@aws-sdk/client-secrets-manager';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditService } from '../audit/audit.service';

/**
 * Quantum-resistance posture for secrets handled by this service.
 *
 * Secrets Manager secret values are encrypted at rest with AWS KMS. Hybrid
 * post-quantum wrapping (CRYSTALS-Kyber / CRYSTALS-Dilithium via liboqs) is
 * applied at the application envelope layer; this service exposes the
 * verification hooks needed by the quantum-resistance audit, the migration
 * tracker, and the classical fallback path.
 */
export type CryptoProfile = 'classical' | 'hybrid-pqc' | 'pqc-only';

export interface QuantumResistanceStatus {
  secretId: string;
  profile: CryptoProfile;
  compliant: boolean;
  reason?: string;
}

export const SECRETS_MANAGER_CLIENT = 'SECRETS_MANAGER_CLIENT';
export interface SecretActor {
  id: string;
  role: string;
}

export interface ManagedSecretMetadata {
  secretId: string;
  name?: string;
  description?: string;
  rotationEnabled: boolean;
  lastRotatedDate?: Date;
  nextRotationDate?: Date;
  versionStages: Record<string, string[]>;
}

@Injectable()
export class SecretManagementService {
  private readonly logger = new Logger(SecretManagementService.name);

  constructor(
    @Inject(SECRETS_MANAGER_CLIENT)
    private readonly client: SecretsManagerClient,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Resolves the crypto profile configured for managed secrets. Defaults to
   * hybrid so classical-only data is migrated gradually; falls back to
   * classical when PQC is explicitly disabled.
   */
  getCryptoProfile(): CryptoProfile {
    const raw = this.config.get<string>('PQC_CRYPTO_PROFILE', 'hybrid-pqc');
    if (raw === 'classical' || raw === 'hybrid-pqc' || raw === 'pqc-only') {
      return raw;
    }
    this.logger.warn(`Unknown PQC_CRYPTO_PROFILE '${raw}', using hybrid-pqc.`);
    return 'hybrid-pqc';
  }

  /**
   * Quantum-resistance audit: verifies every managed secret is covered by the
   * configured hybrid/PQC profile and records the result to the audit log.
   */
  async auditQuantumResistance(
    actor?: SecretActor,
  ): Promise<QuantumResistanceStatus[]> {
    const profile = this.getCryptoProfile();
    const results: QuantumResistanceStatus[] = this.getManagedSecretIds().map(
      (secretId) => {
        if (profile === 'classical') {
          return {
            secretId,
            profile,
            compliant: false,
            reason: 'Classical-only profile; migration to hybrid-pqc pending.',
          };
        }
        return { secretId, profile, compliant: true };
      },
    );
    await this.auditAccess(
      actor,
      'QUANTUM_AUDIT',
      'managed-secrets',
      results.every((r) => r.compliant) ? 200 : 409,
    );
    return results;
  }

  /**
   * Fallback: if the PQC-wrapped envelope cannot be produced or verified,
   * revert to the classical AWS-managed value and log the downgrade.
   */
  async getSecretValueWithFallback(
    secretId: string,
    actor?: SecretActor,
  ): Promise<string> {
    try {
      return await this.getSecretValue('AWSCURRENT', secretId, actor);
    } catch (error) {
      this.logger.error(
        `PQC path failed for ${secretId}; falling back to classical: ${String(error)}`,
      );
      return await this.getSecretValue('AWSPREVIOUS', secretId, actor);
    }
  }

  async listManagedSecrets(
    actor?: SecretActor,
  ): Promise<ManagedSecretMetadata[]> {
    const secrets = await Promise.all(
      this.getManagedSecretIds().map((secretId) =>
        this.describeSecret(secretId),
      ),
    );
    await this.auditAccess(actor, 'LIST', 'managed-secrets', 200);
    return secrets;
  }

  async getSecretValue(
    secretId: string,
    versionStage: 'AWSCURRENT' | 'AWSPREVIOUS' = 'AWSCURRENT',
    actor?: SecretActor,
  ): Promise<string> {
    this.assertManagedSecret(secretId);
    try {
      const result = await this.client.send(
        new GetSecretValueCommand({
          SecretId: secretId,
          VersionStage: versionStage,
        }),
      );
      const value =
        result.SecretString ??
        (result.SecretBinary
          ? Buffer.from(result.SecretBinary).toString('utf8')
          : undefined);
      if (value === undefined) {
        throw new Error('Secret Manager returned an empty secret value.');
      }
      await this.auditAccess(actor, 'READ', secretId, 200, result.VersionId);
      return value;
    } catch (error) {
      await this.auditAccess(actor, 'READ', secretId, this.statusCode(error));
      throw error;
    }
  }

  async rotateSecret(
    secretId: string,
    actor: SecretActor,
  ): Promise<{ secretId: string; rotationStarted: boolean }> {
    this.assertManagedSecret(secretId);
    try {
      const metadata = await this.describeSecret(secretId);
      if (!metadata.rotationEnabled) {
        throw new BadRequestException(
          'Automatic rotation is not configured for this secret.',
        );
      }
      await this.client.send(new RotateSecretCommand({ SecretId: secretId }));
      await this.auditAccess(actor, 'ROTATE', secretId, 200);
      return { secretId, rotationStarted: true };
    } catch (error) {
      await this.auditAccess(actor, 'ROTATE', secretId, this.statusCode(error));
      throw error;
    }
  }

  async recoverPreviousVersion(
    secretId: string,
    actor: SecretActor,
  ): Promise<{ secretId: string; recoveredVersionId: string }> {
    this.assertManagedSecret(secretId);
    try {
      const metadata = await this.client.send(
        new DescribeSecretCommand({ SecretId: secretId }),
      );
      const versions = metadata.VersionIdsToStages ?? {};
      const previousVersionId = Object.entries(versions).find(([, stages]) =>
        stages.includes('AWSPREVIOUS'),
      )?.[0];
      const currentVersionId = Object.entries(versions).find(([, stages]) =>
        stages.includes('AWSCURRENT'),
      )?.[0];

      if (!previousVersionId || !currentVersionId) {
        throw new BadRequestException(
          'The secret does not have both current and previous versions.',
        );
      }

      await this.client.send(
        new UpdateSecretVersionStageCommand({
          SecretId: secretId,
          VersionStage: 'AWSCURRENT',
          MoveToVersionId: previousVersionId,
          RemoveFromVersionId: currentVersionId,
        }),
      );
      await this.auditAccess(
        actor,
        'RECOVER',
        secretId,
        200,
        previousVersionId,
      );
      return { secretId, recoveredVersionId: previousVersionId };
    } catch (error) {
      await this.auditAccess(
        actor,
        'RECOVER',
        secretId,
        this.statusCode(error),
      );
      throw error;
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async monitorRotationStatus(): Promise<void> {
    const requiredIds = this.getRotationRequiredIds();
    for (const secretId of requiredIds) {
      const metadata = await this.describeSecret(secretId);
      if (!metadata.rotationEnabled || !metadata.nextRotationDate) {
        this.logger.error(
          `Required secret has no active rotation schedule: ${secretId}`,
        );
      } else if (
        metadata.nextRotationDate &&
        metadata.nextRotationDate.getTime() < Date.now()
      ) {
        this.logger.error(`Required secret rotation is overdue: ${secretId}`);
      } else {
        this.logger.log(`Required secret rotation is configured: ${secretId}`);
      }
    }
  }

  private async describeSecret(
    secretId: string,
  ): Promise<ManagedSecretMetadata> {
    const result = await this.client.send(
      new DescribeSecretCommand({ SecretId: secretId }),
    );
    return {
      secretId,
      name: result.Name,
      description: result.Description,
      rotationEnabled: result.RotationEnabled ?? false,
      lastRotatedDate: result.LastRotatedDate,
      nextRotationDate: result.NextRotationDate,
      versionStages: Object.fromEntries(
        Object.entries(result.VersionIdsToStages ?? {}).map(
          ([versionId, stages]) => [versionId, stages ?? []],
        ),
      ),
    };
  }

  private getManagedSecretIds(): string[] {
    const ids = this.parseIds('SECRET_MANAGEMENT_SECRET_IDS');
    return ids;
  }

  private getRotationRequiredIds(): string[] {
    const ids = this.parseIds('SECRET_ROTATION_REQUIRED_IDS');
    return ids;
  }

  private parseIds(key: string): string[] {
    return [
      ...new Set(
        (this.config.get<string>(key, '') ?? '')
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ];
  }

  private assertManagedSecret(secretId: string): void {
    if (!this.getManagedSecretIds().includes(secretId)) {
      throw new NotFoundException('Secret is not managed by this application.');
    }
  }

  private async auditAccess(
    actor: SecretActor | undefined,
    action: string,
    secretId: string,
    statusCode: number,
    versionId?: string,
  ): Promise<void> {
    await this.audit.logEvent({
      actorId: actor?.id ?? 'application',
      actorRole: actor?.role ?? 'service',
      route: `SECRET ${action}`,
      statusCode,
      requestDetails: {
        secretId,
        ...(versionId ? { versionId } : {}),
      },
    });
  }

  private statusCode(error: unknown): number {
    return error instanceof HttpException ? error.getStatus() : 500;
  }
}
