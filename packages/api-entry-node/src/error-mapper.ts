import { ErrorResponseSchema } from '@mbos/contracts';

interface MappedErrorResponse {
  status: number;
  body: {
    error_code: string;
    message: string;
  };
}

const NOT_FOUND_ERRORS = new Set([
  'project_not_found',
  'source_not_found',
  'source_library_not_found',
  'ai_ready_job_not_found',
]);

export function mapRequestError(error: unknown): MappedErrorResponse {
  const message = error instanceof Error ? error.message : 'Unknown error';

  if (NOT_FOUND_ERRORS.has(message)) {
    return {
      status: 404,
      body: { error_code: 'RESOURCE_NOT_FOUND', message },
    };
  }

  if (message === 'source_library_mismatch') {
    return {
      status: 422,
      body: { error_code: 'VALIDATION_ERROR', message },
    };
  }

  const parsed = ErrorResponseSchema.safeParse({
    error_code: 'VALIDATION_ERROR',
    message,
  });

  return {
    status: 400,
    body: parsed.success
      ? parsed.data
      : {
          error_code: 'BAD_REQUEST',
          message: 'Bad request',
        },
  };
}
