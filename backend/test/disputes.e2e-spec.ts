jest.mock('../src/documents/documents.service', () => ({
  DocumentsService: class DocumentsService {},
}));
jest.mock('../src/escrow/escrow.service', () => ({
  EscrowService: class EscrowService {},
}));
jest.mock('../src/notifications/notifications.service', () => ({
  NotificationsService: class NotificationsService {},
}));
jest.mock('../src/queue/queue.service', () => ({
  QueueService: class QueueService {},
}));

import {
  INestApplication,
  Injectable,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import * as request from 'supertest';
import { DisputesController } from '../src/disputes/disputes.controller';
import { DisputesService } from '../src/disputes/disputes.service';
import {
  Dispute,
  DisputeStatus,
} from '../src/disputes/entities/dispute.entity';
import { TradeDeal } from '../src/trade-deals/entities/trade-deal.entity';
import {
  Investment,
  InvestmentStatus,
} from '../src/investments/entities/investment.entity';
import { ShipmentMilestone } from '../src/shipments/entities/shipment-milestone.entity';
import { User } from '../src/auth/entities/user.entity';
import { DocumentsService } from '../src/documents/documents.service';
import { EscrowService } from '../src/escrow/escrow.service';
import { AuditService } from '../src/audit/audit.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { QueueService } from '../src/queue/queue.service';

const E2E_JWT_SECRET = 'disputes-e2e-secret';

@Injectable()
class TestJwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: E2E_JWT_SECRET,
    });
  }

  validate(payload: { sub: string; email: string; role: string }) {
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      kycStatus: 'verified',
    };
  }
}

describe('Disputes Resolution Workflow (E2E - #1387)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let dealState: {
    id: string;
    status: string;
    farmerId: string;
    traderId: string;
    tokenSymbol: string;
    deliveryDate: Date;
    escrowReleased: boolean;
  };
  let disputesStore: Map<string, Dispute>;
  let auditTrail: Array<{ action: string; resourceId: string }>;

  const investorId = '10000000-0000-4000-8000-000000000001';
  const adminId = '10000000-0000-4000-8000-000000000002';
  const dealId = '20000000-0000-4000-8000-000000000001';
  const disputeUuid = '30000000-0000-4000-8000-000000000001';

  const usersById: Record<string, Partial<User>> = {
    [investorId]: {
      id: investorId,
      email: 'investor@agri-fi.test',
      role: 'investor',
      tokenVersion: 0,
      kycStatus: 'verified',
    },
    [adminId]: {
      id: adminId,
      email: 'admin@agri-fi.test',
      role: 'admin',
      tokenVersion: 0,
      kycStatus: 'verified',
    },
  };

  beforeAll(async () => {
    disputesStore = new Map();
    auditTrail = [];
    dealState = {
      id: dealId,
      status: 'funded',
      farmerId: '40000000-0000-4000-8000-000000000001',
      traderId: '50000000-0000-4000-8000-000000000001',
      tokenSymbol: 'MAIZE-001',
      deliveryDate: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000),
      escrowReleased: false,
    };

    const disputeRepoMock = {
      findOne: jest.fn(({ where }) => {
        if (where?.id) {
          return Promise.resolve(disputesStore.get(where.id) ?? null);
        }
        if (where?.dealId) {
          const found = Array.from(disputesStore.values()).find(
            (d) =>
              d.dealId === where.dealId &&
              [
                DisputeStatus.OPEN,
                DisputeStatus.UNDER_REVIEW,
                DisputeStatus.ESCALATED,
              ].includes(d.status),
          );
          return Promise.resolve(found ?? null);
        }
        return Promise.resolve(null);
      }),
      find: jest.fn(() => Promise.resolve(Array.from(disputesStore.values()))),
      save: jest.fn((entity: Dispute) => {
        entity.updatedAt = new Date();
        disputesStore.set(entity.id, entity);
        return Promise.resolve(entity);
      }),
    };

    const txManager = {
      create: jest.fn((_, data) => ({
        id: disputeUuid,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      })),
      save: jest.fn((_, entity: Dispute) => {
        disputesStore.set(entity.id, entity);
        return Promise.resolve(entity);
      }),
      update: jest.fn((_, __, partial) => {
        if (partial.status) {
          dealState.status = partial.status;
        }
        return Promise.resolve({ affected: 1 });
      }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET: E2E_JWT_SECRET })],
        }),
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({ secret: E2E_JWT_SECRET }),
      ],
      controllers: [DisputesController],
      providers: [
        DisputesService,
        TestJwtStrategy,
        { provide: getRepositoryToken(Dispute), useValue: disputeRepoMock },
        {
          provide: getRepositoryToken(TradeDeal),
          useValue: {
            findOne: jest.fn(() => Promise.resolve(dealState)),
          },
        },
        {
          provide: getRepositoryToken(Investment),
          useValue: {
            findOne: jest.fn(({ where }) =>
              where?.investorId === investorId
                ? Promise.resolve({
                    id: 'inv-e2e-1',
                    tradeDealId: dealId,
                    investorId,
                    status: InvestmentStatus.CONFIRMED,
                  })
                : Promise.resolve(null),
            ),
          },
        },
        {
          provide: getRepositoryToken(ShipmentMilestone),
          useValue: { findOne: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn(({ where }) =>
              Promise.resolve(usersById[where?.id] ?? null),
            ),
            find: jest.fn(() => Promise.resolve([usersById[adminId]])),
          },
        },
        {
          provide: DocumentsService,
          useValue: {
            handleUpload: jest.fn().mockResolvedValue({
              id: 'doc-e2e-1',
              storageUrl: 'https://ipfs.io/ipfs/QmE2EEvidence',
            }),
          },
        },
        {
          provide: EscrowService,
          useValue: {
            releaseDisputedEscrowToFarmer: jest.fn(async () => {
              dealState.status = 'completed';
              dealState.escrowReleased = true;
            }),
            refundDisputedEscrowToInvestors: jest.fn(async () => {
              dealState.status = 'failed';
            }),
          },
        },
        {
          provide: AuditService,
          useValue: {
            logEvent: jest.fn(async (entry) => {
              auditTrail.push({
                action: entry.action,
                resourceId: entry.resourceId,
              });
              return entry;
            }),
          },
        },
        {
          provide: NotificationsService,
          useValue: { createNotification: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: QueueService,
          useValue: { emit: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: DataSource,
          useValue: { transaction: jest.fn((cb) => cb(txManager)) },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    jwtService = moduleRef.get<JwtService>(JwtService);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('completes raise dispute -> admin review -> resolve -> escrow released flow', async () => {
    const investorToken = jwtService.sign({
      sub: investorId,
      email: 'investor@agri-fi.test',
      role: 'investor',
      tokenVersion: 0,
    });
    const adminToken = jwtService.sign({
      sub: adminId,
      email: 'admin@agri-fi.test',
      role: 'admin',
      tokenVersion: 0,
    });

    // 1. Investor raises dispute
    const createRes = await request(app.getHttpServer())
      .post('/v1/disputes')
      .set('Authorization', `Bearer ${investorToken}`)
      .send({
        deal_id: dealId,
        reason:
          'Importer milestone not recorded 14 days after expected delivery.',
      })
      .expect(201);

    expect(createRes.body.id).toBe(disputeUuid);
    expect(createRes.body.status).toBe(DisputeStatus.OPEN);
    expect(dealState.status).toBe('DISPUTED');

    // 2. Admin marks dispute under review
    const reviewRes = await request(app.getHttpServer())
      .patch(`/v1/disputes/${disputeUuid}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(reviewRes.body.status).toBe(DisputeStatus.UNDER_REVIEW);

    // 3. Admin resolves dispute in favor of farmer and releases escrow
    const resolveRes = await request(app.getHttpServer())
      .post(`/v1/disputes/${disputeUuid}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        resolution: 'release_farmer',
        notes: 'Confirmed shipment arrived at destination port.',
      })
      .expect(200);

    expect(resolveRes.body.status).toBe(DisputeStatus.RESOLVED_FARMER);
    expect(dealState.status).toBe('completed');
    expect(dealState.escrowReleased).toBe(true);
    expect(auditTrail.map((e) => e.action)).toEqual([
      'dispute.created',
      'dispute.under_review',
      'dispute.resolved',
    ]);
  });
});
