import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'amara@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'securePass1' })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({
    example: '/dashboard',
    description: 'Relative URL to redirect to after successful login',
    required: false,
  })
  @IsString()
  @IsOptional()
  redirect?: string;

  @ApiProperty({
    description:
      'hCaptcha response token. Required when a CAPTCHA challenge has been ' +
      'issued for this account by credential-stuffing detection (#898).',
    required: false,
  })
  @IsString()
  @IsOptional()
  captchaToken?: string;
}
