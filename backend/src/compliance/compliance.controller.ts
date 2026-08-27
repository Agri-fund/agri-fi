/**
 * ComplianceController — Issue #872
 * GET /v1/admin/compliance-reports
 *
 * Lists available compliance reports with signed S3 download URLs.
 * Access is restricted to compliance_officer / admin roles.
 * All access is logged to system_audit_logs via AuditInterceptor.
 */

import {
  Controller, Get, Post, Param, Query, Request,
  UseGuards, UseInterceptors, Body,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { ComplianceReportService } from './compliance-report.service';
import { ComplianceReport } from './entities/compliance-report.entity';

@ApiTags('compliance')
@ApiBearerAuth('jwt')
@Controller({ version: '1', path: 'admin/compliance-reports' })
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin', 'company_admin')
@UseInterceptors(AuditInterceptor)
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceReportService) {}

  /**
   * GET /v1/admin/compliance-reports
   * Returns all reports (optionally filtered by type) with 15-min signed URLs.
   */
  @Get()
  @ApiOperation({ summary: 'List compliance reports with signed download URLs (admin/compliance_officer)' })
  @ApiQuery({ name: 'type', required: false, enum: ['monthly_aml_kyc', 'quarterly_transaction', 'incident'] })
  @ApiResponse({ status: 200, description: 'List of compliance reports' })
  async listReports(@Query('type') type?: string) {
    return this.complianceService.listReports(type as any);
  }

  /**
   * POST /v1/admin/compliance-reports/generate/monthly
   * Manually trigger a monthly report for a given period.
   */
  @Post('generate/monthly')
  @ApiOperation({ summary: 'Manually generate a monthly AML/KYC report' })
  @ApiResponse({ status: 201, description: 'Report generated' })
  async generateMonthly(
    @Body() body: { start: string; end: string },
  ): Promise<ComplianceReport> {
    return this.complianceService.generateMonthly(
      new Date(body.start),
      new Date(body.end),
    );
  }

  /**
   * POST /v1/admin/compliance-reports/generate/quarterly
   */
  @Post('generate/quarterly')
  @ApiOperation({ summary: 'Manually generate a quarterly transaction report' })
  @ApiResponse({ status: 201, description: 'Report generated' })
  async generateQuarterly(
    @Body() body: { start: string; end: string },
  ): Promise<ComplianceReport> {
    return this.complianceService.generateQuarterly(
      new Date(body.start),
      new Date(body.end),
    );
  }

  /**
   * POST /v1/admin/compliance-reports/generate/incident
   */
  @Post('generate/incident')
  @ApiOperation({ summary: 'Manually generate an incident report' })
  @ApiResponse({ status: 201, description: 'Report generated' })
  async generateIncident(
    @Body() body: { start: string; end: string },
  ): Promise<ComplianceReport> {
    return this.complianceService.generateIncident(
      new Date(body.start),
      new Date(body.end),
    );
  }
}
