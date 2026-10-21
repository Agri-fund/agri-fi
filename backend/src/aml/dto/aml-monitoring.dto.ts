import { PartialType } from '@nestjs/mapped-types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  AmlCaseStatus,
  AmlDisposition,
  AmlPatternType,
  AmlRuleAction,
  AmlSeverity,
} from '../aml.constants';

/**
 * Configurable monitoring rules (#1217). `parameters` is free-form jsonb whose
 * recognised keys depend on `patternType`; the service validates that the keys
 * used by the chosen pattern are present and sane so a typo cannot silently
 * disable a detector.
 */
export class CreateAmlRuleDto {
  @ApiProperty({ example: 'AML-MON-STRUCT-001' })
  @IsString()
  @MaxLength(64)
  ruleCode: string;

  @ApiProperty({ example: 'Sub-threshold deposit clustering' })
  @IsString()
  @MaxLength(160)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    enum: [
      'STRUCTURING',
      'RAPID_MOVEMENT',
      'LAYERING',
      'VELOCITY',
      'HIGH_VALUE',
      'HIGH_RISK_JURISDICTION',
      'SANCTIONS_MATCH',
      'PEP_MATCH',
      'BEHAVIORAL_ANOMALY',
    ],
  })
  @IsEnum([
    'STRUCTURING',
    'RAPID_MOVEMENT',
    'LAYERING',
    'VELOCITY',
    'HIGH_VALUE',
    'HIGH_RISK_JURISDICTION',
    'SANCTIONS_MATCH',
    'PEP_MATCH',
    'BEHAVIORAL_ANOMALY',
  ])
  patternType: AmlPatternType;

  @ApiPropertyOptional({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] })
  @IsOptional()
  @IsEnum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  riskLevel?: AmlSeverity;

  @ApiPropertyOptional({
    enum: [
      'ALLOW',
      'FLAG_REVIEW',
      'REQUIRE_ENHANCED_DUE_DILIGENCE',
      'REJECT',
      'CAP_TRANSACTION',
    ],
  })
  @IsOptional()
  @IsEnum([
    'ALLOW',
    'FLAG_REVIEW',
    'REQUIRE_ENHANCED_DUE_DILIGENCE',
    'REJECT',
    'CAP_TRANSACTION',
  ])
  action?: AmlRuleAction;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: 'GLOBAL' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  jurisdiction?: string;

  @ApiPropertyOptional({
    description: 'Rolling look-back window in hours',
    example: 24,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24 * 31)
  windowHours?: number;

  @ApiPropertyOptional({
    example: {
      aggregateThresholdUsd: 10000,
      maxIndividualAmountUsd: 9500,
      minFlowCount: 3,
    },
  })
  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '0-100', example: 65 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  baseRiskScore?: number;

  @ApiPropertyOptional({ description: '0-100', example: 40 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  alertThresholdScore?: number;
}

export class UpdateAmlRuleDto extends PartialType(CreateAmlRuleDto) {}

/** Manual monitoring sweep; omitting the window sweeps the last `lookbackHours`. */
export class RunSweepDto {
  @ApiPropertyOptional({ description: 'ISO timestamp' })
  @IsOptional()
  @IsString()
  windowStart?: string;

  @ApiPropertyOptional({ description: 'ISO timestamp' })
  @IsOptional()
  @IsString()
  windowEnd?: string;

  @ApiPropertyOptional({ description: 'Restrict the sweep to one user' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({
    description: 'Evaluate and report without persisting alerts',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class TriageAlertDto {
  @ApiProperty({
    enum: [
      'false_positive',
      'sar_filed',
      'no_action',
      'referred_to_authority',
      'account_restricted',
    ],
  })
  @IsEnum([
    'false_positive',
    'sar_filed',
    'no_action',
    'referred_to_authority',
    'account_restricted',
  ])
  disposition: AmlDisposition;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  reason?: string;
}

export class CreateAmlCaseDto {
  @ApiPropertyOptional({ description: 'Alerts to group into this case' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  alertIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  subjectUserId?: string;

  @ApiPropertyOptional({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] })
  @IsOptional()
  @IsEnum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  priority?: AmlSeverity;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  summary?: string;
}

export class UpdateAmlCaseDto {
  @ApiPropertyOptional({
    enum: ['open', 'in_review', 'escalated', 'awaiting_information', 'closed'],
  })
  @IsOptional()
  @IsEnum(['open', 'in_review', 'escalated', 'awaiting_information', 'closed'])
  status?: AmlCaseStatus;

  @ApiPropertyOptional({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] })
  @IsOptional()
  @IsEnum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  priority?: AmlSeverity;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assignedTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

export class CloseAmlCaseDto {
  @ApiProperty({
    enum: [
      'false_positive',
      'sar_filed',
      'no_action',
      'referred_to_authority',
      'account_restricted',
    ],
  })
  @IsEnum([
    'false_positive',
    'sar_filed',
    'no_action',
    'referred_to_authority',
    'account_restricted',
  ])
  disposition: AmlDisposition;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

/** Local list entry used by `POST /admin/aml/sanctions/entries`. */
export class UpsertSanctionsEntryDto {
  @ApiProperty({ enum: ['OFAC', 'UN', 'EU'] })
  @IsEnum(['OFAC', 'UN', 'EU'])
  listSource: string;

  @ApiPropertyOptional({
    description: 'Publisher identifier (SDN id, UN link id, ...)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  externalId?: string;

  @ApiProperty({ enum: ['PERSON', 'ENTITY', 'VESSEL', 'AIRCRAFT'] })
  @IsEnum(['PERSON', 'ENTITY', 'VESSEL', 'AIRCRAFT'])
  entryType: string;

  @ApiProperty({ example: 'Ivan Ivanov' })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aliases?: string[];

  @ApiPropertyOptional({ example: 'RU' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  country?: string;

  @ApiPropertyOptional({ type: 'array', items: { type: 'object' } })
  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  idNumbers?: Array<{ type: string; value: string }>;

  @ApiPropertyOptional({ example: '1960-04-12' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  dateOfBirth?: string;

  @ApiPropertyOptional({
    description: 'Mark as politically exposed person for PEP screening',
  })
  @IsOptional()
  @IsBoolean()
  isPep?: boolean;

  @ApiPropertyOptional({ example: 'Minister of Finance' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  pepRole?: string;

  @ApiPropertyOptional({ example: 'SDGT' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  programme?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  listVersion?: string;
}

/** Bulk load of a published list, e.g. the rows parsed from an OFAC XML/CSV dump. */
export class ImportSanctionsListDto {
  @ApiProperty({ enum: ['OFAC', 'UN', 'EU'] })
  @IsEnum(['OFAC', 'UN', 'EU'])
  listSource: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  listVersion?: string;

  @ApiProperty({ type: [UpsertSanctionsEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertSanctionsEntryDto)
  entries: UpsertSanctionsEntryDto[];
}

export class ScreenSubjectDto {
  @ApiProperty({ enum: ['user', 'wallet', 'transaction'] })
  @IsEnum(['user', 'wallet', 'transaction'])
  subjectType: string;

  @ApiProperty()
  @IsString()
  @MaxLength(64)
  subjectId: string;

  @ApiPropertyOptional({
    description: 'Name to screen; defaults to the user profile name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(56)
  walletAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  dateOfBirth?: string;

  @ApiPropertyOptional({
    description: 'Raise alerts/cases automatically on a match',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  raiseAlert?: boolean;
}

export class GenerateSarDto {
  @ApiProperty()
  @IsUUID()
  caseId: string;

  @ApiPropertyOptional({ example: 'US' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  jurisdiction?: string;

  @ApiPropertyOptional({ example: 'FinCEN' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  authority?: string;

  @ApiPropertyOptional({
    description: 'initial | continuing | correction',
    example: 'initial',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  filingType?: string;
}

export class SubmitSarDto {
  @ApiProperty()
  @IsUUID()
  sarReportId: string;

  @ApiPropertyOptional({
    description: 'Record a portal filing instead of an API call',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  manualFiling?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

export class PagedQueryDto {
  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class ListAmlAlertsQueryDto extends PagedQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  patternType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({
    description: 'Minimum effective risk score',
    example: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  minRiskScore?: number;
}
