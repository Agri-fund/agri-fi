import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Request,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { IsString, IsBoolean, IsIn, IsOptional, MinLength, IsUrl } from 'class-validator';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AccreditationService } from './accreditation.service';
import { AnnualCapService } from './annual-cap.service';

class SelfCertificationRequestDto {
  @IsString()
  @MinLength(20, { message: 'Declaration must be at least 20 characters.' })
  declaration: string;

  @IsOptional()
  @IsUrl()
  documentUrl?: string;

  @IsIn(['accredited', 'institutional'])
  targetTier: 'accredited' | 'institutional';
}

class ReviewApplicationDto {
  @IsBoolean()
  approved: boolean;

  @IsOptional()
  @IsString()
  rejectionReason?: string;
}

@ApiTags('accreditation')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('accreditation')
export class AccreditationController {
  constructor(
    private readonly accreditationService: AccreditationService,
    private readonly annualCapService: AnnualCapService,
  ) {}

  /**
   * POST /accreditation/apply
   * Investor submits a self-certification for accredited or institutional tier.
   */
  @Post('apply')
  @ApiOperation({ summary: 'Submit accreditation self-certification (investor)' })
  @ApiResponse({ status: 201, description: 'Application submitted successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid declaration or duplicate application.' })
  @ApiResponse({ status: 403, description: 'Only investors may apply.' })
  async apply(
    @Request() req: { user: { id: string } },
    @Body() dto: SelfCertificationRequestDto,
  ) {
    const user = await this.accreditationService.submitSelfCertification(
      req.user.id,
      dto,
    );
    return {
      message:
        dto.targetTier === 'accredited'
          ? 'Accredited status approved.'
          : 'Institutional accreditation application submitted for admin review.',
      accreditationTier: user.accreditationTier,
      accreditationStatus: user.accreditationStatus,
      accreditationExpiresAt: user.accreditationExpiresAt,
    };
  }

  /**
   * GET /accreditation/status
   * Returns the current user's accreditation status.
   */
  @Get('status')
  @ApiOperation({ summary: 'Get my accreditation status' })
  @ApiResponse({ status: 200, description: 'Accreditation status returned.' })
  async getMyStatus(@Request() req: { user: { id: string } }) {
    const user = await this.accreditationService.getAccreditationStatus(
      req.user.id,
    );
    return {
      accreditationTier: user.accreditationTier,
      accreditationStatus: user.accreditationStatus,
      accreditationSubmittedAt: user.accreditationSubmittedAt,
      accreditationApprovedAt: user.accreditationApprovedAt,
      accreditationExpiresAt: user.accreditationExpiresAt,
      accreditationRejectionReason: user.accreditationRejectionReason,
    };
  }

  /**
   * GET /accreditation/annual-total
   * Returns the current investor's annual investment total for the current year.
   */
  @Get('annual-total')
  @ApiOperation({ summary: 'Get annual investment total for the current year' })
  @ApiResponse({ status: 200, description: 'Annual total returned.' })
  async getAnnualTotal(@Request() req: { user: { id: string } }) {
    const totalUsd = await this.annualCapService.getAnnualTotal(req.user.id);
    return { year: new Date().getFullYear(), totalUsd };
  }

  // ─── Admin endpoints ───────────────────────────────────────────────────────

  /**
   * GET /accreditation/admin/queue
   * Returns all pending accreditation applications for admin review.
   */
  @Get('admin/queue')
  @Roles('admin')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Get pending accreditation applications (admin)' })
  @ApiResponse({ status: 200, description: 'Queue returned.' })
  async getQueue() {
    const users = await this.accreditationService.getPendingApplications();
    return users.map((u) => ({
      userId: u.id,
      email: u.email,
      accreditationTier: u.accreditationTier,
      accreditationStatus: u.accreditationStatus,
      accreditationSubmittedAt: u.accreditationSubmittedAt,
      accreditationDeclaration: u.accreditationDeclaration,
      accreditationDocumentUrl: u.accreditationDocumentUrl,
    }));
  }

  /**
   * POST /accreditation/admin/review/:userId
   * Admin approves or rejects an institutional accreditation application.
   */
  @Post('admin/review/:userId')
  @Roles('admin')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Approve or reject an accreditation application (admin)' })
  @ApiResponse({ status: 200, description: 'Application reviewed.' })
  @ApiResponse({ status: 400, description: 'No pending application found.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async reviewApplication(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ReviewApplicationDto,
  ) {
    const user = await this.accreditationService.reviewApplication(userId, dto);
    return {
      userId: user.id,
      accreditationTier: user.accreditationTier,
      accreditationStatus: user.accreditationStatus,
      accreditationApprovedAt: user.accreditationApprovedAt,
      accreditationExpiresAt: user.accreditationExpiresAt,
      accreditationRejectionReason: user.accreditationRejectionReason,
    };
  }
}
