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
