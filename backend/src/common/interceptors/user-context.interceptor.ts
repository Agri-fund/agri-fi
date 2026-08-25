import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Observable } from 'rxjs';

/**
 * Stores the authenticated user's id in CLS so code outside the request
 * pipeline (e.g. TypeORM subscribers) can attribute changes to the acting
 * user. Runs after guards, since Passport populates req.user during
 * AuthGuard('jwt').canActivate(). No-ops on unauthenticated routes.
 */
@Injectable()
export class UserContextInterceptor implements NestInterceptor {
  constructor(private readonly cls: ClsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const userId = request?.user?.id;
    if (userId) {
      try {
        this.cls.set('userId', userId);
      } catch {
        // CLS context not available for this request type — skip.
      }
    }
    return next.handle();
  }
}
