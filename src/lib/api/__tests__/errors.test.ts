import { describe, expect, it } from 'vitest';
import { APIError, resolveApiErrorPresentation, resolveErrorMessageByCode } from '@/lib/api/errors';

describe('resolveErrorMessageByCode', () => {
  it('returns mapped message when code exists', () => {
    const message = resolveErrorMessageByCode(
      'AGENT_TIMEOUT',
      { AGENT_TIMEOUT: 'agent timeout' },
      'fallback',
    );
    expect(message).toBe('agent timeout');
  });

  it('returns fallback when code is missing', () => {
    const message = resolveErrorMessageByCode(
      'UNKNOWN',
      { AGENT_TIMEOUT: 'agent timeout' },
      'fallback',
    );
    expect(message).toBe('fallback');
  });
});

describe('resolveApiErrorPresentation', () => {
  const t = (key: string) => {
    const dict: Record<string, string> = {
      'agentProtocol.title': 'Agent Protocol Error',
      'agentProtocol.description': 'The external agent returned an invalid protocol payload.',
      'rateLimitError.title': 'Too Many Requests',
      'rateLimitError.description': 'Please wait a moment before trying again.',
      'unknown.title': 'Error',
      'unknown.description': 'An unexpected error occurred.',
    };
    return dict[key] ?? key;
  };

  it('maps external agent protocol code to dedicated copy', () => {
    const presentation = resolveApiErrorPresentation({
      error: new APIError('AGENT_PROTOCOL_ERROR', 'agent_response_delta_invalid', 'req-1', 502),
      t,
    });
    expect(presentation.title).toBe('Agent Protocol Error');
    expect(presentation.description).toBe('The external agent returned an invalid protocol payload.');
  });

  it('supports 429 translation key rateLimitError.*', () => {
    const presentation = resolveApiErrorPresentation({
      error: new APIError('RATE_LIMIT_EXCEEDED', 'Too many requests', 'req-2', 429),
      t,
    });
    expect(presentation.title).toBe('Too Many Requests');
    expect(presentation.description).toBe('Please wait a moment before trying again.');
  });
});
