/**
 * Integration test for SEP-12 KYC field mapping (#837).
 *
 * Validates the full PUT -> GET round trip through the Sep12Service against a
 * mock anchor: internal platform field names are mapped to the standardised
 * Stellar SEP-12 customer schema, stored in both formats, and returned in a
 * SEP-12 compliant shape with validated field types.
 */

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { Sep12Service, mapInternalKycToSep12 } from './sep12.service';
import { User } from '../auth/entities/user.entity';
import { KycSubmission } from '../auth/entities/kyc-submission.entity';

describe('SEP-12 KYC field mapping', () => {
  let service: Sep12Service;
  let users: Map<string, User>;
  let submissions: KycSubmission[];

  const mockUser = (): User =>
    ({
      id: 'user-1',
      email: 'ada@example.com',
      role: 'investor',
      country: null,
      kycStatus: 'pending',
      fullName: null,
      birthdate: null,
      taxId: null,
      physicalAddress: null,
    }) as unknown as User;

  const userRepo = () => ({
    findOne: jest.fn(({ where }: any) =>
      Promise.resolve(users.get(where.id) ?? null),
    ),
    save: jest.fn((user: User) => {
      users.set(user.id, user);
      return Promise.resolve(user);
    }),
  });

  const kycRepo = () => ({
    create: jest.fn((data: Partial<KycSubmission>) => data as KycSubmission),
    save: jest.fn((submission: KycSubmission) => {
      submissions.push(submission);
      return Promise.resolve(submission);
    }),
    findOne: jest.fn(({ order }: any) => {
      if (!submissions.length) return Promise.resolve(null);
      const sorted = [...submissions].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      void order;
      return Promise.resolve(sorted[0]);
    }),
  });

  beforeEach(() => {
    users = new Map();
    const user = mockUser();
    users.set(user.id, user);
    submissions = [];

    service = new Sep12Service(
      userRepo() as any,
      kycRepo() as any,
      { get: jest.fn().mockReturnValue('true') } as unknown as ConfigService,
      {
        setContext: jest.fn(),
        info: jest.fn(),
      } as unknown as PinoLogger,
    );
  });

  it('maps internal KYC fields to the SEP-12 schema', () => {
    const mapped = mapInternalKycToSep12({
      firstName: 'Ada',
      lastName: 'Investor',
      dateOfBirth: '1990-05-20',
      nationalIdNumber: '12345678',
      nationalIdType: 'national_id',
      addressLine1: '1 Market Street',
      countryCode: 'NG',
    });

    expect(mapped).toEqual({
      first_name: 'Ada',
      last_name: 'Investor',
      birth_date: '1990-05-20',
      id_number: '12345678',
      id_type: 'national_id',
      address: { line1: '1 Market Street', country_code: 'NG' },
    });
  });

  it('stores both formats on PUT and returns SEP-12 compliant JSON on GET', async () => {
    await service.putCustomer('user-1', {
      firstName: 'Ada',
      lastName: 'Investor',
      dateOfBirth: '1990-05-20',
      nationalIdNumber: '12345678',
      nationalIdType: 'national_id',
      addressLine1: '1 Market Street',
      countryCode: 'NG',
    } as any);

    // Both formats persisted
    expect(users.get('user-1').fullName).toBe('Ada Investor');
    expect(users.get('user-1').birthdate).toBe('1990-05-20');
    expect(submissions[0].sep12Data).toMatchObject({
      first_name: 'Ada',
      birth_date: '1990-05-20',
      id_type: 'national_id',
    });

    const customer = await service.getCustomer('user-1');

    // SEP-12 compliant response shape and field types
    expect(customer.first_name).toBe('Ada');
    expect(customer.last_name).toBe('Investor');
    expect(customer.birth_date).toBe('1990-05-20');
    expect(customer.birth_date).toMatch(/^\d{4}-\d{2}-\d{2}$/); // ISO 8601
    expect(customer.address?.country_code).toBe('NG');
    expect(customer.address?.country_code).toMatch(/^[A-Za-z]{2}$/); // ISO 3166-1 alpha-2
    expect(customer.address?.line1).toBe('1 Market Street');
    expect(customer.id_number).toBe('12345678');
    expect(customer.id_type).toBe('national_id');
    expect(['ACCEPTED', 'PROCESSING', 'VERIFIED', 'REJECTED']).toContain(
      customer.status,
    );
  });

  it('rejects non-ISO 8601 dates and non-alpha-2 country codes', async () => {
    await expect(
      service.putCustomer('user-1', { dateOfBirth: 'May 20th 1990' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.putCustomer('user-1', { countryCode: 'NGA' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('only lets admins fetch other customers by id', async () => {
    await service.putCustomer('user-1', { firstName: 'Ada' } as any);

    const requester = users.get('user-1');
    const customer = await service.getCustomerById(requester, 'user-1');
    expect(customer.first_name).toBe('Ada');

    await expect(
      service.getCustomerById(requester, 'someone-else'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
