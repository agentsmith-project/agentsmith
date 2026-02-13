import type http from 'node:http';
import { describe, expect, it } from 'vitest';
import { handleApiDocsRoute } from './api-docs-handler.js';

function createResponseCapture(): {
  res: http.ServerResponse;
  state: { statusCode: number; headers: Record<string, string>; body: string };
} {
  const state = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
  };
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string) {
      state.headers[name.toLowerCase()] = value;
    },
    end(payload?: string | Buffer) {
      if (typeof payload === 'string') {
        state.body = payload;
      } else if (payload) {
        state.body = payload.toString('utf-8');
      }
    },
  } as unknown as http.ServerResponse;
  return { res, state };
}

describe('handleApiDocsRoute', () => {
  it('serves openapi json', () => {
    const { res, state } = createResponseCapture();
    const handled = handleApiDocsRoute(
      {} as http.IncomingMessage,
      res,
      new URL('http://localhost/api/v1/openapi.json'),
      (response, status, data) => {
        response.statusCode = status;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.end(JSON.stringify(data));
      },
    );

    expect(handled).toBe(true);
    expect(state.headers['content-type']).toContain('application/json');
    expect(state.body).toContain('openapi');
  });

  it('serves docs html', () => {
    const { res, state } = createResponseCapture();
    const handled = handleApiDocsRoute(
      {} as http.IncomingMessage,
      res,
      new URL('http://localhost/docs'),
      () => {
        throw new Error('json should not be called');
      },
    );

    expect(handled).toBe(true);
    expect(state.headers['content-type']).toContain('text/html');
    expect(state.body).toContain('Scalar.createApiReference');
    expect(state.body).toContain('/docs/asyncapi');
  });

  it('serves asyncapi viewer html', () => {
    const { res, state } = createResponseCapture();
    const handled = handleApiDocsRoute(
      {} as http.IncomingMessage,
      res,
      new URL('http://localhost/docs/asyncapi'),
      () => {
        throw new Error('json should not be called');
      },
    );

    expect(handled).toBe(true);
    expect(state.headers['content-type']).toContain('text/html');
    expect(state.body).toContain('AsyncAPI Viewer');
    expect(state.body).toContain('/api/v1/asyncapi.json');
  });
});
