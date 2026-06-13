export const SUBSTRATE_NATIVE_PORTS = {
  postgresql: '5432',
  mongodb: '27017',
  redis: '6379',
  minio: '9000',
  keycloak: '8080',
} as const;

export type SubstrateService = keyof typeof SUBSTRATE_NATIVE_PORTS;
export type SubstrateHttpScheme = 'http' | 'https';

export function substrateServiceName(service: SubstrateService): string {
  return `substrate-${service}`;
}

export function substrateServiceFqdn(service: SubstrateService, namespace: string): string {
  return `${substrateServiceName(service)}.${namespace}.svc.cluster.local`;
}

export function substrateKeycloakInternalBaseUrl(scheme: SubstrateHttpScheme = 'http'): string {
  return `${scheme}://${substrateServiceName('keycloak')}:${SUBSTRATE_NATIVE_PORTS.keycloak}`;
}

export function substrateMinioInternalMountEndpoint(
  namespace: string,
  scheme: SubstrateHttpScheme = 'http',
): string {
  return `${scheme}://${substrateServiceFqdn('minio', namespace)}:${SUBSTRATE_NATIVE_PORTS.minio}`;
}
