export interface PublicRuntimeConfig {
  apiBase: string;
  keycloakUrl: string;
  keycloakRealm: string;
  keycloakClientId: string;
  useMsw: boolean;
  mswStrictReady: boolean;
  sseTicketEnabled: boolean;
  sseTicketPercentage: number;
  sseAllowJwtFallback: boolean;
  trustedImageDomains: string[];
  bypassAuth: boolean;
  notebookSseDebugPanel: boolean;
  docFixtures: boolean;
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return value.trim().toLowerCase() === 'true' || value.trim() === '1';
}

function parseInteger(value: string | undefined, fallback = 0): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function readPublicRuntimeConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PublicRuntimeConfig {
  return {
    apiBase: (env.NEXT_PUBLIC_API_BASE ?? '').trim(),
    keycloakUrl: (env.NEXT_PUBLIC_KEYCLOAK_URL ?? '').trim(),
    keycloakRealm: (env.NEXT_PUBLIC_KEYCLOAK_REALM ?? '').trim(),
    keycloakClientId: (env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? '').trim(),
    useMsw: parseBoolean(env.NEXT_PUBLIC_USE_MSW),
    mswStrictReady: parseBoolean(env.NEXT_PUBLIC_MSW_STRICT_READY),
    sseTicketEnabled: parseBoolean(env.NEXT_PUBLIC_SSE_TICKET_ENABLED),
    sseTicketPercentage: parseInteger(env.NEXT_PUBLIC_SSE_TICKET_PERCENTAGE, 0),
    sseAllowJwtFallback: parseBoolean(env.NEXT_PUBLIC_SSE_ALLOW_JWT_FALLBACK),
    trustedImageDomains: parseCsv(env.NEXT_PUBLIC_TRUSTED_IMAGE_DOMAINS),
    bypassAuth: parseBoolean(env.NEXT_PUBLIC_BYPASS_AUTH),
    notebookSseDebugPanel: parseBoolean(env.NEXT_PUBLIC_NOTEBOOK_SSE_DEBUG_PANEL),
    docFixtures: parseBoolean(env.NEXT_PUBLIC_DOC_FIXTURES),
  };
}

export function getPublicRuntimeConfig(): PublicRuntimeConfig {
  if (typeof window !== 'undefined' && window.__MBOS_PUBLIC_RUNTIME_CONFIG__) {
    return window.__MBOS_PUBLIC_RUNTIME_CONFIG__;
  }
  return readPublicRuntimeConfigFromEnv(process.env);
}

export function serializePublicRuntimeConfigScript(config: PublicRuntimeConfig): string {
  const serialized = JSON.stringify(config).replace(/</g, '\\u003c');
  return `window.__MBOS_PUBLIC_RUNTIME_CONFIG__ = ${serialized};`;
}
