import { compareOpenApiDocuments } from '../generate-openapi';

const route = '/v1/investments';

function document(operation: Record<string, unknown>) {
  return {
    paths: {
      [route]: {
        post: operation,
      },
    },
  };
}

const validOperation = {
  operationId: 'InvestmentsController_create',
  parameters: [
    {
      name: 'dryRun',
      in: 'query',
      required: false,
      schema: { type: 'boolean' },
    },
  ],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: { amount: { type: 'number' } },
        },
      },
    },
  },
  responses: {
    '201': {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { id: { type: 'string' } },
          },
        },
      },
    },
  },
};

describe('OpenAPI route contract check', () => {
  it('accepts matching v1 route schemas and operation metadata', () => {
    expect(
      compareOpenApiDocuments(
        document(validOperation),
        document(validOperation),
      ),
    ).toEqual([]);
  });

  it('reports routes without request and successful response schemas', () => {
    const undocumented = {
      ...validOperation,
      requestBody: {
        required: true,
        content: { 'application/json': {} },
      },
      responses: { '201': { description: 'Created' } },
    };

    expect(
      compareOpenApiDocuments(document(undocumented), document(undocumented)),
    ).toEqual(
      expect.arrayContaining([
        `POST ${route}: request body is missing a schema`,
        `POST ${route}: no successful response has a documented schema`,
      ]),
    );
    expect(
      compareOpenApiDocuments(document(validOperation), document(undocumented)),
    ).toContain(
      `POST ${route} (openapi.json): no successful response has a documented schema`,
    );
  });

  it('reports operation ID, status, request, and response schema drift', () => {
    const changed = {
      ...validOperation,
      operationId: 'InvestmentsController_createNew',
      requestBody: {
        ...validOperation.requestBody,
        content: { 'application/json': { schema: { type: 'string' } } },
      },
      responses: {
        '202': {
          content: {
            'application/json': { schema: { type: 'string' } },
          },
        },
      },
    };

    expect(
      compareOpenApiDocuments(document(validOperation), document(changed)),
    ).toEqual(
      expect.arrayContaining([
        `POST ${route}: operationId differs (generated: InvestmentsController_create, documented: InvestmentsController_createNew)`,
        `POST ${route}: response status codes differ`,
        `POST ${route}: request schema differs`,
        `POST ${route}: response schemas differ`,
      ]),
    );
  });

  it('ignores routes outside the v1 API', () => {
    const generated = {
      paths: {
        ...document(validOperation).paths,
        '/health': { get: validOperation },
      },
    };
    expect(
      compareOpenApiDocuments(generated, document(validOperation)),
    ).toEqual([]);
  });

  it('does not pass when generation produces no v1 operations', () => {
    expect(compareOpenApiDocuments({ paths: {} }, { paths: {} })).toContain(
      'No v1 operations were generated from the live route definitions',
    );
  });

  it('allows a successful 204 response with no body schema', () => {
    const noContent = {
      ...validOperation,
      requestBody: undefined,
      responses: { '204': { description: 'No Content' } },
    };
    expect(
      compareOpenApiDocuments(document(noContent), document(noContent)),
    ).toEqual([]);
  });
});
