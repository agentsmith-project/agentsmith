export type SharedOpsResultFilter = 'ok' | 'error';
export type SharedOpsErrorClassFilter = 'provider_retryable' | 'provider_non_retryable' | 'system_error';

export type SharedOpsFilterContext = {
  start_time: string;
  end_time: string;
  provider?: string;
  model?: string;
  result?: SharedOpsResultFilter;
  error_class?: SharedOpsErrorClassFilter;
};

type SearchParamReader = {
  get: (key: string) => string | null;
};

export function parseSharedOpsFilterContext(searchParams: SearchParamReader): Partial<SharedOpsFilterContext> {
  const resultValue = searchParams.get('result');
  const errorClassValue = searchParams.get('error_class');
  const parsed: Partial<SharedOpsFilterContext> = {};
  const startTime = searchParams.get('start_time');
  const endTime = searchParams.get('end_time');
  const provider = searchParams.get('provider');
  const model = searchParams.get('model');

  if (startTime) parsed.start_time = startTime;
  if (endTime) parsed.end_time = endTime;
  if (provider) parsed.provider = provider;
  if (model) parsed.model = model;
  if (resultValue === 'ok' || resultValue === 'error') parsed.result = resultValue;
  if (
    errorClassValue === 'provider_retryable'
    || errorClassValue === 'provider_non_retryable'
    || errorClassValue === 'system_error'
  ) {
    parsed.error_class = errorClassValue;
  }

  return parsed;
}

export function buildSharedOpsFilterQuery(
  filters: Partial<SharedOpsFilterContext>,
  extras: Record<string, string | undefined> = {},
): string {
  const query = new URLSearchParams();
  const entries = {
    start_time: filters.start_time,
    end_time: filters.end_time,
    provider: filters.provider,
    model: filters.model,
    result: filters.result,
    error_class: filters.error_class,
    ...extras,
  };

  Object.entries(entries).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });

  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}
