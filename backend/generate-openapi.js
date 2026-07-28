#!/usr/bin/env node

/**
 * Generate OpenAPI specification from NestJS application
 * This script generates the openapi.json file for API documentation
 * 
 * Usage: node generate-openapi.js
 */

const fs = require('fs');
const path = require('path');

async function generateOpenApiSpec() {
  try {
    // Set minimal environment to prevent DB initialization errors
    process.env.NODE_ENV = 'development';
    process.env.PORT = '0'; // Don't actually listen
    process.env.DATABASE_URL = 'postgresql://localhost/dummy'; // Dummy URL
    process.env.JWT_SECRET = 'dummy-secret-for-spec-generation';
    process.env.RABBITMQ_URL = 'amqp://localhost:5672';

    // Suppress NestJS logs
    process.env.LOG_LEVEL = 'error';

    // Import after env vars set
    const { NestFactory } = require('@nestjs/core');
    const { SwaggerModule } = require('@nestjs/swagger');
    const { AppModule } = require('./dist/src/app.module');
    const {
      buildOpenApiConfig,
    } = require('./dist/src/common/swagger/swagger.config');

    // Create app without starting it
    const app = await NestFactory.create(AppModule, {
      logger: ['error'],
    });

    // Configure Swagger using the same shared config as main.ts, plus
    // server URLs which only make sense for the static export.
    const config = buildOpenApiConfig()
      .addServer('http://localhost:3001', 'Development Server')
      .addServer('https://api.agri-fi.example.com', 'Production Server')
      .build();

    // Generate the document
    const document = SwaggerModule.createDocument(app, config);

    // Write to file
    const outputPath = path.join(__dirname, 'openapi.json');
    fs.writeFileSync(outputPath, JSON.stringify(document, null, 2), 'utf-8');

    console.log(`✓ OpenAPI specification generated: ${outputPath}`);
    console.log(`✓ Total endpoints: ${Object.keys(document.paths).length}`);

    // Close app
    await app.close();

    // Exit without errors
    process.exit(0);
  } catch (error) {
    console.error('✗ Error generating OpenAPI spec:', error.message);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the generator
generateOpenApiSpec().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
