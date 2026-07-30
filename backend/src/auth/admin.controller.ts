import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Request,
  Body,
  Query,
  NotFoundException,
  BadRequestException,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { User } from './entities/user.entity';
import { ApiBody } from '@nestjs/swagger';
import { IsIn, IsString, IsBoolean, IsUUID, MinLength } from 'class-validator';
import { Roles } from './decorators/roles.decorator';
import { RolesGuard } from './roles.guard';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Document } from '../trade-deals/entities/document.entity';
import { StellarService } from '../stellar/stellar.service';
import { AdminAction } from '../database/entities/admin-action.entity';
import { FailedPaymentsService } from '../escrow/failed-payments.service';

class UpdateUserRoleDto {
  @IsIn(['farmer', 'trader', 'investor', 'company_admin', 'admin'])
  role: 'farmer' | 'trader' | 'investor' | 'company_admin' | 'admin';

  @IsString()
  reason: string;
}

class FreezeAssetDto {
  @IsUUID()
  tradeDealId: string;

  @IsString()
  trustorWallet: string;

  @IsBoolean()
  freeze: boolean;
}

class RejectDocumentDto {
  @IsString()
  @MinLength(3)
  reason: string;
}

interface AuthRequest extends Request {
  user: User;
}

@ApiTags('admin')
@Controller('admin')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
@ApiBearerAuth('jwt')
export class AdminController {
  constructor(
    private readonly authService: AuthService,
    private readonly stellarService: StellarService,
    private readonly failedPaymentsService: FailedPaymentsService,
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    @InjectRepository(Document)
    private readonly documentRepo: Repository<Document>,
    @InjectRepository(AdminAction)
    private readonly adminActionRepo: Repository<AdminAction>,
  ) {}

  @Get('documents')
  @ApiOperation({ summary: 'List uploaded documents for admin verification' })
  @ApiResponse({ status: 200, description: 'List of documents' })
  async listDocuments(
    @Query('status') status?: 'pending' | 'approved' | 'rejected',
  ) {
    return this.documentRepo.find({
      where: status ? { verificationStatus: status } : {},
      relations: ['tradeDeal', 'uploader'],
      // Explicitly whitelist relation columns — `uploader` is a full User
      // entity and must never expose passwordHash or other PII by default.
      select: {
        id: true,
        tradeDealId: true,
        uploaderId: true,
        docType: true,
        ipfsHash: true,
        storageUrl: true,
        stellarTxId: true,
        signatureVerified: true,
        verificationStatus: true,
        rejectionReason: true,
        reviewedBy: true,
        reviewedAt: true,
        createdAt: true,
        tradeDeal: { id: true, commodity: true },
        uploader: { id: true, email: true, role: true },
      },
      order: { createdAt: 'DESC' },
    });
  }

  @Post('documents/:id/verify')
  @ApiOperation({ summary: 'Approve an uploaded document' })
  @ApiResponse({ status: 200, description: 'Document approved' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async verifyDocument(@Request() req: AuthRequest, @Param('id') id: string) {
    const document = await this.documentRepo.findOne({ where: { id } });
    if (!document) throw new NotFoundException('Document not found');

    document.verificationStatus = 'approved';
    document.rejectionReason = null;
    document.reviewedBy = req.user.id;
    document.reviewedAt = new Date();
    await this.documentRepo.save(document);

    await this.adminActionRepo.save(
      this.adminActionRepo.create({
        adminId: req.user.id,
        targetUserId: document.uploaderId,
        action: 'verify_document',
        payload: { documentId: document.id },
        reason: null,
      }),
    );

    return document;
  }

  @Post('documents/:id/reject')
  @ApiOperation({ summary: 'Reject an uploaded document with a reason' })
  @ApiBody({ type: RejectDocumentDto })
  @ApiResponse({ status: 200, description: 'Document rejected' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async rejectDocument(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: RejectDocumentDto,
  ) {
    const document = await this.documentRepo.findOne({ where: { id } });
    if (!document) throw new NotFoundException('Document not found');

    document.verificationStatus = 'rejected';
    document.rejectionReason = dto.reason;
    document.reviewedBy = req.user.id;
    document.reviewedAt = new Date();
    await this.documentRepo.save(document);

    await this.adminActionRepo.save(
      this.adminActionRepo.create({
        adminId: req.user.id,
        targetUserId: document.uploaderId,
        action: 'reject_document',
        payload: { documentId: document.id },
        reason: dto.reason,
      }),
    );

    return document;
  }

  @Get('users')
  @ApiOperation({ summary: 'List all users (admin only)' })
  @ApiResponse({ status: 200, description: 'List of users' })
  async listUsers(@Query('page') page = '1', @Query('limit') limit = '100') {
    return this.authService.listUsers(parseInt(page), parseInt(limit));
  }

  @Post('kyc/:userId/approve')
  @ApiOperation({ summary: 'Approve a user KYC submission' })
  @ApiResponse({ status: 200, description: 'KYC approved' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  @ApiResponse({ status: 404, description: 'User or submission not found' })
  async approveKyc(
    @Request() req: AuthRequest,
    @Param('userId') userId: string,
    @Query('reason') reason?: string,
  ) {
    return this.authService.approveKyc(userId, req.user.id, reason);
  }

  @Post('kyc/:id/approve-corporate')
  @ApiOperation({ summary: 'Approve a corporate KYC submission by id' })
  @ApiResponse({ status: 200, description: 'Corporate KYC approved' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  @ApiResponse({ status: 404, description: 'Submission not found' })
  async approveCorporateKyc(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Query('reason') reason?: string,
  ) {
    return this.authService.approveCorporateKycSubmission(
      id,
      req.user.id,
      reason,
    );
  }

  @Post('users/:userId/role')
  @ApiOperation({ summary: 'Update a user role and invalidate old tokens' })
  @ApiBody({ type: UpdateUserRoleDto })
  async updateUserRole(
    @Request() req: AuthRequest,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserRoleDto,
  ) {
    return this.authService.updateUserRole(
      userId,
      dto.role,
      req.user.id,
      dto.reason,
    );
  }

  @Post('freeze-asset')
  @ApiOperation({
    summary:
      'Freeze or unfreeze an investor trustline for a trade asset (AML compliance)',
  })
  @ApiBody({ type: FreezeAssetDto })
  @ApiResponse({
    status: 201,
    description: 'Trustline freeze/unfreeze submitted',
    schema: { properties: { txId: { type: 'string' } } },
  })
  @ApiResponse({
    status: 400,
    description: 'Issuer keys not available for this deal',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  @ApiResponse({ status: 404, description: 'Trade deal not found' })
  async freezeAsset(@Body() dto: FreezeAssetDto) {
    const deal = await this.tradeDealRepo.findOne({
      where: { id: dto.tradeDealId },
    });
    if (!deal) {
      throw new NotFoundException(`Trade deal ${dto.tradeDealId} not found`);
    }
    if (!deal.issuerPublicKey || !deal.issuerSecretKey) {
      throw new BadRequestException(
        `Issuer keys not available for deal ${dto.tradeDealId}`,
      );
    }

    const issuerSecret = this.stellarService.decryptSecret(
      deal.issuerSecretKey,
    );
    const txId = await this.stellarService.freezeAsset(
      issuerSecret,
      deal.tokenSymbol,
      deal.issuerPublicKey,
      dto.trustorWallet,
      dto.freeze,
    );

    return { txId };
  }

  // ── Failed Payment Alerts ─────────────────────────────────────────────────

  /**
   * GET /admin/payments/failed
   *
   * Returns a paginated list of escrow transactions that have status='failed',
   * ordered by creation date descending. Each entry includes the deal commodity
   * and error code so admins can quickly triage issues.
   */
  @Get('payments/failed')
  @ApiOperation({
    summary: 'List failed escrow payment transactions for admin review',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default 20, max 100)',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of failed payments',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  async getFailedPayments(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.failedPaymentsService.getFailedPayments(page, limit);
  }

  /**
   * POST /admin/payments/failed/:id/retry
   *
   * Manually re-enqueues the `deal.delivered` event for the deal associated
   * with the failed transaction, allowing the escrow release to be retried.
   *
   * Acceptance criterion: "Admins can trigger manual retries directly from the UI."
   */
  @Post('payments/failed/:id/retry')
  @ApiOperation({
    summary: 'Trigger a manual retry for a failed escrow payment',
  })
  @ApiResponse({
    status: 201,
    description: 'Retry event enqueued',
    schema: {
      properties: { queued: { type: 'boolean' }, dealId: { type: 'string' } },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Transaction not in failed state or has no deal',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  @ApiResponse({ status: 404, description: 'Transaction log not found' })
  async retryFailedPayment(@Param('id') id: string) {
    return this.failedPaymentsService.retryFailedPayment(id);
  }
}
