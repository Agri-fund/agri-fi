import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { WalletDto } from './dto/wallet.dto';
import { KycDto } from './dto/kyc.dto';
import { User } from './entities/user.entity';

interface AuthRequest extends Request {
  user: User;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @ApiOperation({ summary: 'Authenticate and receive a JWT' })
  @ApiResponse({ status: 200, description: 'Returns access_token JWT' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('wallet')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Link a Stellar wallet address to the authenticated user',
  })
  @ApiResponse({ status: 200, description: 'Wallet linked' })
  @ApiResponse({ status: 400, description: 'Invalid wallet address' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  linkWallet(@Request() req: AuthRequest, @Body() dto: WalletDto) {
    return this.authService.linkWallet(req.user.id, dto.walletAddress);
  }

  @Post('kyc')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Submit a KYC document' })
  @ApiResponse({ status: 201, description: 'KYC document recorded' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 422, description: 'Unsupported document type' })
  submitKyc(@Request() req: AuthRequest, @Body() dto: KycDto) {
    return this.authService.submitKyc(req.user.id, dto);
  }
}
