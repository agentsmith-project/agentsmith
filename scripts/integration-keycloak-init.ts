type TokenResponse = {
  access_token: string;
};

type KeycloakUser = {
  id: string;
  username?: string;
};

interface SeedUser {
  username: string;
  password: string;
  firstName: string;
  lastName: string;
  email: string;
}

const keycloakBaseUrl = process.env.KEYCLOAK_BASE_URL ?? 'http://localhost:18080';
const keycloakRealm = process.env.KEYCLOAK_REALM ?? 'mbos';
const keycloakAdminUser = process.env.KEYCLOAK_ADMIN ?? 'admin';
const keycloakAdminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin';

const seedUsers: SeedUser[] = [
  {
    username: process.env.INTEGRATION_DEV_ADMIN_USERNAME ?? 'dev-admin',
    password: process.env.INTEGRATION_DEV_ADMIN_PASSWORD ?? 'dev-admin-123',
    firstName: 'Dev',
    lastName: 'Admin',
    email: 'dev-admin@example.com',
  },
  {
    username: process.env.INTEGRATION_USER_USERNAME ?? 'integration-user',
    password: process.env.INTEGRATION_USER_PASSWORD ?? 'integration-user-123',
    firstName: 'Integration',
    lastName: 'User',
    email: 'integration-user@example.com',
  },
];

async function getAdminToken(): Promise<string> {
  const url = `${keycloakBaseUrl}/realms/master/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: 'admin-cli',
    username: keycloakAdminUser,
    password: keycloakAdminPassword,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`keycloak_admin_token_failed:${res.status}:${text}`);
  }

  const payload = (await res.json()) as TokenResponse;
  if (!payload.access_token) {
    throw new Error('keycloak_admin_token_missing');
  }
  return payload.access_token;
}

async function adminFetch(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `${keycloakBaseUrl}${path}`;
  const headers = new Headers(init?.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (init?.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  return fetch(url, {
    ...init,
    headers,
  });
}

async function findUser(token: string, username: string): Promise<KeycloakUser | null> {
  const res = await adminFetch(
    token,
    `/admin/realms/${encodeURIComponent(keycloakRealm)}/users?username=${encodeURIComponent(username)}&exact=true`,
    { method: 'GET' },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`keycloak_find_user_failed:${username}:${res.status}:${text}`);
  }

  const users = (await res.json()) as KeycloakUser[];
  if (!Array.isArray(users) || users.length === 0) {
    return null;
  }
  return users[0] ?? null;
}

async function createUser(token: string, user: SeedUser): Promise<void> {
  const res = await adminFetch(
    token,
    `/admin/realms/${encodeURIComponent(keycloakRealm)}/users`,
    {
      method: 'POST',
      body: JSON.stringify({
        username: user.username,
        enabled: true,
        emailVerified: true,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      }),
    },
  );

  if (!(res.status === 201 || res.status === 204)) {
    const text = await res.text();
    throw new Error(`keycloak_create_user_failed:${user.username}:${res.status}:${text}`);
  }
}

async function updateUserProfile(token: string, userId: string, user: SeedUser): Promise<void> {
  const res = await adminFetch(
    token,
    `/admin/realms/${encodeURIComponent(keycloakRealm)}/users/${encodeURIComponent(userId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        id: userId,
        username: user.username,
        enabled: true,
        emailVerified: true,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      }),
    },
  );

  if (!(res.status === 200 || res.status === 204)) {
    const text = await res.text();
    throw new Error(`keycloak_update_user_failed:${user.username}:${res.status}:${text}`);
  }
}

async function resetPassword(token: string, userId: string, password: string, username: string): Promise<void> {
  const res = await adminFetch(
    token,
    `/admin/realms/${encodeURIComponent(keycloakRealm)}/users/${encodeURIComponent(userId)}/reset-password`,
    {
      method: 'PUT',
      body: JSON.stringify({
        type: 'password',
        value: password,
        temporary: false,
      }),
    },
  );

  if (!(res.status === 200 || res.status === 204)) {
    const text = await res.text();
    throw new Error(`keycloak_reset_password_failed:${username}:${res.status}:${text}`);
  }
}

async function ensureUser(token: string, user: SeedUser): Promise<void> {
  let found = await findUser(token, user.username);
  if (!found) {
    await createUser(token, user);
    found = await findUser(token, user.username);
  }
  if (!found) {
    throw new Error(`keycloak_user_missing_after_create:${user.username}`);
  }

  await updateUserProfile(token, found.id, user);
  await resetPassword(token, found.id, user.password, user.username);
  process.stdout.write(`[integration-keycloak-init] ensured ${user.username}\n`);
}

async function main(): Promise<void> {
  const token = await getAdminToken();
  for (const user of seedUsers) {
    await ensureUser(token, user);
  }
  process.stdout.write('[integration-keycloak-init] done\n');
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[integration-keycloak-init] failed: ${message}\n`);
  process.exit(1);
});
