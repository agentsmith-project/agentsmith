import type { WorkspaceIdentitySnapshot } from './workspace-registry.js';

export type KeycloakDirectoryUser = WorkspaceIdentitySnapshot;

type KeycloakAdminTokenResponse = {
  access_token?: string;
};

type KeycloakUserRecord = {
  id?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
};

type KeycloakDirectoryConfig = {
  url: string;
  realm: string;
};

function deriveKeycloakBaseUrl(idpUrl: string): string {
  const trimmed = idpUrl.trim().replace(/\/+$/, '');
  const marker = '/realms';
  const markerIndex = trimmed.indexOf(marker);
  return markerIndex >= 0 ? trimmed.slice(0, markerIndex) : trimmed;
}

function getKeycloakAdminUsername(): string {
  return process.env.KEYCLOAK_ADMIN?.trim() ?? '';
}

function getKeycloakAdminPassword(): string {
  return process.env.KEYCLOAK_ADMIN_PASSWORD?.trim() ?? '';
}

function getKeycloakAdminClientId(): string {
  return process.env.KEYCLOAK_ADMIN_CLIENT_ID?.trim() || 'admin-cli';
}

function buildDisplayName(user: KeycloakUserRecord): string | null {
  const first = user.firstName?.trim() ?? '';
  const last = user.lastName?.trim() ?? '';
  const fullName = [first, last].filter((item) => item.length > 0).join(' ').trim();
  if (fullName) return fullName;
  const username = user.username?.trim();
  return username || null;
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

async function getAdminToken(config: KeycloakDirectoryConfig): Promise<string> {
  const username = getKeycloakAdminUsername();
  const password = getKeycloakAdminPassword();
  if (!username || !password) {
    throw Object.assign(new Error('KEYCLOAK_ADMIN and KEYCLOAK_ADMIN_PASSWORD must be configured for Keycloak directory access'), {
      code: 'KEYCLOAK_DIRECTORY_UNAVAILABLE',
    });
  }

  let response: Response;
  try {
    response = await fetch(`${deriveKeycloakBaseUrl(config.url)}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: getKeycloakAdminClientId(),
        username,
        password,
      }).toString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    throw Object.assign(new Error(`keycloak_admin_token_failed:network:${message}`), {
      code: 'KEYCLOAK_DIRECTORY_UNAVAILABLE',
    });
  }
  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(new Error(`keycloak_admin_token_failed:${response.status}:${text}`), {
      code: 'KEYCLOAK_DIRECTORY_UNAVAILABLE',
    });
  }
  const payload = (await response.json()) as KeycloakAdminTokenResponse;
  const token = payload.access_token?.trim();
  if (!token) {
    throw Object.assign(new Error('keycloak_admin_token_missing'), {
      code: 'KEYCLOAK_DIRECTORY_UNAVAILABLE',
    });
  }
  return token;
}

async function adminFetch(config: KeycloakDirectoryConfig, token: string, path: string): Promise<Response> {
  try {
    return await fetch(`${deriveKeycloakBaseUrl(config.url)}${path}`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    throw Object.assign(new Error(`keycloak_directory_request_failed:network:${message}`), {
      code: 'KEYCLOAK_DIRECTORY_UNAVAILABLE',
    });
  }
}

async function fetchUsers(
  config: KeycloakDirectoryConfig,
  token: string,
  searchParams: URLSearchParams,
): Promise<KeycloakUserRecord[]> {
  const response = await adminFetch(
    config,
    token,
    `/admin/realms/${encodeURIComponent(config.realm.trim())}/users?${searchParams.toString()}`,
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

export async function searchKeycloakDirectoryUsers(args: KeycloakDirectoryConfig & {
  query: string;
  max?: number;
}): Promise<KeycloakDirectoryUser[]> {
  const query = args.query.trim();
  if (!query) return [];
  const token = await getAdminToken(args);
  const max = Math.max(1, Math.min(args.max ?? 10, 20));
  const exactMatches = query.includes('@')
    ? await fetchUsers(
      args,
      token,
      new URLSearchParams({
        email: query,
        exact: 'true',
        max: String(max),
      }),
    )
    : [];
  const fallbackMatches = exactMatches.length > 0
    ? []
    : await fetchUsers(
      args,
      token,
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

export async function resolveKeycloakDirectoryUsersByIds(args: KeycloakDirectoryConfig & {
  userIds: string[];
}): Promise<KeycloakDirectoryUser[]> {
  const uniqueIds = Array.from(
    new Set(
      args.userIds
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
  if (uniqueIds.length === 0) return [];
  const token = await getAdminToken(args);
  const items: KeycloakDirectoryUser[] = [];
  for (const userId of uniqueIds) {
    const response = await adminFetch(
      args,
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
    items.push(user);
  }
  return items;
}
