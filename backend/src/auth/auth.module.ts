import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AdminController } from './admin.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { User } from './entities/user.entity';
import { KycSubmission } from './entities/kyc-submission.entity';
import { ReferralCode } from './entities/referral-code.entity';
import { Referral } from './entities/referral.entity';
import { KycGuard } from './kyc.guard';
import { RolesGuard } from './roles.guard';
import { QueueModule } from '../queue/queue.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Document } from '../trade-deals/entities/document.entity';
import { OfacSanctionsCheckService } from './utils/ofac-sanctions-check';
import { LoginLog } from '../database/entities/login-log.entity';
import { AdminAction } from '../database/entities/admin-action.entity';
import { SecurityIpBlock } from '../database/entities/security-ip-block.entity';
import { KycCronService } from './kyc-cron.service';
import { RedisConfig } from '../config/redis.config';
import { TokenBlocklistService } from './token-blocklist.service';
import { SecurityThreatService } from './security-threat.service';
import { MfaGuard } from './guards/mfa.guard';
import { EscrowModule } from '../escrow/escrow.module';
import { SettlementModule } from '../settlement/settlement.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      KycSubmission,
      TradeDeal,
      Document,
      LoginLog,
      AdminAction,
      SecurityIpBlock,
    ]),
    ConfigModule,
    QueueModule,
    NotificationsModule,
    AuditModule,
    PassportModule,
    EscrowModule,
    EmailSequenceModule,
    SettlementModule,
    DocumentsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '7d') },
      }),
    }),
  ],
  controllers: [AuthController, AdminController],
  providers: [
    AuthService,
    JwtStrategy,
    KycGuard,
    RolesGuard,
    MfaGuard,
    RedisConfig,
    TokenBlocklistService,
    SecurityThreatService,
    OfacSanctionsCheckService,
    KycCronService,
  ],
  exports: [
    AuthService,
    JwtModule,
    TypeOrmModule,
    KycGuard,
    RolesGuard,
    MfaGuard,
    RedisConfig,
    TokenBlocklistService,
    SecurityThreatService,
    OfacSanctionsCheckService,
  ],
})
export class AuthModule {}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      KycSubmission,
      TradeDeal,
      Document,
      LoginLog,
      AdminAction,
      SecurityIpBlock,
    ]),
    QueueModule,
    NotificationsModule,
    PassportModule,
    EscrowModule,
    EmailSequenceModule,
    SettlementModule,
    DocumentsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '7d') },
      }),
    }),
  ],
  controllers: [AuthController, AdminController],
  providers: [
    AuthService,
    JwtStrategy,
    GoogleStrategy,
    KycGuard,
    RolesGuard,
    MfaGuard,
    RedisConfig,
    TokenBlocklistService,
    SecurityThreatService,
    OfacSanctionsCheckService,
    KycCronService,
  ],
  exports: [
    AuthService,
    JwtModule,
    TypeOrmModule,
    KycGuard,
    RolesGuard,
    MfaGuard,
    RedisConfig,
    TokenBlocklistService,
    SecurityThreatService,
    OfacSanctionsCheckService,
  ],
})
export class AuthModule {}
