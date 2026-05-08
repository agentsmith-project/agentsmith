import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  REPO_ROOT,
  TARGET_PROFILES,
  asRecord,
  loadUnifiedDeployManifest,
  type CheckFailure,
  type UnifiedDeployProfile,
} from './manifest';
import {
  parseKubernetesDocuments,
  resourceId,
  resourceKind,
} from './kubernetes';
import {
  DEFAULT_SITE_ENV_PATH,
  renderUnifiedDeployFromFiles,
} from './render';
import {
  DEFAULT_SUBSTRATE_TRUTH_PATH,
  parseSubstrateTruth,
} from './substrate-truth';

export type UnifiedDeployEvidenceStatus = 'passed' | 'failed';
export type UnifiedDeployEvidenceProducer = 'manifest' | 'render' | 'api-single-replica' | 'substrate-boundary' | 'address-truth';

export type UnifiedDeployResourceSummary = {
  total: number;
  kinds: Record<string, number>;
  resources: string[];
};

export type UnifiedDeployProfileEvidence = {
  profile: UnifiedDeployProfile;
  rendered_config_fingerprint: string;
  redacted_substrate_truth_fingerprint: string;
  resource_summary: UnifiedDeployResourceSummary;
};

export type UnifiedDeployEvidence = {
  schema_version: 'agentsmith.unified-deploy.evidence/v1';
  producer: UnifiedDeployEvidenceProducer;
  status: UnifiedDeployEvidenceStatus;
  generated_at: string;
  profiles: UnifiedDeployProfileEvidence[];
  manifest_summary: {
    deploy_model: string;
    profiles: string[];
    substrate_services: string[];
    app_components: string[];
    ingress_routes: string[];
  };
  failures: CheckFailure[];
  paths: {
    report_path: string;
    log_path: string;
  };
};

type EvidenceOptions = {
  producer: UnifiedDeployEvidenceProducer;
  status: UnifiedDeployEvidenceStatus;
  failures: CheckFailure[];
  evidenceDir?: string;
};

const DEFAULT_EVIDENCE_DIR = path.join(REPO_ROOT, 'artifacts', 'unified-deploy');
const SECRET_KEY_PATTERN = /(?:PASSWORD|SECRET|TOKEN|PRIVATE|ACCESS[_-]?KEY|API[_-]?KEY|CREDENTIAL|DATABASE_URL|MONGO_URL|MONGODB_URI|REDIS_URL|CLIENT_SECRET|AUTHORIZATION)/iu;

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortJson(nestedValue)]),
    );
  }

  return value;
}

function redactedRecordValues(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key]) => [key, '[REDACTED]']),
  );
}

function redactSecretLikeKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSecretLikeKeys);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const name = record.name;
    if (typeof name === 'string' && SECRET_KEY_PATTERN.test(name) && Object.prototype.hasOwnProperty.call(record, 'value')) {
      return {
        ...Object.fromEntries(
          Object.entries(record).map(([key, nestedValue]) => [
            key,
            key === 'value' ? '[REDACTED]' : redactSecretLikeKeys(nestedValue),
          ]),
        ),
      };
    }

    return Object.fromEntries(
      Object.entries(record).map(([key, nestedValue]) => [
        key,
        SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : redactSecretLikeKeys(nestedValue),
      ]),
    );
  }

  return value;
}

function redactKubernetesSecret(resource: Record<string, unknown>): Record<string, unknown> {
  const redacted = asRecord(redactSecretLikeKeys(resource));
  if (resourceKind(resource) !== 'Secret') {
    return redacted;
  }

  for (const field of ['data', 'stringData', 'binaryData']) {
    const fieldValue = asRecord(redacted[field]);
    if (Object.keys(fieldValue).length > 0) {
      redacted[field] = redactedRecordValues(fieldValue);
    }
  }

  return redacted;
}

export function redactRenderedManifest(renderedYaml: string): Record<string, unknown>[] {
  const parsed = parseKubernetesDocuments(renderedYaml);
  return parsed.documents.map((document) => redactKubernetesSecret(document));
}

export function fingerprintRenderedManifest(renderedYaml: string): string {
  return sha256(canonicalJson(redactRenderedManifest(renderedYaml)));
}

function summarizeResources(renderedYaml: string): UnifiedDeployResourceSummary {
  const parsed = parseKubernetesDocuments(renderedYaml);
  const kinds: Record<string, number> = {};
  const resources: string[] = [];

  for (const document of parsed.documents) {
    const kind = resourceKind(document);
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    resources.push(resourceId(document));
  }

  return {
    total: resources.length,
    kinds: Object.fromEntries(Object.entries(kinds).sort(([left], [right]) => left.localeCompare(right))),
    resources: resources.sort(),
  };
}

function buildManifestSummary(): UnifiedDeployEvidence['manifest_summary'] {
  try {
    const manifest = loadUnifiedDeployManifest();
    const profiles = Object.keys(asRecord(manifest.profiles)).sort();
    const substrateServices = Array.isArray(asRecord(manifest.substrate).services)
      ? asRecord(manifest.substrate).services as unknown[]
      : [];
    const appComponents = Object.keys(asRecord(asRecord(manifest.app).components)).sort();
    const ingressRoutes = Array.isArray(asRecord(manifest.ingress).routes)
      ? asRecord(manifest.ingress).routes as unknown[]
      : [];

    return {
      deploy_model: typeof manifest.deploy_model === 'string' ? manifest.deploy_model : '',
      profiles,
      substrate_services: substrateServices.filter((service): service is string => typeof service === 'string').sort(),
      app_components: appComponents,
      ingress_routes: ingressRoutes
        .map((route) => {
          const routeRecord = asRecord(route);
          return `${String(routeRecord.path ?? '')}->${String(routeRecord.service ?? '')}`;
        })
        .sort(),
    };
  } catch {
    return {
      deploy_model: '',
      profiles: [],
      substrate_services: [],
      app_components: [],
      ingress_routes: [],
    };
  }
}

async function buildProfileEvidence(profile: UnifiedDeployProfile): Promise<UnifiedDeployProfileEvidence> {
  try {
    await readFile(DEFAULT_SITE_ENV_PATH, 'utf8');
    const truthSource = await readFile(DEFAULT_SUBSTRATE_TRUTH_PATH, 'utf8');
    const truth = parseSubstrateTruth(truthSource, { sourcePath: DEFAULT_SUBSTRATE_TRUTH_PATH });
    const rendered = await renderUnifiedDeployFromFiles({ profile });

    return {
      profile,
      rendered_config_fingerprint: fingerprintRenderedManifest(rendered.output),
      redacted_substrate_truth_fingerprint: truth.redacted_fingerprint,
      resource_summary: summarizeResources(rendered.output),
    };
  } catch {
    return {
      profile,
      rendered_config_fingerprint: 'unavailable',
      redacted_substrate_truth_fingerprint: 'unavailable',
      resource_summary: {
        total: 0,
        kinds: {},
        resources: [],
      },
    };
  }
}

export async function buildProducerEvidence(options: EvidenceOptions): Promise<UnifiedDeployEvidence> {
  const profiles = await Promise.all(TARGET_PROFILES.map((profile) => buildProfileEvidence(profile)));

  return {
    schema_version: 'agentsmith.unified-deploy.evidence/v1',
    producer: options.producer,
    status: options.status,
    generated_at: new Date().toISOString(),
    profiles,
    manifest_summary: buildManifestSummary(),
    failures: options.failures,
    paths: {
      report_path: '',
      log_path: '',
    },
  };
}

function evidenceBasename(producer: UnifiedDeployEvidenceProducer): string {
  const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
  return `${producer}-${timestamp}`;
}

export async function writeProducerEvidence(options: EvidenceOptions): Promise<UnifiedDeployEvidence> {
  const evidenceDir = path.resolve(options.evidenceDir ?? DEFAULT_EVIDENCE_DIR);
  await mkdir(evidenceDir, { recursive: true });

  const basename = evidenceBasename(options.producer);
  const reportPath = path.join(evidenceDir, `${basename}.json`);
  const logPath = path.join(evidenceDir, `${basename}.log`);
  const evidence = await buildProducerEvidence(options);
  const evidenceWithPaths: UnifiedDeployEvidence = {
    ...evidence,
    paths: {
      report_path: reportPath,
      log_path: logPath,
    },
  };

  await writeFile(reportPath, `${JSON.stringify(evidenceWithPaths, null, 2)}\n`, 'utf8');
  await writeFile(
    logPath,
    [
      `producer=${options.producer}`,
      `status=${options.status}`,
      `report_path=${reportPath}`,
      `failures=${options.failures.length}`,
    ].join('\n') + '\n',
    'utf8',
  );

  return evidenceWithPaths;
}
