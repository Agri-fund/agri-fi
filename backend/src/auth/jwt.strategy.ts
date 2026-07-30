import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Request } from 'express';
import { User } from './entities/user.entity';
import { TokenBlocklistService } from './token-blocklist.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  tokenVersion?: number;
  typ?: 'access' | 'refresh';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly tokenBlocklistService: TokenBlocklistService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: JwtPayload): Promise<User> {
    const rawToken = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    if (
      rawToken &&
      (await this.tokenBlocklistService.isBlocklisted(rawToken))
    ) {
      throw new UnauthorizedException('Token has been revoked.');
    }

    if (payload.typ === 'refresh') {
      throw new UnauthorizedException(
        'Refresh tokens cannot be used as access tokens.',
      );
    }
    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException();
    if ((payload.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) {
      throw new UnauthorizedException('Token no longer valid.');
    }
    return user;
  }
}
