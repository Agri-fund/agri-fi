import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UseGuards,
  Request,
  RawBodyRequest,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
  ApiQuery,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import type { Request as ExpressRequest, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { WalletDto } from './dto/wallet.dto';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Sep10ChallengeDto } from './dto/sep10-challenge.dto';
import { Sep10ResponseDto } from './dto/sep10-response.dto';
import { EnableMfaDto } from './dto/mfa.dto';
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
  @Throttle({ login: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Get('verify-email')
  @ApiOperation({ summary: 'Verify email address via token link' })
  @ApiResponse({ status: 200, description: 'Email verified successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  verifyEmail(@Query('token') token: string) {
    return this.authService.verifyEmail(token);
  }

  @Post('login')
  @Throttle({ login: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Authenticate and receive a JWT' })
  @ApiResponse({ status: 200, description: 'Returns access and refresh JWTs' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.login(dto);
    const opts = this.authService.cookieOptions();
    res.cookie('access_token', tokens.accessToken, opts);
    res.cookie('refresh_token', tokens.refreshToken, opts);
    return tokens;
  }

  @Post('refresh')
  @Throttle({ login: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Exchange a refresh token for a new access token' })
  @ApiResponse({
    status: 200,
    description: 'Returns new access and refresh tokens',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or expired refresh token',
  })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  refresh(
    @Body() dto: RefreshTokenDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.refresh(dto.refreshToken).then((tokens) => {
      const opts = this.authService.cookieOptions();
      res.cookie('access_token', tokens.accessToken, opts);
      res.cookie('refresh_token', tokens.refreshToken, opts);
      return tokens;
    });
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
  @Throttle({ kyc: { limit: 3, ttl: 60000 } })
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Submit a KYC document' })
  @ApiResponse({ status: 201, description: 'KYC document recorded' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 422, description: 'Unsupported document type' })
  submitKyc(@Request() req: AuthRequest, @Body() dto: SubmitKycDto) {
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
  @ApiResponse({
    status: 200,
    description: 'Password updated; sessions invalidated',
  })
  @ApiResponse({
    status: 400,
    description: 'Current password incorrect or new password reused',
  })
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
  logout(
    @Request() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const authHeader = req.headers.authorization;
    const token =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.substring(7).trim()
        : undefined;

    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
    return this.authService.logout(req.user.id, token);
  }

  @Get('mfa/setup')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Get MFA TOTP provisioning secret, URI, and QR code',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns secret, otpauthUrl, and base64 qrCodeUrl',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  setupMfa(@Request() req: AuthRequest) {
    return this.authService.setupMfa(req.user.id);
  }

  @Post('mfa/enable')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('jwt')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify test token and enable MFA for account' })
  @ApiResponse({ status: 200, description: 'MFA enabled successfully' })
  @ApiResponse({ status: 400, description: 'Invalid verification token' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  enableMfa(@Request() req: AuthRequest, @Body() dto: EnableMfaDto) {
    return this.authService.enableMfa(req.user.id, dto.token);
  }

  @Get('stellar-challenge')
  @ApiOperation({
    summary: 'Get a SEP-10 challenge transaction for Stellar Web Authentication',
    description:
      'Returns an XDR challenge transaction that the client must sign with their Stellar wallet key',
  })
  @ApiQuery({
    name: 'wallet',
    description: 'Stellar public key to authenticate',
    required: true,
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Returns SEP-10 challenge XDR',
  })
  @ApiResponse({ status: 400, description: 'Invalid wallet address' })
  async getSep10Challenge(@Query() query: Sep10ChallengeDto) {
    return this.authService.generateSep10Challenge(query.wallet);
  }

  @Post('stellar-login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ login: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Authenticate via SEP-10 by submitting a signed challenge transaction',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns JWT tokens for the authenticated wallet',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid signature or expired challenge',
  })
  async sep10Login(@Body() dto: Sep10ResponseDto) {
    return this.authService.validateSep10Response(dto.signedXdr);
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
  handleWebhook(@Req() _req: RawBodyRequest<ExpressRequest>) {
    // Payload is safe to process — signature already verified by guard.
    return { received: true };
  }

  @Post('kyc/webhook')
  @UseGuards(WebhookSignatureGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive KYC provider status updates',
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
  @ApiResponse({ status: 200, description: 'KYC webhook processed' })
  @ApiResponse({ status: 401, description: 'Invalid or missing signature' })
  async handleKycWebhook(
    @Body() payload: Record<string, unknown>,
    @Req() _req: RawBodyRequest<ExpressRequest>,
  ) {
    return this.authService.handleKycWebhook(payload);
  }
}
