import YAML from 'yaml';

import { asRecord, type CheckFailure, type CheckResult } from './manifest';

export type KubernetesDocument = Record<string, unknown>;

export function parseKubernetesDocuments(source: string): CheckResult & { documents: KubernetesDocument[] } {
  const failures: CheckFailure[] = [];
  const documents = YAML.parseAllDocuments(source);
  const parsedDocuments: KubernetesDocument[] = [];

  documents.forEach((document, index) => {
    for (const error of document.errors) {
      failures.push({
        path: `document[${index}]`,
        message: `rendered YAML must parse: ${error.message}`,
      });
    }

    const json = document.toJSON() as unknown;
    if (json === null || json === undefined) {
      return;
    }
    if (typeof json !== 'object' || Array.isArray(json)) {
      failures.push({
        path: `document[${index}]`,
        message: 'rendered YAML document must be a Kubernetes resource object',
      });
      return;
    }
    parsedDocuments.push(json as KubernetesDocument);
  });

  return {
    ok: failures.length === 0,
    failures,
    documents: parsedDocuments,
  };
}

export function resourceKind(resource: KubernetesDocument): string {
  return typeof resource.kind === 'string' ? resource.kind : '';
}

export function resourceName(resource: KubernetesDocument): string {
  const metadata = asRecord(resource.metadata);
  return typeof metadata.name === 'string' ? metadata.name : '';
}

export function resourceLabels(resource: KubernetesDocument): Record<string, unknown> {
  return asRecord(asRecord(resource.metadata).labels);
}

export function componentLabel(resource: KubernetesDocument): string {
  const labels = resourceLabels(resource);
  const component = labels['app.kubernetes.io/component'];
  return typeof component === 'string' ? component : '';
}

export function resourceId(resource: KubernetesDocument): string {
  return `${resourceKind(resource)}/${resourceName(resource)}`;
}

export function isApiResource(resource: KubernetesDocument): boolean {
  return componentLabel(resource) === 'api' || resourceName(resource) === 'agentsmith-api' || resourceName(resource) === 'api';
}

export function recursivelyContainsString(value: unknown, forbidden: string): boolean {
  if (typeof value === 'string') {
    return value.includes(forbidden);
  }
  if (Array.isArray(value)) {
    return value.some((item) => recursivelyContainsString(item, forbidden));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(([key, nestedValue]) =>
      key.includes(forbidden) || recursivelyContainsString(nestedValue, forbidden),
    );
  }

  return false;
}

export function hasObjectKey(value: unknown, keyName: string): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasObjectKey(item, keyName));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(([key, nestedValue]) =>
      key === keyName || hasObjectKey(nestedValue, keyName),
    );
  }

  return false;
}

export function formatCheckResult(prefix: string, result: CheckResult): string {
  if (result.ok) {
    return `${prefix} passed`;
  }

  return result.failures.map((failure) => `${failure.path}: ${failure.message}`).join('\n');
}
