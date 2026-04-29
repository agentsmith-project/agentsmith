import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  CURRENT_RUNTIME_LINE_MANIFEST,
  CURRENT_RUNTIME_SHARED_RULES,
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

function parseKeyValueOutput(output: string): Record<string, string> {
  return Object.fromEntries(
    output
      .trim()
      .split('\n')
      .map((line) => line.split(/=(.+)/, 2) as [string, string]),
  );
}

function parseUrlPort(rawUrl: string | undefined): number | undefined {
  if (!rawUrl) {
    return undefined;
  }

  try {
    const url = new URL(rawUrl);
    if (url.port) {
      return Number(url.port);
    }
    if (url.protocol === 'https:') {
      return 443;
    }
    if (url.protocol === 'http:') {
      return 80;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function readRuntimeLinePathTruthFromShell(lineId: string): Record<string, string> {
  return parseKeyValueOutput(execFileSync(
    'bash',
    [
      '-lc',
      `
        set -euo pipefail
        source "${path.join(rootDir, 'scripts/lib/runtime-line-state.sh')}"
        printf 'lines_root_relative=%s\\n' "$(runtime_lines_root_relative)"
        printf 'line_root_relative=%s\\n' "$(runtime_line_root_relative "${lineId}")"
        printf 'current_root_relative=%s\\n' "$(runtime_line_current_relative "${lineId}")"
      `,
    ],
    {
      cwd: rootDir,
      stdio: 'pipe',
      encoding: 'utf8',
    },
  ));
}

const failures: string[] = [];

try {
  execFileSync('npm', ['run', 'current-runtime-lines:check'], {
    cwd: rootDir,
    stdio: 'pipe',
    encoding: 'utf8',
  });
} catch {
  failures.push('generated runtime-line docs are out of sync with current-runtime-line-manifest.ts');
}

const demoRehearsal = findCurrentRuntimeLine('demo-rehearsal');
const clusterRehearsal = findCurrentRuntimeLine('cluster-rehearsal');
const demoEnv = parseEnvFile('infra/flows/demo-rehearsal.env');
const clusterEnv = parseEnvFile('infra/flows/cluster-rehearsal.env');
const demoDeployOperations = read('docs/user-guides/demo-deploy-operations.md');
const clusterDeployOperations = read('docs/user-guides/cluster-deploy-operations.md');
const governanceModel = read('docs/current-engineering-governance-model.md');
const localRuntimeFlows = read('docs/user-guides/local-runtime-flows.md');
const runtimeLinesMatrix = read('docs/user-guides/runtime-lines-matrix.md');

const activeUniversalProxyRuntimeEntrypoints = [
  'scripts/run-integration-e2e-full.sh',
  'scripts/substrate/providers/compose.sh',
  'scripts/local-manual/start-proxy.sh',
];
const universalProxyRuntimeSourceScanPaths = [
  ...activeUniversalProxyRuntimeEntrypoints,
  'scripts/substrate/common.sh',
  'scripts/lib/universal-proxy-runtime.sh',
];
const forbiddenUniversalProxySourceCouplings = [
  '../llm-universal-proxy',
  'PROXY_ROOT',
  'cargo build',
  'target/debug/llm-universal-proxy',
];

for (const entrypoint of activeUniversalProxyRuntimeEntrypoints) {
  const content = read(entrypoint);
  if (!content.includes('universal_proxy_runtime_ensure')) {
    failures.push(`${entrypoint} must call universal_proxy_runtime_ensure for local/backend-real proxy startup`);
  }
}

for (const runtimePath of universalProxyRuntimeSourceScanPaths) {
  const content = read(runtimePath);
  for (const forbidden of forbiddenUniversalProxySourceCouplings) {
    if (content.includes(forbidden)) {
      failures.push(`${runtimePath} must not couple local/backend-real proxy startup to sibling llmup source via ${forbidden}`);
    }
  }
}

const universalProxyRuntimeHelperPath = 'scripts/lib/universal-proxy-runtime.sh';
if (!existsSync(path.join(rootDir, universalProxyRuntimeHelperPath))) {
  failures.push('local/backend-real proxy startup must use scripts/lib/universal-proxy-runtime.sh');
} else {
  const universalProxyRuntimeHelper = read(universalProxyRuntimeHelperPath);
  if (!universalProxyRuntimeHelper.includes('resolve_llmup_image_lock')) {
    failures.push('universal-proxy-runtime.sh must resolve the locked llmup image through llmup-image-lock.sh');
  }
  if (/\bUNIVERSAL_PROXY_RUNTIME_IMAGE\b/.test(universalProxyRuntimeHelper)) {
    failures.push('universal-proxy-runtime.sh must not allow overriding the locked llmup image');
  }
  if (!universalProxyRuntimeHelper.includes('MBOS_UNIVERSAL_PROXY_BASE_URL')) {
    failures.push('universal-proxy-runtime.sh must export MBOS_UNIVERSAL_PROXY_BASE_URL as the runtime truth');
  }
}

for (const line of CURRENT_RUNTIME_LINE_MANIFEST) {
  const helperPathTruth = readRuntimeLinePathTruthFromShell(line.id);
  if (line.runtimePath.linesRootRelative !== helperPathTruth.lines_root_relative) {
    failures.push(`${line.id} runtime lines root must stay aligned with ${helperPathTruth.lines_root_relative}`);
  }
  if (line.runtimePath.lineRootRelative !== helperPathTruth.line_root_relative) {
    failures.push(`${line.id} runtime line root must stay aligned with ${helperPathTruth.line_root_relative}`);
  }
  if (line.runtimePath.currentRootRelative !== helperPathTruth.current_root_relative) {
    failures.push(`${line.id} runtime current root must stay aligned with ${helperPathTruth.current_root_relative}`);
  }
}

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
  if (demoRehearsal.localRegistryHostPort !== 5003) {
    failures.push('demo rehearsal registry host port truth must stay isolated at 5003');
  }
  if (Number(demoEnv.DEMO_REHEARSAL_SANDBOX_HOST_PORT) !== demoRehearsal.sandboxHostPort) {
    failures.push(`demo rehearsal sandbox host port truth must stay aligned with ${demoRehearsal.sandboxHostPort}`);
  }
  if (Number(demoEnv.FLOW_SITE_ENV_SANDBOX_HOST_PORT) !== demoRehearsal.sandboxHostPort) {
    failures.push(`demo rehearsal site.env sandbox host port override must stay aligned with ${demoRehearsal.sandboxHostPort}`);
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
  if (clusterRehearsal.localRegistryHostPort !== 5002) {
    failures.push('cluster rehearsal registry host port truth must stay isolated at 5002');
  }
  if (clusterEnv.CLUSTER_REHEARSAL_K8S_REGISTRY_HOST !== clusterRehearsal.k8sRegistryHost) {
    failures.push(`cluster rehearsal in-cluster registry host must stay aligned with ${clusterRehearsal.k8sRegistryHost}`);
  }
  if (Number(clusterEnv.CLUSTER_REHEARSAL_SANDBOX_HOST_PORT) !== clusterRehearsal.sandboxHostPort) {
    failures.push(`cluster rehearsal sandbox host port truth must stay aligned with ${clusterRehearsal.sandboxHostPort}`);
  }
  if (Number(clusterEnv.FLOW_SITE_ENV_SANDBOX_HOST_PORT) !== clusterRehearsal.sandboxHostPort) {
    failures.push(`cluster rehearsal site.env sandbox host port override must stay aligned with ${clusterRehearsal.sandboxHostPort}`);
  }
  if (parseUrlPort(clusterEnv.FLOW_SITE_ENV_COMPOSE_INTERNAL_SANDBOX_MANAGER_BASE_URL) !== clusterRehearsal.sandboxHostPort) {
    failures.push(`cluster rehearsal compose-internal sandbox URL override must stay aligned with ${clusterRehearsal.sandboxHostPort}`);
  }
}

if (!/Runtime Lines Matrix/.test(demoDeployOperations)) {
  failures.push('demo deploy operations must point runtime topology readers back to Runtime Lines Matrix');
}

if (!/cluster-rehearsal/.test(clusterDeployOperations) || !/Runtime Lines Matrix/.test(clusterDeployOperations)) {
  failures.push('cluster deploy operations must keep the cluster-rehearsal boundary and Runtime Lines Matrix reference visible');
}

const ruleBindings = Object.fromEntries(CURRENT_RUNTIME_SHARED_RULES.map((rule) => [rule.id, rule.binding]));
if (ruleBindings['shared-local-substrate'] !== 'operational_baseline') {
  failures.push('shared-local-substrate must stay classified as an operational_baseline');
}
if (ruleBindings['single-active-local-flow'] !== 'operational_baseline') {
  failures.push('single-active-local-flow must stay classified as an operational_baseline');
}
if (ruleBindings['scenario-owned-kind-worlds'] !== 'contract') {
  failures.push('scenario-owned-kind-worlds must stay classified as a binding runtime contract');
}
if (ruleBindings['deploy-vs-rehearsal-boundary'] !== 'contract') {
  failures.push('deploy-vs-rehearsal-boundary must stay classified as a binding runtime contract');
}

if (!/operational baseline/i.test(governanceModel)) {
  failures.push('current engineering governance model must describe the local runtime rules as an operational baseline');
}
if (!/操作基线/.test(localRuntimeFlows)) {
  failures.push('Local Runtime Flows must describe shared-local-substrate and single-active-local-flow as an operation baseline');
}
if (!/持续生效的 runtime contract/.test(runtimeLinesMatrix)) {
  failures.push('Runtime Lines Matrix must keep the contract-vs-baseline split visible');
}
if (!/artifacts\/runtime\/lines\/<line>\/current/.test(localRuntimeFlows)) {
  failures.push('Local Runtime Flows must document the shared runtime-line current path pattern');
}
if (!/artifacts\/runtime\/lines\/<line>\/current/.test(runtimeLinesMatrix)) {
  failures.push('Runtime Lines Matrix must document the shared runtime-line current path pattern');
}

if (failures.length > 0) {
  console.error('[contracts] current runtime-line check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[contracts] current runtime-line check passed');
