import { Controller, ForbiddenException, Get, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditQuery, AuditService } from './audit.service';

interface AuditRequest {
  user: { id: string; role: string; complianceDomain?: string };
}

@ApiTags('audit')
@ApiBearerAuth('jwt')
@Controller({ path: 'admin/audit-logs', version: '1' })
@UseGuards(AuthGuard('jwt'))
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'List filtered and paginated system audit logs' })
  findAll(@Request() request: AuditRequest, @Query() query: AuditQuery) {
    const user = request.user;
    if (user.role === 'admin' || user.role === 'company_admin') {
      return this.auditService.findAll(query);
    }
    if (user.role === 'compliance_officer' && user.complianceDomain) {
      return this.auditService.findAll(query, user.complianceDomain);
    }
    throw new ForbiddenException('Audit logs require an administrator or scoped compliance officer.');
  }
}
