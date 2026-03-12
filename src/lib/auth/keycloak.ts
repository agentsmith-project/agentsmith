const keycloakRealmsBase = process.env.NEXT_PUBLIC_KEYCLOAK_URL?.trim() ?? '';
const keycloakRealm = process.env.NEXT_PUBLIC_KEYCLOAK_REALM?.trim() ?? '';
const keycloakClientId = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID?.trim() ?? '';

export function getKeycloakClientId(): string {
  return keycloakClientId;
}

export function getKeycloakRealmBase(): string | null {
  return resolveKeycloakRealmBase(keycloakRealmsBase, keycloakRealm);
}

export function resolveKeycloakRealmBase(realmsBase: string, realm: string): string | null {
  if (!realmsBase || !realm) {
    return null;
  }

  if (realmsBase.endsWith('/realms')) {
    return `${realmsBase}/${realm}`;
  }

  if (realmsBase.includes('/realms/')) {
    return realmsBase.replace(/\/$/, '');
  }

  return `${realmsBase.replace(/\/$/, '')}/realms/${realm}`;
}
