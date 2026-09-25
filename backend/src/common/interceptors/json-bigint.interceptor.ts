import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/** Recursively converts BigInt values to strings in HTTP response bodies. */
@Injectable()
export class JsonBigIntInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(map((data) => this.serializeBigInts(data)));
  }

  private serializeBigInts(
    value: unknown,
    seen = new WeakSet<object>(),
  ): unknown {
    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (value === null || typeof value !== 'object') {
      return value;
    }

    // Prevent circular reference infinite recursion
    if (seen.has(value as object)) {
      return '[Circular]';
    }
    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.map((item) => this.serializeBigInts(item, seen));
    }

    // Preserve special built-in objects that JSON.stringify handles natively.
    // Converting them via Object.entries would corrupt them (e.g., Date -> {}).
    if (value instanceof Date) {
      return value;
    }
    if (value instanceof RegExp) {
      return value;
    }
    // Buffer check (Node.js)
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
      return value;
    }

    const objectTag = Object.prototype.toString.call(value);

    // Only recursively process plain objects.
    // For other objects (Map, Set, class instances, etc.), return as-is
    // and rely on their toJSON implementation or the global BigInt.toJSON shim.
    if (objectTag !== '[object Object]') {
      return value;
    }

    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = this.serializeBigInts(val, seen);
    }
    return result;
  }
}
