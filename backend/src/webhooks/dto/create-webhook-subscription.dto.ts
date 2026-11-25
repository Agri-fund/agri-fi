import {
  IsUrl,
  IsArray,
  IsString,
  IsOptional,
  IsBoolean,
  ArrayNotEmpty,
  Matches,
} from 'class-validator';

/** `*` or a dotted event name such as `deal.funding_progress`. */
const EVENT_PATTERN = /^(\*|[a-z_]+\.[a-z_]+)$/;

export class CreateWebhookSubscriptionDto {
  @IsUrl({ require_tld: false })
  url: string;

  @IsString()
  @IsOptional()
  secret?: string;

  @IsArray()
  @ArrayNotEmpty()
  @Matches(EVENT_PATTERN, { each: true })
  events: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateWebhookSubscriptionDto {
  @IsUrl({ require_tld: false })
  @IsOptional()
  url?: string;

  @IsString()
  @IsOptional()
  secret?: string;

  @IsArray()
  @ArrayNotEmpty()
  @Matches(EVENT_PATTERN, { each: true })
  @IsOptional()
  events?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
