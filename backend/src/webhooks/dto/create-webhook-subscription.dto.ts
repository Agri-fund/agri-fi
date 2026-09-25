import {
  IsUrl,
  IsArray,
  IsString,
  IsOptional,
  IsBoolean,
} from 'class-validator';

export class CreateWebhookSubscriptionDto {
  @IsUrl({ require_tld: false })
  url: string;

  @IsString()
  @IsOptional()
  secret?: string;

  @IsArray()
  @IsString({ each: true })
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
  @IsString({ each: true })
  @IsOptional()
  events?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
