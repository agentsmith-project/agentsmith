import { getPublicRuntimeConfig } from '@/lib/public-runtime-config';

export function getKeycloakClientId(): string {
  return getPublicRuntimeConfig().keycloakClientId;
}

export function getKeycloakRealmBase(): string | null {
  const config = getPublicRuntimeConfig();
  return resolveKeycloakRealmBase(config.keycloakUrl, config.keycloakRealm);
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
