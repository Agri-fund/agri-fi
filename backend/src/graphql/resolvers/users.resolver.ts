/**
 * Users Resolver.
 *
 * Exposes:
 *  - Query.user(id) — fetch a user by UUID.
 *    Admins can look up any user; regular users can only fetch themselves.
 *
 * Authentication: GqlAuthGuard (JWT Bearer)
 */
import { Resolver, Query, Args, ID } from '@nestjs/graphql';
import { UseGuards, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { GqlUser } from '../graphql.types';
import { GqlAuthGuard } from '../graphql.auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

function mapUser(u: User): GqlUser {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    country: u.country,
    kycStatus: u.kycStatus,
    walletAddress: u.walletAddress,
    isCompany: u.isCompany,
    isEmailVerified: u.isEmailVerified,
    isMfaEnabled: u.isMfaEnabled,
    creditScore: u.creditScore,
    preferredLanguage: u.preferredLanguage,
    timezone: u.timezone,
    emailDigestEnabled: u.emailDigestEnabled,
    createdAt: u.createdAt,
  };
}

@Resolver(() => GqlUser)
@UseGuards(GqlAuthGuard)
export class UsersResolver {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  @Query(() => GqlUser, {
    name: 'user',
    description:
      'Fetch a user by UUID. Admins may look up any user; others may only fetch themselves.',
  })
  async user(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() currentUser: User,
  ): Promise<GqlUser> {
    // Non-admin users can only fetch their own profile.
    if (currentUser.role !== 'admin' && currentUser.id !== id) {
      throw new ForbiddenException('You may only view your own profile.');
    }

    const entity = await this.userRepo.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException(`User ${id} not found.`);
    }
    return mapUser(entity);
  }
}
