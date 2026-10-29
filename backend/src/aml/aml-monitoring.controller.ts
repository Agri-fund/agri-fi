import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { RolesGuard } from '../common/guards';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AmlRulesService } from './aml-rules.service';
import { AmlCaseService } from './aml-case.service';
import { TransactionMonitoringService } from './transaction-monitoring.service';
import { SanctionsListService } from './sanctions-list.service';
import { SanctionsScreeningService } from './sanctions-screening.service';
import { SarGenerationService } from './sar-generation.service';
import { RegulatoryReportingService } from './regulatory-reporting.service';
import {
  CloseAmlCaseDto,
  CreateAmlCaseDto,
  CreateAmlRuleDto,
  GenerateSarDto,
  ImportSanctionsListDto,
  ListAmlAlertsQueryDto,
  RunSweepDto,
  ScreenSubjectDto,
  SubmitSarDto,
  TriageAlertDto,
  UpdateAmlCaseDto,
  UpdateAmlRuleDto,
  UpsertSanctionsEntryDto,
} from './dto/aml-monitoring.dto';

interface AuthenticatedRequest {
  user: { id: string; role?: string; roles?: string[] };
}

const toDate = (value?: string): Date | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

/**
 * Compliance-operator surface for transaction monitoring (#1217). Every route
 * is admin/company_admin only and is written to `system_audit_logs` through the
 * shared AuditInterceptor, because who looked at an alert is itself evidence.
 */
@ApiTags('aml-monitoring')
@ApiBearerAuth('jwt')
@Controller({ version: '1', path: 'admin/aml' })
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin', 'company_admin')
@UseInterceptors(AuditInterceptor)
export class AmlMonitoringController {
  constructor(
    private readonly rulesService: AmlRulesService,
    private readonly monitoringService: TransactionMonitoringService,
    private readonly caseService: AmlCaseService,
    private readonly sanctionsList: SanctionsListService,
    private readonly screening: SanctionsScreeningService,
    private readonly sars: SarGenerationService,
    private readonly reporting: RegulatoryReportingService,
  ) {}

  // ---------------------------------------------------------------- rules

  @Get('rules')
  @ApiOperation({ summary: 'List AML monitoring rules' })
  @ApiQuery({ name: 'enabledOnly', required: false })
  listRules(@Query('enabledOnly') enabledOnly?: string) {
    return this.rulesService.listRules(enabledOnly === 'true');
  }

  @Post('rules')
  @ApiOperation({ summary: 'Create a monitoring rule' })
  createRule(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateAmlRuleDto,
  ) {
    return this.rulesService.createRule(dto, req.user.id);
  }

  @Post('rules/seed')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Install the shipped rule set for any rule code that is missing',
  })
  seedRules(@Request() req: AuthenticatedRequest) {
    return this.rulesService.ensureDefaults(req.user.id);
  }

  @Patch('rules/:id')
  @ApiOperation({
    summary: 'Update a rule; changing parameters bumps its version',
  })
  updateRule(@Param('id') id: string, @Body() dto: UpdateAmlRuleDto) {
    return this.rulesService.updateRule(id, dto);
  }

  @Post('rules/:id/enabled')
  @HttpCode(200)
  @ApiOperation({ summary: 'Enable or disable a rule without deleting it' })
  setRuleEnabled(@Param('id') id: string, @Body() body: { enabled: boolean }) {
    return this.rulesService.setEnabled(id, body.enabled === true);
  }

  // ------------------------------------------------------------ monitoring

  @Post('sweep')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Run behavioural monitoring over a window and raise alerts',
  })
  async runSweep(@Body() dto: RunSweepDto) {
    return this.monitoringService.runSweep({
      windowStart: toDate(dto.windowStart),
      windowEnd: toDate(dto.windowEnd),
      userId: dto.userId,
      dryRun: dto.dryRun ?? false,
      trigger: 'manual',
    });
  }

  @Post('users/:userId/monitor')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sweep a single subject over a lookback window' })
  @ApiQuery({ name: 'lookbackHours', required: false })
  @ApiQuery({ name: 'dryRun', required: false })
  monitorUser(
    @Param('userId') userId: string,
    @Query('lookbackHours') lookbackHours?: string,
    @Query('dryRun') dryRun?: string,
  ) {
    return this.monitoringService.monitorUser(
      userId,
      Number(lookbackHours) > 0 ? Number(lookbackHours) : 24 * 30,
      dryRun === 'true',
    );
  }

  @Get('alerts')
  @ApiOperation({ summary: 'Alert triage queue, highest risk first' })
  listAlerts(@Query() query: ListAmlAlertsQueryDto) {
    return this.caseService.listAlerts(query);
  }

  @Get('users/:userId/alerts')
  @ApiOperation({ summary: 'Alert history for one monitored subject' })
  async userAlerts(@Param('userId') userId: string) {
    return { items: await this.monitoringService.alertsForUser(userId) };
  }

  @Post('alerts/:id/triage')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Record an analyst disposition; feeds rule sensitivity learning',
  })
  triageAlert(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: TriageAlertDto,
  ) {
    return this.caseService.triageAlert(
      id,
      dto.disposition,
      dto.reason ?? null,
      req.user.id,
    );
  }

  // ----------------------------------------------------------------- cases

  @Get('cases')
  @ApiOperation({ summary: 'List investigation cases' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'assignedTo', required: false })
  @ApiQuery({ name: 'subjectUserId', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  listCases(
    @Query()
    query: ListAmlAlertsQueryDto & {
      assignedTo?: string;
      subjectUserId?: string;
    },
  ) {
    return this.caseService.listCases(query);
  }

  @Get('cases/summary')
  @ApiOperation({
    summary: 'Case workload roll-up for the compliance dashboard',
  })
  caseSummary() {
    return this.caseService.summary();
  }

  @Get('cases/overdue')
  @ApiOperation({ summary: 'Open cases past their priority SLA' })
  overdueCases() {
    return this.caseService.overdueCases();
  }

  @Post('cases')
  @ApiOperation({
    summary: 'Open a case, optionally grouping existing alerts into it',
  })
  createCase(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateAmlCaseDto,
  ) {
    return this.caseService.createCase(dto, req.user.id);
  }

  @Get('cases/:id')
  @ApiOperation({ summary: 'Case detail including its timeline' })
  getCase(@Param('id') id: string) {
    return this.caseService.getCase(id);
  }

  @Post('cases/:id/alerts')
  @HttpCode(200)
  @ApiOperation({ summary: 'Attach already-raised alerts to a case' })
  attachAlerts(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { alertIds: string[] },
  ) {
    return this.caseService.attachAlerts(id, body.alertIds ?? [], req.user.id);
  }

  @Patch('cases/:id')
  @ApiOperation({ summary: 'Move, reassign or reprioritise a case' })
  updateCase(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateAmlCaseDto,
  ) {
    return this.caseService.updateCase(id, dto, req.user.id);
  }

  @Post('cases/:id/close')
  @HttpCode(200)
  @ApiOperation({ summary: 'Close a case with a disposition' })
  closeCase(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: CloseAmlCaseDto,
  ) {
    return this.caseService.closeCase(id, dto, req.user.id);
  }

  // ------------------------------------------------------------- sanctions

  @Get('sanctions/counts')
  @ApiOperation({ summary: 'How many entries are loaded per list source' })
  sanctionsCounts() {
    return this.sanctionsList.countBySource();
  }

  @Get('sanctions/peps')
  @ApiOperation({ summary: 'List politically exposed persons' })
  @ApiQuery({ name: 'limit', required: false })
  listPeps(@Query('limit') limit?: string) {
    return this.sanctionsList.listPeps(Number(limit) > 0 ? Number(limit) : 100);
  }

  @Post('sanctions/entries')
  @ApiOperation({ summary: 'Insert or update one sanctions / PEP entry' })
  upsertEntry(@Body() dto: UpsertSanctionsEntryDto) {
    return this.sanctionsList.upsert(dto);
  }

  @Post('sanctions/import')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Bulk-load a published list; runs in one transaction and is re-runnable',
  })
  importList(@Body() dto: ImportSanctionsListDto) {
    return this.sanctionsList.importList(dto);
  }

  @Post('sanctions/preview')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Show the candidate list entries a name would match',
  })
  async previewName(@Body() body: { name: string }) {
    return {
      items: await this.sanctionsList.candidatesForName(body.name ?? ''),
    };
  }

  @Post('screening/subject')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Screen a user, wallet or transaction against the lists',
  })
  screenSubject(
    @Request() req: AuthenticatedRequest,
    @Body() dto: ScreenSubjectDto,
  ) {
    return this.screening.screenSubject(dto, req.user.id);
  }

  @Post('screening/rescreen')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Re-screen every verified subject after a list update',
  })
  rescreen() {
    return this.screening.rescreenVerifiedUsers();
  }

  // ------------------------------------------------------------------- SAR

  @Get('sar')
  @ApiOperation({ summary: 'List generated reports' })
  @ApiQuery({ name: 'status', required: false })
  listSars(@Query('status') status?: string, @Query('limit') limit?: string) {
    return this.sars.listSars(status, Number(limit) > 0 ? Number(limit) : 50);
  }

  @Get('sar/analytics')
  @ApiOperation({ summary: 'Filing throughput and integrity counters' })
  sarAnalytics() {
    return this.sars.analytics();
  }

  @Post('sar')
  @ApiOperation({ summary: 'Draft a report from a case and its alerts' })
  generateSar(
    @Request() req: AuthenticatedRequest,
    @Body() dto: GenerateSarDto,
  ) {
    return this.sars.generate(dto, req.user.id);
  }

  @Get('sar/:id')
  @ApiOperation({ summary: 'Report detail, including the structured payload' })
  getSar(@Param('id') id: string) {
    return this.sars.getSar(id);
  }

  @Post('sar/:id/review')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Sign the draft off; only reviewed reports can be filed',
  })
  reviewSar(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.sars.markReviewed(id, req.user.id);
  }

  @Get('sar/:id/verify')
  @ApiOperation({
    summary: 'Recompute the content hash to prove the report is untampered',
  })
  verifySar(@Param('id') id: string) {
    return this.sars.verifyIntegrity(id);
  }

  // ------------------------------------------------------------ filings

  @Post('submissions')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'File a reviewed report with the authority or record a portal filing',
  })
  submit(@Request() req: AuthenticatedRequest, @Body() dto: SubmitSarDto) {
    return this.reporting.submit(dto, req.user.id);
  }

  @Get('submissions')
  @ApiOperation({ summary: 'Filing attempts and their responses' })
  @ApiQuery({ name: 'status', required: false })
  listSubmissions(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reporting.listSubmissions(
      status,
      Number(limit) > 0 ? Number(limit) : 50,
    );
  }

  @Get('submissions/metrics')
  @ApiOperation({ summary: 'Acceptance rate and pending backlog by status' })
  submissionMetrics() {
    return this.reporting.reportingMetrics();
  }

  @Post('submissions/:id/retry')
  @HttpCode(200)
  @ApiOperation({ summary: 'Retry a failed API filing as a new attempt' })
  retrySubmission(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.reporting.retry(id, req.user.id);
  }

  @Post('submissions/:id/acknowledge')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Record the authority receipt for a manual portal filing',
  })
  acknowledge(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { authorityReference?: string },
  ) {
    return this.reporting.markAcknowledged(
      id,
      body.authorityReference ?? null,
      req.user.id,
    );
  }

  @Get('status')
  @ApiOperation({
    summary: 'Whether monitoring is switched on for this deployment',
  })
  async status() {
    const rules = await this.rulesService.listRules(true);
    return {
      monitoringEnabled: this.monitoringService.isEnabled,
      enabledRules: rules.length,
    };
  }
}
