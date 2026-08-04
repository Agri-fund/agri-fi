import { Global, Module } from '@nestjs/common';
import { CircuitBreakerFactory } from './circuit-breaker.factory';

@Global()
@Module({
  providers: [CircuitBreakerFactory],
  exports: [CircuitBreakerFactory],
})
export class CircuitBreakerModule {}
