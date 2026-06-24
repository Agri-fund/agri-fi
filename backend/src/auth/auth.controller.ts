import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  RawBodyRequest,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import type { Request as ExpressRequest } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { WalletDto } from './dto/wallet.dto';
import { KycDto } from './dto/kyc.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { WebhookSignatureGuard } from './webhook-signature.guard';
import { User } from './entities/user.entity';

interface AuthRequest extends ExpressRequest {
  user: User;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle({
    default: {
      limit: parseInt(process.env.RATE_LIMIT_REGISTER || '3'),
      ttl: parseInt(process.env.RATE_LIMIT_TTL || '60000'),
    },
  })
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @Throttle({
    default: {
      limit: parseInt(process.env.RATE_LIMIT_LOGIN || '5'),
      ttl: parseInt(process.env.RATE_LIMIT_TTL || '60000'),
    },
  })
  @ApiOperation({ summary: 'Authenticate and receive a JWT' })
  @ApiResponse({ status: 200, description: 'Returns access and refresh JWTs' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @Throttle({
    default: {
      limit: parseInt(process.env.RATE_LIMIT_LOGIN || '5'),
      ttl: parseInt(process.env.RATE_LIMIT_TTL || '60000'),
    },
  })
  @ApiOperation({ summary: 'Exchange a refresh token for a new access token' })
  @ApiResponse({ status: 200, description: 'Returns new access and refresh tokens' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('wallet')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Link a Stellar wallet address to the authenticated user' })
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

  @Post('change-password')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change password and invalidate all active sessions',
    description:
      'Updates the account password and increments tokenVersion, ' +
      'revoking every outstanding JWT issued before this call.',
  })
  @ApiResponse({ status: 200, description: 'Password updated; sessions invalidated' })
  @ApiResponse({ status: 400, description: 'Current password incorrect or new password reused' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  changePassword(@Request() req: AuthRequest, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(req.user.id, dto);
  }

  @Post('logout')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Logout and invalidate the current JWT token' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  logout(@Request() req: AuthRequest) {
    return this.authService.logout(req.user.id);
  }

  @Post('webhook')
  @UseGuards(WebhookSignatureGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive third-party webhook events (payment / KYC status updates)',
    description:
      'Caller must include an `x-webhook-signature` header containing ' +
      'the HMAC-SHA256 hex digest of the raw request body, signed with ' +
      'the shared `WEBHOOK_SECRET` environment variable.',
  })
  @ApiHeader({
    name: 'x-webhook-signature',
    description: 'HMAC-SHA256 hex signature of the raw request body',
    required: true,
  })
  @ApiResponse({ status: 200, description: 'Webhook accepted' })
  @ApiResponse({ status: 401, description: 'Invalid or missing signature' })
  handleWebhook(@Req() req: RawBodyRequest<ExpressRequest>) {
    // Payload is safe to process — signature already verified by guard.
    return { received: true };
  }
}
