import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ZkpService } from './zkp.service';
import {
  GenerateProofDto,
  VerifyProofDto,
  RevokeProofDto,
  ProofResponseDto,
  VerifyProofResponseDto,
} from './dto/zkp.dto';
import { CredentialType, ProofStatus } from './entities/zkp-proof.entity';

@ApiTags('zkp')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller({ version: '1' })
export class ZkpController {
  constructor(private readonly zkpService: ZkpService) {}

  @Post('zkp/proofs/generate')
  @ApiOperation({
    summary: 'Generate a zero-knowledge proof for a credential',
    description:
      'Creates a zk-SNARK proof attesting that a credential satisfies circuit constraints (e.g. credit score >= threshold) without revealing the raw credential value.',
  })
  async generateProof(
    @Request() req: { user: { id: string } },
    @Body() dto: GenerateProofDto,
  ): Promise<ProofResponseDto> {
    const proof = await this.zkpService.generateProof({
      ownerId: req.user.id,
      credentialType: dto.credentialType,
      credentialValue: dto.credentialValue,
      publicInputs: dto.publicInputs,
      standard: dto.standard,
    });

    return this.toProofResponseDto(proof);
  }

  @Post('zkp/proofs/:id/verify')
  @ApiOperation({
    summary: 'Verify a zero-knowledge proof',
    description:
      'Cryptographically verifies a proof without revealing the underlying credential. Returns valid=true if the proof satisfies the circuit constraints.',
  })
  async verifyProof(
    @Param('id') id: string,
    @Body() dto: VerifyProofDto,
  ): Promise<VerifyProofResponseDto> {
    if (dto.proofId && dto.proofId !== id) {
      throw new NotFoundException('Proof ID in path does not match body');
    }

    const result = await this.zkpService.verifyProof(id, dto.publicInputs);
    return result;
  }

  @Post('zkp/proofs/:id/revoke')
  @ApiOperation({
    summary: 'Revoke a zero-knowledge proof',
    description:
      'Revokes a proof when the underlying credential changes. The proof status becomes "revoked" and further verification will return valid=false.',
  })
  async revokeProof(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() dto: RevokeProofDto,
  ): Promise<ProofResponseDto> {
    const proof = await this.zkpService.revokeProof(
      id,
      req.user.id,
      dto.reason,
    );
    return this.toProofResponseDto(proof);
  }

  @Get('zkp/proofs')
  @ApiOperation({
    summary: 'List zero-knowledge proofs',
    description:
      'Returns proofs for the current user, optionally filtered by credential type and status.',
  })
  @ApiQuery({ name: 'credentialType', required: false, enum: CredentialType })
  @ApiQuery({ name: 'status', required: false, enum: ProofStatus })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listProofs(
    @Request() req: { user: { id: string } },
    @Query('credentialType') credentialType?: CredentialType,
    @Query('status') status?: ProofStatus,
    @Query('limit') limit?: number,
  ): Promise<ProofResponseDto[]> {
    const proofs = await this.zkpService.findProofs({
      ownerId: req.user.id,
      credentialType,
      status,
      limit: limit ? Math.min(limit, 100) : undefined,
    });

    return proofs.map((p) => this.toProofResponseDto(p));
  }

  @Get('zkp/proofs/:id')
  @ApiOperation({ summary: 'Get a single ZKP proof by ID' })
  async getProof(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ): Promise<ProofResponseDto> {
    const proof = await this.zkpService.findOne(id);
    if (proof.ownerId !== req.user.id) {
      throw new NotFoundException('Proof not found');
    }
    return this.toProofResponseDto(proof);
  }

  @Post('zkp/proofs/:id/anchor')
  @ApiOperation({
    summary: 'Anchor proof commitment on the Stellar network',
    description:
      'Submits a memo transaction on Stellar to create an immutable, public timestamp of the proof commitment hash. Optional — proofs are valid without anchoring.',
  })
  async anchorProof(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ): Promise<{ proofId: string; stellarTxId: string | null }> {
    const proof = await this.zkpService.findOne(id);
    if (proof.ownerId !== req.user.id) {
      throw new NotFoundException('Proof not found');
    }
    const stellarTxId = await this.zkpService.anchorProofOnChain(id);
    return { proofId: id, stellarTxId };
  }

  private toProofResponseDto(proof: any): ProofResponseDto {
    return {
      id: proof.id,
      ownerId: proof.ownerId,
      credentialType: proof.credentialType,
      circuitId: proof.circuitId,
      standard: proof.standard,
      status: proof.status,
      publicInputs: proof.publicInputs,
      credentialCommitment: proof.credentialCommitment,
      stellarTxId: proof.stellarTxId,
      expiresAt: proof.expiresAt,
      generationTimeMs: proof.generationTimeMs,
      createdAt: proof.createdAt,
      updatedAt: proof.updatedAt,
    };
  }
}
