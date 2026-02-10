const keycloakRealmsBase = process.env.NEXT_PUBLIC_KEYCLOAK_URL?.trim() ?? '';
const keycloakRealm = process.env.NEXT_PUBLIC_KEYCLOAK_REALM?.trim() ?? '';
const keycloakClientId = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID?.trim() ?? '';

export function getKeycloakClientId(): string {
  return keycloakClientId;
}

export function getKeycloakRealmBase(): string | null {
  if (!keycloakRealmsBase || !keycloakRealm) {
    return null;
  }

  if (keycloakRealmsBase.endsWith('/realms')) {
    return `${keycloakRealmsBase}/${keycloakRealm}`;
  }

  if (keycloakRealmsBase.includes('/realms/')) {
    return keycloakRealmsBase.replace(/\/$/, '');
  }

  return `${keycloakRealmsBase.replace(/\/$/, '')}/realms/${keycloakRealm}`;
}
