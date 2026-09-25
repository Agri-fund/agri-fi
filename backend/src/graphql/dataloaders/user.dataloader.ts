/**
 * User DataLoader.
 *
 * Batches individual user lookups that would otherwise produce N+1 queries
 * when resolving the `farmer` / `trader` / `investor` fields on nested types.
 *
 * Each GraphQL request gets a fresh DataLoader instance (created in
 * GraphQLModule's `context` factory) so cached data never leaks between
 * requests.
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import DataLoader from 'dataloader';
import { User } from '../../auth/entities/user.entity';
import { GqlUser } from '../graphql.types';

export type UserDataLoaderType = DataLoader<string, GqlUser | null>;

/** Map a User entity to a GqlUser, omitting sensitive fields. */
function toGqlUser(user: User): GqlUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    country: user.country,
    kycStatus: user.kycStatus,
    walletAddress: user.walletAddress,
    isCompany: user.isCompany,
    isEmailVerified: user.isEmailVerified,
    isMfaEnabled: user.isMfaEnabled,
    creditScore: user.creditScore,
    preferredLanguage: user.preferredLanguage,
    timezone: user.timezone,
    emailDigestEnabled: user.emailDigestEnabled,
    createdAt: user.createdAt,
  };
}

@Injectable()
export class UserDataLoaderService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /**
   * Create a new DataLoader for a single request scope.
   * Call this once per incoming GraphQL request inside the `context` factory.
   */
  createLoader(): UserDataLoaderType {
    return new DataLoader<string, GqlUser | null>(
      async (ids: readonly string[]) => {
        const users = await this.userRepo.find({
          where: { id: In([...ids]) },
        });

        const userMap = new Map<string, GqlUser>(
          users.map((u) => [u.id, toGqlUser(u)]),
        );

        // DataLoader requires results to be returned in the same order as keys.
        return ids.map((id) => userMap.get(id) ?? null);
      },
      { cache: true },
    );
  }
}
