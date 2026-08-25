import { DocumentBuilder } from '@nestjs/swagger';

/**
 * Single source of truth for the OpenAPI document config, shared by
 * main.ts (live /api/docs UI) and generate-openapi.js (static spec export)
 * so the two never drift out of sync. Returns an unbuilt DocumentBuilder
 * so callers can append extra config (e.g. addServer) before calling .build().
 */
export function buildOpenApiConfig(): DocumentBuilder {
  return new DocumentBuilder()
    .setTitle('Agri-Fi API')
    .setDescription(
      'REST API for the Agri-Fi agricultural trade finance platform. ' +
        'Farmers list produce, traders create deals, investors fund them via Stellar escrow.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'jwt',
    )
    .addTag('auth', 'Registration, login, KYC, and wallet linking')
    .addTag('admin', 'Administrative operations')
    .addTag('trade-deals', 'Create and browse agricultural trade deals')
    .addTag('investments', 'Fund trade deals and manage investments')
    .addTag('shipments', 'Record and query shipment milestones')
    .addTag('documents', 'Upload trade documents to IPFS')
    .addTag('users', 'User dashboard data')
    .addTag('stellar', 'Stellar network integration')
    .addTag('soroban', 'Soroban smart contract campaigns')
    .addTag('sep12', 'SEP-12 KYC info exchange')
    .addTag('sep24', 'SEP-24 interactive deposit and withdrawal')
    .addTag('health', 'System health status')
    .addTag('config', 'Runtime configuration');
}
