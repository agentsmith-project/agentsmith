import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { asRecord, type CheckFailure, type CheckResult } from './manifest';
import {
  hasObjectKey,
  isApiResource,
  parseKubernetesDocuments,
  recursivelyContainsString,
  resourceId,
  resourceKind,
  resourceName,
} from './kubernetes';
import { renderUnifiedDeployFromFiles } from './render';
import { writeProducerEvidence } from './evidence';

const AUTOSCALER_KINDS = new Set(['HorizontalPodAutoscaler', 'ScaledObject', 'ScaledJob']);

function addFailure(failures: CheckFailure[], resourcePath: string, message: string): void {
  failures.push({ path: resourcePath, message });
}

function apiDeploymentNames(documents: readonly Record<string, unknown>[]): Set<string> {
  const names = new Set(['api', 'agentsmith-api']);
  for (const document of documents) {
    if (resourceKind(document) === 'Deployment' && isApiResource(document)) {
      names.add(resourceName(document));
    }
  }

  return names;
}

function autoscalerTargetName(resource: Record<string, unknown>): string {
  const spec = asRecord(resource.spec);
  const scaleTargetRef = asRecord(spec.scaleTargetRef);
  const nestedName = scaleTargetRef.name;
  if (typeof nestedName === 'string') {
    return nestedName;
  }

  const targetRef = asRecord(spec.targetRef);
  const targetName = targetRef.name;
  return typeof targetName === 'string' ? targetName : '';
}

function checkApiDeploymentReplicas(documents: readonly Record<string, unknown>[], failures: CheckFailure[]): void {
  const apiDeployments = documents.filter((document) => resourceKind(document) === 'Deployment' && isApiResource(document));
  if (apiDeployments.length === 0) {
    addFailure(failures, 'Deployment/api', 'api Deployment must be rendered');
    return;
  }
  if (apiDeployments.length > 1) {
    addFailure(failures, 'Deployment/api', 'exactly one api Deployment must be rendered');
  }

  for (const deployment of apiDeployments) {
    const replicas = asRecord(deployment.spec).replicas;
    if (replicas !== 1) {
      addFailure(failures, resourceId(deployment), 'api Deployment must render spec.replicas: 1');
    }
  }
}

function checkAutoscalers(documents: readonly Record<string, unknown>[], failures: CheckFailure[]): void {
  const apiNames = apiDeploymentNames(documents);

  for (const document of documents) {
    const kind = resourceKind(document);
    if (!AUTOSCALER_KINDS.has(kind)) {
      continue;
    }

    const targetName = autoscalerTargetName(document);
    if (apiNames.has(targetName) || isApiResource(document)) {
      addFailure(failures, resourceId(document), 'autoscaler must not target api');
    }
  }
}

function checkForbiddenSettings(documents: readonly Record<string, unknown>[], failures: CheckFailure[]): void {
  for (const document of documents) {
    if (hasObjectKey(document, 'API_REPLICAS') || recursivelyContainsString(document, 'API_REPLICAS')) {
      addFailure(failures, resourceId(document), 'API_REPLICAS must not be rendered');
    }
    if (recursivelyContainsString(document, 'execution-gateway')) {
      addFailure(failures, resourceId(document), 'execution-gateway must not be rendered');
    }
  }
}

export function checkApiSingleReplica(renderedYaml: string): CheckResult {
  const parsed = parseKubernetesDocuments(renderedYaml);
  const failures = [...parsed.failures];

  if (parsed.ok) {
    checkApiDeploymentReplicas(parsed.documents, failures);
    checkAutoscalers(parsed.documents, failures);
    checkForbiddenSettings(parsed.documents, failures);
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

async function checkRenderedProfile(profile: 'local-kind' | 'existing-cluster'): Promise<CheckFailure[]> {
  const rendered = await renderUnifiedDeployFromFiles({ profile });
  return checkApiSingleReplica(rendered.output).failures.map((failure) => ({
    path: `${profile}:${failure.path}`,
    message: failure.message,
  }));
}

async function main(): Promise<void> {
  const fileArg = process.argv.find((arg) => arg.startsWith('--file='));
  const failures = fileArg
    ? checkApiSingleReplica(readFileSync(path.resolve(fileArg.slice('--file='.length)), 'utf8')).failures
    : [
      ...await checkRenderedProfile('local-kind'),
      ...await checkRenderedProfile('existing-cluster'),
    ];

  if (failures.length > 0) {
    const evidence = await writeProducerEvidence({
      producer: 'api-single-replica',
      status: 'failed',
      failures,
    });
    process.stderr.write(`${failures.map((failure) => `${failure.path}: ${failure.message}`).join('\n')}\n`);
    process.stderr.write(`[unified-deploy] evidence: ${evidence.paths.report_path}\n`);
    process.exitCode = 1;
    return;
  }

  const evidence = await writeProducerEvidence({
    producer: 'api-single-replica',
    status: 'passed',
    failures: [],
  });

  process.stdout.write(`[unified-deploy] api single-replica check passed\n[unified-deploy] evidence: ${evidence.paths.report_path}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
