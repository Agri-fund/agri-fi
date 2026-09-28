import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class EnableMfaDto {
  @IsString()
  @Length(6, 6)
  @ApiProperty({
    description: '6-digit TOTP verification token from authenticator app',
    example: '123456',
  })
  token: string;
}

export class VerifyMfaDto {
  @IsString()
  @ApiProperty({
    description: '6-digit TOTP token or backup code',
    example: '123456',
  })
  token: string;
}

export class DisableMfaDto {
  @IsString()
  @Length(6, 6)
  @ApiProperty({
    description: 'Current 6-digit TOTP token to confirm disable',
    example: '123456',
  })
  token: string;

  @IsString()
  @ApiProperty({
    description: 'Current account password for confirmation',
    example: 'MySecureP@ss1',
  })
  password: string;
}
