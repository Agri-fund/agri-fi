import { HttpException, HttpStatus } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function buildMockResponse() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { status, json, mockStatus: status, mockJson: json };
}

function buildMockRequest(method = 'GET', url = '/test') {
  return { method, url };
}

function buildMockHost(
  request: object,
  response: ReturnType<typeof buildMockResponse>,
) {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as any;
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  it('maps a 400 BadRequest to the correct JSON shape', () => {
    const response = buildMockResponse();
    const host = buildMockHost(buildMockRequest(), response);
    const exception = new HttpException('Bad input', HttpStatus.BAD_REQUEST);

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Bad input',
      }),
    );
  });

  it('maps a 401 Unauthorized exception', () => {
    const response = buildMockResponse();
    const host = buildMockHost(buildMockRequest(), response);
    const exception = new HttpException(
      'Unauthorized',
      HttpStatus.UNAUTHORIZED,
    );

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: HttpStatus.UNAUTHORIZED }),
    );
  });

  it('maps a 404 NotFoundException', () => {
    const response = buildMockResponse();
    const host = buildMockHost(buildMockRequest('GET', '/deals/999'), response);
    const exception = new HttpException('Not found', HttpStatus.NOT_FOUND);

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
  });

  it('maps a 500 InternalServerError', () => {
    const response = buildMockResponse();
    const host = buildMockHost(buildMockRequest('POST', '/invest'), response);
    const exception = new HttpException(
      'Internal server error',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  });

  it('includes path and timestamp in the response body', () => {
    const response = buildMockResponse();
    const host = buildMockHost(buildMockRequest('GET', '/api/deals'), response);
    const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);

    filter.catch(exception, host);

    const body = response.json.mock.calls[0][0] as Record<string, unknown>;
    expect(body).toHaveProperty('path');
    expect(body).toHaveProperty('timestamp');
  });
});
