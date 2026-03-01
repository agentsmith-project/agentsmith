import { describe, expect, it } from 'vitest';
import { buildSharedOpsFilterQuery, parseSharedOpsFilterContext } from '@/lib/ops-filter-context';

describe('ops filter context', () => {
  it('parses only supported shared filters', () => {
    const params = new URLSearchParams({
      start_time: '2026-03-01T00:00:00.000Z',
      end_time: '2026-03-02T00:00:00.000Z',
      provider: 'openai',
      model: 'gpt-4o',
      result: 'error',
      error_class: 'provider_retryable',
      ignored: 'value',
    });

    expect(parseSharedOpsFilterContext(params)).toEqual({
      start_time: '2026-03-01T00:00:00.000Z',
      end_time: '2026-03-02T00:00:00.000Z',
      provider: 'openai',
      model: 'gpt-4o',
      result: 'error',
      error_class: 'provider_retryable',
    });
  });

  it('builds a query string from shared filters and extras', () => {
    expect(buildSharedOpsFilterQuery(
      {
        start_time: '2026-03-01T00:00:00.000Z',
        end_time: '2026-03-02T00:00:00.000Z',
        provider: 'openai',
        result: 'ok',
      },
      { panel: 'usage' },
    )).toBe('?start_time=2026-03-01T00%3A00%3A00.000Z&end_time=2026-03-02T00%3A00%3A00.000Z&provider=openai&result=ok&panel=usage');
  });
});
