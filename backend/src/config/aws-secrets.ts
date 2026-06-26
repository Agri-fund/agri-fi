import {
  SecretsManagerClient,
  GetSecretValueCommand,
  DescribeSecretCommand,
} from '@aws-sdk/client-secrets-manager';

export interface DbCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

const client = new SecretsManagerClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
});

/**
 * Fetch a secret from AWS Secrets Manager.
 *
 * During a rotation event AWS sets a AWSPENDING version on the secret.
 * By default we fetch AWSCURRENT (the live value). Pass 'AWSPENDING' to
 * retrieve the pending value inside a rotation Lambda.
 */
export async function getSecret(
  secretId: string,
  versionStage: 'AWSCURRENT' | 'AWSPENDING' = 'AWSCURRENT',
): Promise<string> {
  const command = new GetSecretValueCommand({
    SecretId: secretId,
    VersionStage: versionStage,
  });

  const result = await client.send(command);

  if (result.SecretString) {
    return result.SecretString;
  }

  if (result.SecretBinary) {
    return Buffer.from(result.SecretBinary).toString('utf8');
  }

  throw new Error(`Secret "${secretId}" has no value.`);
}

/**
 * Fetch and parse database credentials from AWS Secrets Manager.
 *
 * The secret is expected to be a JSON object with the shape of DbCredentials.
 * This is called by the TypeORM config factory so that credentials are always
 * loaded from the current rotation value at startup, and can be refreshed
 * without redeploying the service.
 */
export async function getDbCredentials(
  secretId = process.env.DB_SECRET_ID ?? 'agri-fi/db-credentials',
): Promise<DbCredentials> {
  const raw = await getSecret(secretId);
  const parsed = JSON.parse(raw) as DbCredentials;
  return parsed;
}

/**
 * Check whether a secret currently has an active rotation configured.
 * Useful for health checks or CI validation.
 */
export async function isRotationEnabled(secretId: string): Promise<boolean> {
  const command = new DescribeSecretCommand({ SecretId: secretId });
  const result = await client.send(command);
  return result.RotationEnabled ?? false;
}

/**
 * Rotation Lambda handler entry point.
 *
 * AWS Secrets Manager calls this function with four lifecycle steps.
 * Wire it up in the rotation Lambda configuration pointing to this export.
 *
 * Required environment variables for the Lambda:
 *   DB_SECRET_ID        — ARN or name of the secret being rotated
 *   DB_HOST             — Database host (for connection testing)
 *
 * @see https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html
 */
export async function rotationHandler(event: {
  Step: 'createSecret' | 'setSecret' | 'testSecret' | 'finishSecret';
  SecretId: string;
  ClientRequestToken: string;
}): Promise<void> {
  const { Step, SecretId, ClientRequestToken } = event;

  switch (Step) {
    case 'createSecret': {
      // Generate a new random password and store it as AWSPENDING.
      const newPassword = generateSecurePassword();
      const currentSecret = await getDbCredentials(SecretId);
      const pending: DbCredentials = { ...currentSecret, password: newPassword };

      const { PutSecretValueCommand } = await import(
        '@aws-sdk/client-secrets-manager'
      );
      await client.send(
        new PutSecretValueCommand({
          SecretId,
          ClientRequestToken,
          SecretString: JSON.stringify(pending),
          VersionStages: ['AWSPENDING'],
        }),
      );
      break;
    }

    case 'setSecret': {
      // Apply the AWSPENDING credentials to the database.
      const pending = JSON.parse(
        await getSecret(SecretId, 'AWSPENDING'),
      ) as DbCredentials;
      console.log(
        `[rotation] setSecret: applying new password for user "${pending.username}" on ${pending.host}`,
      );
      // Database-specific ALTER USER / UPDATE credentials call goes here.
      break;
    }

    case 'testSecret': {
      // Verify the AWSPENDING credentials can open a connection.
      const pending = JSON.parse(
        await getSecret(SecretId, 'AWSPENDING'),
      ) as DbCredentials;
      console.log(
        `[rotation] testSecret: verifying connection for "${pending.username}"`,
      );
      // Connection test goes here; throw on failure so rotation aborts.
      break;
    }

    case 'finishSecret': {
      // Promote AWSPENDING to AWSCURRENT.
      const { UpdateSecretVersionStageCommand } = await import(
        '@aws-sdk/client-secrets-manager'
      );
      const current = await client.send(
        new DescribeSecretCommand({ SecretId }),
      );
      const currentVersionId = Object.entries(
        current.VersionIdsToStages ?? {},
      ).find(([, stages]) => stages.includes('AWSCURRENT'))?.[0];

      await client.send(
        new UpdateSecretVersionStageCommand({
          SecretId,
          VersionStage: 'AWSCURRENT',
          MoveToVersionId: ClientRequestToken,
          RemoveFromVersionId: currentVersionId,
        }),
      );
      console.log('[rotation] finishSecret: rotation complete.');
      break;
    }
  }
}

function generateSecurePassword(length = 32): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  const { randomInt } = require('crypto') as typeof import('crypto');
  return Array.from({ length }, () => chars[randomInt(chars.length)]).join('');
}
