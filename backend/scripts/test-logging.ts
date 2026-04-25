import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from '../src/app.module';

async function testLogging() {
  const app = await NestFactory.create(AppModule, { 
    bufferLogs: true,
  });
  
  app.useLogger(app.get(Logger));
  
  const logger = app.get(Logger);
  
  // Simulate different log levels and structured data
  logger.log('Application started', 'Bootstrap');
  
  logger.info({ 
    userId: 'user-123', 
    dealId: 'deal-456', 
    amount: 1000 
  }, 'Investment created successfully');
  
  logger.warn({ 
    attempt: 2, 
    maxRetries: 3, 
    error: 'Network timeout' 
  }, 'Retrying Stellar transaction');
  
  logger.error({ 
    dealId: 'deal-789', 
    error: 'Insufficient funds',
    stellarError: 'op_underfunded'
  }, 'Failed to process investment');
  
  await app.close();
}

testLogging().catch(console.error);