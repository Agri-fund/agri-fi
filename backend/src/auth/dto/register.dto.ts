import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { IsStrongPassword } from '../validators/password-strength.validator';

export class RegisterDto {
  @ApiProperty({
    example: 'Amara Diallo',
    description: 'Full name of the user',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    example: 'amara@example.com',
    description: 'Unique email address',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'securePass1',
    minLength: 8,
    description: 'Password (min 8 characters)',
  })
  @IsString()
  @MinLength(8)
  @IsStrongPassword()
  password: string;

  @ApiProperty({
    enum: ['farmer', 'trader', 'investor', 'company_admin'],
    example: 'trader',
  })
  @IsIn(['farmer', 'trader', 'investor', 'company_admin'])
  role: 'farmer' | 'trader' | 'investor' | 'company_admin';

  @ApiProperty({ example: 'Ghana', description: 'Country of residence' })
  @IsString()
  @IsNotEmpty()
  country: string;

  @ApiProperty({
    example: '/dashboard',
    description: 'Relative URL to redirect to after successful registration',
    required: false,
  })
  @IsString()
  @IsOptional()
  redirect?: string;
}
