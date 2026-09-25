import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class VersionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const version =
      request.params?.version ??
      request.route?.path?.match(/\/v(\d+)\//)?.[1] ??
      '1';

    return next.handle().pipe(
      tap(() => {
        response.setHeader('API-Version', `v${version}`);
      }),
    );
  }
}
