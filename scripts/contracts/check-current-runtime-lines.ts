import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  findCurrentRuntimeLine,
} from '../governance/current-runtime-line-manifest';

const rootDir = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function parseEnvFile(relativePath: string): Record<string, string> {
  const entries = read(relativePath)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)] as const;
    });
  return Object.fromEntries(entries);
}

const failures: string[] = [];

try {
  execFileSync('npm', ['run', 'current-runtime-lines:check'], {
    cwd: rootDir,
    stdio: 'pipe',
    encoding: 'utf8',
  });
} catch (error) {
  failures.push('generated runtime-line docs are out of sync with current-runtime-line-manifest.ts');
}

const demoRehearsal = findCurrentRuntimeLine('demo-rehearsal');
const clusterRehearsal = findCurrentRuntimeLine('cluster-rehearsal');
const demoEnv = parseEnvFile('infra/flows/demo-rehearsal.env');
const clusterEnv = parseEnvFile('infra/flows/cluster-rehearsal.env');
const demoDeployOperations = read('docs/user-guides/demo-deploy-operations.md');
const clusterDeployOperations = read('docs/user-guides/cluster-deploy-operations.md');

if (!demoRehearsal || !clusterRehearsal) {
  failures.push('current runtime-line manifest must define demo-rehearsal and cluster-rehearsal');
} else {
  if (demoEnv.LOCAL_KIND_CLUSTER_NAME !== demoRehearsal.localKindClusterName) {
    failures.push(`demo rehearsal local kind cluster must stay aligned with ${demoRehearsal.localKindClusterName}`);
  }
  if (demoEnv.LOCAL_KIND_REGISTRY_NAME !== demoRehearsal.localRegistryName) {
    failures.push(`demo rehearsal local registry must stay aligned with ${demoRehearsal.localRegistryName}`);
  }
  if (Number(demoEnv.LOCAL_KIND_REGISTRY_HOST_PORT) !== demoRehearsal.localRegistryHostPort) {
    failures.push(`demo rehearsal registry host port must stay aligned with ${demoRehearsal.localRegistryHostPort}`);
  }

  if (clusterEnv.LOCAL_KIND_CLUSTER_NAME !== clusterRehearsal.localKindClusterName) {
    failures.push(`cluster rehearsal local kind cluster must stay aligned with ${clusterRehearsal.localKindClusterName}`);
  }
  if (clusterEnv.LOCAL_KIND_REGISTRY_NAME !== clusterRehearsal.localRegistryName) {
    failures.push(`cluster rehearsal local registry must stay aligned with ${clusterRehearsal.localRegistryName}`);
  }
  if (Number(clusterEnv.LOCAL_KIND_REGISTRY_HOST_PORT) !== clusterRehearsal.localRegistryHostPort) {
    failures.push(`cluster rehearsal registry host port must stay aligned with ${clusterRehearsal.localRegistryHostPort}`);
  }
  if (clusterEnv.CLUSTER_REHEARSAL_K8S_REGISTRY_HOST !== clusterRehearsal.k8sRegistryHost) {
    failures.push(`cluster rehearsal in-cluster registry host must stay aligned with ${clusterRehearsal.k8sRegistryHost}`);
  }
}

if (!/Runtime Lines Matrix/.test(demoDeployOperations)) {
  failures.push('demo deploy operations must point runtime topology readers back to Runtime Lines Matrix');
}

if (!/cluster-rehearsal/.test(clusterDeployOperations) || !/Runtime Lines Matrix/.test(clusterDeployOperations)) {
  failures.push('cluster deploy operations must keep the cluster-rehearsal boundary and Runtime Lines Matrix reference visible');
}

if (failures.length > 0) {
  console.error('[contracts] current runtime-line check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[contracts] current runtime-line check passed');
