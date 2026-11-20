#!/usr/bin/env node

/**
 * Generate OpenAPI specification from NestJS application
 * This script generates the openapi.json file for API documentation
 *
 * Usage: node generate-openapi.js
 */

const fs = require('fs');
const path = require('path');

async function generateOpenApiDocument() {
  // Set minimal environment to prevent DB initialization errors
  process.env.NODE_ENV = 'development';
  process.env.PORT = '0'; // Don't actually listen
  process.env.DATABASE_URL = 'postgresql://localhost/dummy'; // Dummy URL
  process.env.JWT_SECRET = 'dummy-secret-for-spec-generation';
  process.env.RABBITMQ_URL = 'amqp://localhost:5672';
  process.env.LOG_LEVEL = 'error';

  // Import after env vars set
  const { NestFactory } = require('@nestjs/core');
  const { VersioningType } = require('@nestjs/common');
  const { SwaggerModule } = require('@nestjs/swagger');
  const { AppModule } = require('./dist/src/app.module');
  const {
    buildOpenApiConfig,
  } = require('./dist/src/common/swagger/swagger.config');

  const app = await NestFactory.create(AppModule, {
    logger: ['error'],
  });

  try {
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });

    // Configure Swagger using the same shared config as main.ts, plus
    // server URLs which only make sense for the static export.
    const config = buildOpenApiConfig()
      .addServer('http://localhost:3001', 'Development Server')
      .addServer('https://api.agri-fi.example.com', 'Production Server')
      .build();

    return SwaggerModule.createDocument(app, config);
  } finally {
    await app.close();
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

function isV1Path(routePath) {
  return (
    routePath === '/v1' ||
    routePath.startsWith('/v1/') ||
    routePath === '/api/v1' ||
    routePath.startsWith('/api/v1/')
  );
}

function getV1Operations(document) {
  const operations = new Map();
  const methods = new Set([
    'get',
    'post',
    'put',
    'patch',
    'delete',
    'options',
    'head',
  ]);

  for (const [routePath, pathItem] of Object.entries(document.paths ?? {})) {
    if (!isV1Path(routePath)) {
      continue;
    }
    for (const [method, operation] of Object.entries(pathItem)) {
      if (methods.has(method)) {
        operations.set(`${method.toUpperCase()} ${routePath}`, operation);
      }
    }
  }

  return operations;
}

function operationSchemas(operation, route) {
  const errors = [];
  const requestBody = operation.requestBody;

  if (requestBody) {
    const requestSchemas = Object.values(requestBody.content ?? {}).map(
      (content) => content.schema,
    );
    if (
      requestSchemas.length === 0 ||
      requestSchemas.some((schema) => !schema)
    ) {
      errors.push(`${route}: request body is missing a schema`);
    }
  }

  for (const parameter of operation.parameters ?? []) {
    if (!parameter.schema && !parameter.content) {
      errors.push(
        `${route}: ${parameter.in} parameter "${parameter.name}" is missing a schema`,
      );
    }
  }

  const responses = operation.responses ?? {};
  const successResponses = Object.entries(responses).filter(([status]) =>
    /^2\d\d$/.test(status),
  );
  const hasSuccessSchema = successResponses.some(([, response]) =>
    Object.values(response.content ?? {}).some((content) => content.schema),
  );

  const isNoContentResponse = successResponses.some(
    ([status, response]) =>
      status === '204' && Object.keys(response.content ?? {}).length === 0,
  );
  if (!hasSuccessSchema && !isNoContentResponse) {
    errors.push(`${route}: no successful response has a documented schema`);
  }

  for (const [status, response] of Object.entries(responses)) {
    for (const [contentType, content] of Object.entries(
      response.content ?? {},
    )) {
      if (!content.schema) {
        errors.push(
          `${route}: response ${status} (${contentType}) is missing a schema`,
        );
      }
    }
  }

  return errors;
}

function compareOpenApiDocuments(generated, committed) {
  const errors = [];
  const generatedOperations = getV1Operations(generated);
  const committedOperations = getV1Operations(committed);

  if (generatedOperations.size === 0) {
    errors.push(
      'No v1 operations were generated from the live route definitions',
    );
  }

  for (const route of generatedOperations.keys()) {
    if (!committedOperations.has(route)) {
      errors.push(
        `${route}: generated route is missing from backend/openapi.json`,
      );
    }
  }
  for (const route of committedOperations.keys()) {
    if (!generatedOperations.has(route)) {
      errors.push(
        `${route}: documented route is missing from live route definitions`,
      );
    }
  }

  for (const [route, generatedOperation] of generatedOperations) {
    const committedOperation = committedOperations.get(route);
    if (!committedOperation) {
      continue;
    }

    for (const error of operationSchemas(generatedOperation, route)) {
      errors.push(error);
    }

    for (const error of operationSchemas(
      committedOperation,
      `${route} (openapi.json)`,
    )) {
      errors.push(error);
    }

    if (!generatedOperation.operationId) {
      errors.push(`${route}: generated operation is missing an operationId`);
    }
    if (!committedOperation.operationId) {
      errors.push(`${route}: documented operation is missing an operationId`);
    }
    if (generatedOperation.operationId !== committedOperation.operationId) {
      errors.push(
        `${route}: operationId differs (generated: ${generatedOperation.operationId ?? 'missing'}, documented: ${committedOperation.operationId ?? 'missing'})`,
      );
    }

    const generatedResponses = generatedOperation.responses ?? {};
    const committedResponses = committedOperation.responses ?? {};
    if (
      stableJson(Object.keys(generatedResponses).sort()) !==
      stableJson(Object.keys(committedResponses).sort())
    ) {
      errors.push(`${route}: response status codes differ`);
    }

    const requestShape = (operation) => ({
      requestBody: operation.requestBody
        ? {
            required: operation.requestBody.required,
            content: Object.fromEntries(
              Object.entries(operation.requestBody.content ?? {}).map(
                ([type, content]) => [type, content.schema],
              ),
            ),
          }
        : undefined,
      parameters: (operation.parameters ?? [])
        .map(({ name, in: location, required, schema, content }) => ({
          name,
          in: location,
          required,
          schema,
          content,
        }))
        .sort((left, right) =>
          `${left.in}:${left.name}`.localeCompare(`${right.in}:${right.name}`),
        ),
    });

    if (
      stableJson(requestShape(generatedOperation)) !==
      stableJson(requestShape(committedOperation))
    ) {
      errors.push(`${route}: request schema differs`);
    }

    const responseSchemas = (responses) =>
      Object.fromEntries(
        Object.entries(responses).map(([status, response]) => [
          status,
          Object.fromEntries(
            Object.entries(response.content ?? {}).map(([type, content]) => [
              type,
              content.schema,
            ]),
          ),
        ]),
      );

    if (
      stableJson(responseSchemas(generatedResponses)) !==
      stableJson(responseSchemas(committedResponses))
    ) {
      errors.push(`${route}: response schemas differ`);
    }
  }

  return errors;
}

async function main() {
  try {
    const generated = await generateOpenApiDocument();
    const outputPath = path.join(__dirname, 'openapi.json');

    if (process.argv.includes('--check')) {
      const committed = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      const errors = compareOpenApiDocuments(generated, committed);
      if (errors.length > 0) {
        console.error(
          `OpenAPI contract check failed with ${errors.length} issue(s):\n- ${errors.join('\n- ')}`,
        );
        process.exitCode = 1;
        return;
      }
      console.log(
        `OpenAPI contract check passed (${getV1Operations(generated).size} v1 operations).`,
      );
      return;
    }

    fs.writeFileSync(outputPath, JSON.stringify(generated, null, 2), 'utf-8');
    console.log(`✓ OpenAPI specification generated: ${outputPath}`);
    console.log(
      `✓ Total endpoints: ${Object.keys(generated.paths ?? {}).length}`,
    );
  } catch (error) {
    console.error('✗ Error generating OpenAPI spec:', error.message);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exitCode = 1;
  }
}

module.exports = {
  compareOpenApiDocuments,
  generateOpenApiDocument,
};

if (require.main === module) {
  main();
}
