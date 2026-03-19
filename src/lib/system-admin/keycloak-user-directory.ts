import type { WorkspaceIdentitySnapshot } from './workspace-registry/types';

export interface KeycloakDirectoryUser {
  user_id: string;
  email: string;
  name: string | null;
}

export interface KeycloakIdpVerificationResult {
  idp_ok: boolean;
  directory_search_supported: boolean;
  advice_code?: 'DIRECTORY_PERMISSION_RECOMMENDED';
}

type KeycloakTokenResponse = {
  access_token?: string;
};

type KeycloakUserRecord = {
  id?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
};

const MOCK_KEYCLOAK_DIRECTORY_USERS: KeycloakDirectoryUser[] = [
  { user_id: 'kc-dev-admin', email: 'dev-admin@example.com', name: 'Dev Admin' },
  { user_id: 'kc-integration-user', email: 'integration-user@example.com', name: 'Integration User' },
  { user_id: 'kc-integration-member', email: 'integration-member@example.com', name: 'Integration Member' },
];

function shouldUseMockKeycloakDirectory(): boolean {
  return process.env.NEXT_PUBLIC_USE_MSW === 'true';
}

function deriveKeycloakBaseUrl(idpUrl: string): string {
  const trimmed = idpUrl.trim().replace(/\/+$/, '');
  const marker = '/realms';
  const markerIndex = trimmed.indexOf(marker);
  return markerIndex >= 0 ? trimmed.slice(0, markerIndex) : trimmed;
}

function buildDisplayName(user: KeycloakUserRecord): string | null {
  const first = user.firstName?.trim() ?? '';
  const last = user.lastName?.trim() ?? '';
  const fullName = [first, last].filter((item) => item.length > 0).join(' ').trim();
  if (fullName) return fullName;
  const username = user.username?.trim();
  return username || null;
}

async function getClientCredentialsToken(args: {
  idpUrl: string;
  realm: string;
  clientId: string;
  clientSecret?: string;
}): Promise<string> {
  const clientId = args.clientId.trim();
  const clientSecret = args.clientSecret?.trim() ?? '';
  if (!clientId || !clientSecret) {
    throw Object.assign(new Error('keycloak_client_credentials_required'), {
      code: 'KEYCLOAK_IDP_INVALID',
    });
  }
  const keycloakBaseUrl = deriveKeycloakBaseUrl(args.idpUrl);
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  let response: Response;
  try {
    response = await fetch(`${keycloakBaseUrl}/realms/${encodeURIComponent(args.realm.trim())}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      cache: 'no-store',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    throw Object.assign(new Error(`keycloak_client_token_failed:network:${message}`), {
      code: 'KEYCLOAK_DIRECTORY_UNAVAILABLE',
    });
  }

  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(new Error(`keycloak_client_token_failed:${response.status}:${text}`), {
      code: response.status === 400 || response.status === 401 || response.status === 403
        ? 'KEYCLOAK_IDP_INVALID'
        : 'KEYCLOAK_DIRECTORY_UNAVAILABLE',
    });
  }

  const payload = (await response.json()) as KeycloakTokenResponse;
  const token = payload.access_token?.trim();
  if (!token) {
    throw Object.assign(new Error('keycloak_client_token_missing'), {
      code: 'KEYCLOAK_IDP_INVALID',
    });
  }
  return token;
}

async function verifyRealmBase(idpUrl: string, realm: string): Promise<void> {
  const keycloakBaseUrl = deriveKeycloakBaseUrl(idpUrl);
  let response: Response;
  try {
    response = await fetch(
      `${keycloakBaseUrl}/realms/${encodeURIComponent(realm.trim())}/.well-known/openid-configuration`,
      {
        method: 'GET',
        cache: 'no-store',
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    throw Object.assign(new Error(`keycloak_realm_probe_failed:network:${message}`), {
      code: 'KEYCLOAK_DIRECTORY_UNAVAILABLE',
    });
  }

  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(new Error(`keycloak_realm_probe_failed:${response.status}:${text}`), {
      code: response.status === 400 || response.status === 404 ? 'KEYCLOAK_IDP_INVALID' : 'KEYCLOAK_DIRECTORY_UNAVAILABLE',
    });
  }
}

async function adminFetch(idpUrl: string, token: string, path: string): Promise<Response> {
  const keycloakBaseUrl = deriveKeycloakBaseUrl(idpUrl);
  try {
    return await fetch(`${keycloakBaseUrl}${path}`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    throw Object.assign(new Error(`keycloak_directory_request_failed:network:${message}`), {
      code: 'KEYCLOAK_DIRECTORY_UNAVAILABLE',
    });
  }
}

async function fetchUsers(
  idpUrl: string,
  token: string,
  realm: string,
  searchParams: URLSearchParams,
): Promise<KeycloakUserRecord[]> {
  const response = await adminFetch(
    idpUrl,
    token,
    `/admin/realms/${encodeURIComponent(realm.trim())}/users?${searchParams.toString()}`,
  );
  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(new Error(`keycloak_user_search_failed:${response.status}:${text}`), {
      code: 'KEYCLOAK_DIRECTORY_UNAVAILABLE',
    });
  }
  const payload = (await response.json()) as KeycloakUserRecord[];
  return Array.isArray(payload) ? payload : [];
}

function toDirectoryUser(user: KeycloakUserRecord): KeycloakDirectoryUser | null {
  const userId = user.id?.trim();
  const email = user.email?.trim();
  if (!userId || !email) return null;
  return {
    user_id: userId,
    email,
    name: buildDisplayName(user),
  };
}

export async function searchKeycloakUsers(args: {
  idpUrl: string;
  realm: string;
  clientId: string;
  clientSecret?: string;
  query: string;
  max?: number;
}): Promise<KeycloakDirectoryUser[]> {
  const query = args.query.trim();
  if (!query) return [];
  if (shouldUseMockKeycloakDirectory()) {
    const normalizedQuery = query.toLowerCase();
    return MOCK_KEYCLOAK_DIRECTORY_USERS.filter((user) => {
      const haystack = `${user.email} ${user.name ?? ''}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    }).slice(0, Math.max(1, Math.min(args.max ?? 10, 20)));
  }
  const token = await getClientCredentialsToken({
    idpUrl: args.idpUrl,
    realm: args.realm,
    clientId: args.clientId,
    clientSecret: args.clientSecret,
  });
  const max = Math.max(1, Math.min(args.max ?? 10, 20));
  const payload = query.includes('@')
    ? (() => {
        const exactEmailParams = new URLSearchParams({
          email: query,
          exact: 'true',
          max: String(max),
        });
        return fetchUsers(args.idpUrl, token, args.realm, exactEmailParams);
      })()
    : Promise.resolve<KeycloakUserRecord[]>([]);
  const exactMatches = await payload;
  const fallbackMatches = exactMatches.length > 0
    ? []
    : await fetchUsers(
      args.idpUrl,
      token,
      args.realm,
      new URLSearchParams({
        search: query,
        max: String(max),
      }),
    );
  const unique = new Map<string, KeycloakDirectoryUser>();
  for (const item of [...exactMatches, ...fallbackMatches]) {
    const user = toDirectoryUser(item);
    if (!user) continue;
    const haystack = `${user.email} ${user.name ?? ''}`.toLowerCase();
    if (!haystack.includes(query.toLowerCase())) continue;
    unique.set(user.user_id, user);
  }
  return [...unique.values()];
}

export async function resolveKeycloakUserById(args: {
  idpUrl: string;
  realm: string;
  clientId: string;
  clientSecret?: string;
  userId: string;
}): Promise<WorkspaceIdentitySnapshot> {
  const userId = args.userId.trim();
  if (!userId) {
    throw Object.assign(new Error('directory_user_required'), {
      code: 'DIRECTORY_USER_REQUIRED',
    });
  }
  if (shouldUseMockKeycloakDirectory()) {
    const user = MOCK_KEYCLOAK_DIRECTORY_USERS.find((item) => item.user_id === userId);
    if (!user) {
      throw Object.assign(new Error('directory_user_not_found'), {
        code: 'DIRECTORY_USER_NOT_FOUND',
      });
    }
    return {
      user_id: user.user_id,
      email: user.email,
      name: user.name,
    };
  }
  const token = await getClientCredentialsToken({
    idpUrl: args.idpUrl,
    realm: args.realm,
    clientId: args.clientId,
    clientSecret: args.clientSecret,
  });
  const response = await adminFetch(
    args.idpUrl,
    token,
    `/admin/realms/${encodeURIComponent(args.realm.trim())}/users/${encodeURIComponent(userId)}`,
  );
  if (response.status === 404) {
    throw Object.assign(new Error('directory_user_not_found'), {
      code: 'DIRECTORY_USER_NOT_FOUND',
    });
  }
  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(new Error(`keycloak_user_lookup_failed:${response.status}:${text}`), {
      code: 'KEYCLOAK_DIRECTORY_UNAVAILABLE',
    });
  }
  const payload = (await response.json()) as KeycloakUserRecord;
  const user = toDirectoryUser(payload);
  if (!user) {
    throw Object.assign(new Error('directory_user_incomplete'), {
      code: 'DIRECTORY_USER_INCOMPLETE',
    });
  }
  return {
    user_id: user.user_id,
    email: user.email,
    name: user.name,
  };
}

export async function verifyKeycloakIdentityProvider(args: {
  idpUrl: string;
  realm: string;
  clientId: string;
  clientSecret?: string;
}): Promise<KeycloakIdpVerificationResult> {
  if (shouldUseMockKeycloakDirectory()) {
    return {
      idp_ok: true,
      directory_search_supported: true,
    };
  }

  const clientSecret = args.clientSecret?.trim() ?? '';
  if (!clientSecret) {
    await verifyRealmBase(args.idpUrl, args.realm);
    return {
      idp_ok: true,
      directory_search_supported: false,
      advice_code: 'DIRECTORY_PERMISSION_RECOMMENDED',
    };
  }

  const token = await getClientCredentialsToken({
    idpUrl: args.idpUrl,
    realm: args.realm,
    clientId: args.clientId,
    clientSecret: args.clientSecret,
  });

  const response = await adminFetch(
    args.idpUrl,
    token,
    `/admin/realms/${encodeURIComponent(args.realm.trim())}/users?max=1`,
  );

  if (response.ok) {
    return {
      idp_ok: true,
      directory_search_supported: true,
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      idp_ok: true,
      directory_search_supported: false,
      advice_code: 'DIRECTORY_PERMISSION_RECOMMENDED',
    };
  }

  const text = await response.text();
  throw Object.assign(new Error(`keycloak_user_probe_failed:${response.status}:${text}`), {
    code: 'KEYCLOAK_DIRECTORY_UNAVAILABLE',
  });
}

export async function verifyKeycloakLoginIdentityProvider(args: {
  idpUrl: string;
  realm: string;
}): Promise<{ idp_ok: boolean }> {
  if (shouldUseMockKeycloakDirectory()) {
    return { idp_ok: true };
  }
  await verifyRealmBase(args.idpUrl, args.realm);
  return { idp_ok: true };
}
