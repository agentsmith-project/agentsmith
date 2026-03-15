import type { WorkspaceIdentitySnapshot } from './workspace-registry/types';

export interface KeycloakDirectoryUser {
  user_id: string;
  email: string;
  name: string | null;
}

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

function getKeycloakAdminUsername(): string {
  return process.env.KEYCLOAK_ADMIN?.trim() || 'admin';
}

function getKeycloakAdminPassword(): string {
  return process.env.KEYCLOAK_ADMIN_PASSWORD?.trim() || 'admin';
}

function getKeycloakAdminClientId(): string {
  return process.env.KEYCLOAK_ADMIN_CLIENT_ID?.trim() || 'admin-cli';
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

async function getAdminToken(idpUrl: string): Promise<string> {
  const keycloakBaseUrl = deriveKeycloakBaseUrl(idpUrl);
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: getKeycloakAdminClientId(),
    username: getKeycloakAdminUsername(),
    password: getKeycloakAdminPassword(),
  });

  let response: Response;
  try {
    response = await fetch(`${keycloakBaseUrl}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      cache: 'no-store',
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
  query: string;
  max?: number;
}): Promise<KeycloakDirectoryUser[]> {
  const query = args.query.trim();
  if (!query) return [];
  const token = await getAdminToken(args.idpUrl);
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
  userId: string;
}): Promise<WorkspaceIdentitySnapshot> {
  const userId = args.userId.trim();
  if (!userId) {
    throw Object.assign(new Error('directory_user_required'), {
      code: 'DIRECTORY_USER_REQUIRED',
    });
  }
  const token = await getAdminToken(args.idpUrl);
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
