import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class OptionalJwtGuard extends AuthGuard('jwt') {
  handleRequest<T>(_err: unknown, user: T): T {
    return user; // return null/undefined instead of throwing when no token
  }

  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }
}
