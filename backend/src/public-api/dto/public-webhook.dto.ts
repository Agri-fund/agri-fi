import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUrl, IsArray, IsString, IsNotEmpty, IsOptional, ArrayMinSize } from 'class-validator';

export class CreatePublicWebhookSubscriptionDto {
  @ApiProperty({
    description: 'Target HTTPS URL that receives webhook POST deliveries',
    example: 'https://api.partner.com/webhooks/agri-fi',
  })
  @IsUrl({ require_tld: true, require_protocol: true })
  @IsNotEmpty()
  url: string;

  @ApiProperty({
    description: 'Array of event topic names to subscribe to',
    example: ['deal.funded', 'milestone.completed', 'settlement.completed'],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  events: string[];

  @ApiProperty({
    description: 'Shared secret string used for HMAC-SHA256 signature calculation (min 16 chars)',
    example: 'whsec_9f83a241b0c94628ef1a7c',
    minLength: 16,
  })
  @IsString()
  @IsNotEmpty()
  secret: string;

  @ApiPropertyOptional({
    description: 'Optional description or label for the subscription',
    example: 'ERP Production Webhook Receiver',
  })
  @IsOptional()
  @IsString()
  description?: string;
}
