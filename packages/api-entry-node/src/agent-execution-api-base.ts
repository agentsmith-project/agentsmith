function sanitizeBaseUrl(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, '');
}

export function resolveConfiguredPublicApiBase(): string | null {
  return sanitizeBaseUrl(process.env.PUBLIC_API_BASE_URL);
}

export function resolveRequiredConfiguredPublicApiBase(): string {
  const configured = resolveConfiguredPublicApiBase();
  if (configured) return configured;
  const error = new Error('agent_execution_api_base_not_configured');
  (error as Error & { code?: string }).code = 'AGENT_EXECUTION_API_BASE_NOT_CONFIGURED';
  throw error;
}
