import { describe, expect, it } from 'vitest';
import { mapRequestError } from './error-mapper.js';

describe('mapRequestError', () => {
  it('maps known not-found errors to 404 resource_not_found', () => {
    const mapped = mapRequestError(new Error('project_not_found'));
    expect(mapped).toEqual({
      status: 404,
      body: {
        code: 'RESOURCE_NOT_FOUND',
        message: 'project_not_found',
      },
    });
  });

  it('maps source-library mismatch to 422 validation error', () => {
    const mapped = mapRequestError(new Error('source_library_mismatch'));
    expect(mapped).toEqual({
      status: 422,
      body: {
        code: 'VALIDATION_ERROR',
        message: 'source_library_mismatch',
      },
    });
  });

  it('maps unknown errors to 400 validation error', () => {
    const mapped = mapRequestError(new Error('invalid_payload'));
    expect(mapped).toEqual({
      status: 400,
      body: {
        code: 'VALIDATION_ERROR',
        message: 'invalid_payload',
      },
    });
  });
});
