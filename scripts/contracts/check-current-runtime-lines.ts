import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  CURRENT_RUNTIME_LINE_MANIFEST,
  CURRENT_RUNTIME_SHARED_RULES,
} from '../governance/current-runtime-line-manifest';

const rootDir = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function listFiles(relativeDir: string): string[] {
  const absoluteDir = path.join(rootDir, relativeDir);
  return readdirSync(absoluteDir).flatMap((entry) => {
    const relativePath = path.join(relativeDir, entry);
    const absolutePath = path.join(rootDir, relativePath);
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      return listFiles(relativePath);
    }
    return [relativePath];
  });
}

function parseKeyValueOutput(output: string): Record<string, string> {
  return Object.fromEntries(
    output
      .trim()
      .split('\n')
      .map((line) => line.split(/=(.+)/, 2) as [string, string]),
  );
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

const governanceModel = read('docs/current-engineering-governance-model.md');
const localRuntimeFlows = read('docs/user-guides/local-runtime-flows.md');
const runtimeLinesMatrix = read('docs/user-guides/runtime-lines-matrix.md');
const unifiedDeployOperations = read('docs/user-guides/unified-deploy-operations.md');
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };

const currentRuntimeLineWordingFiles = [
  'scripts/governance/sync-current-runtime-line-docs.ts',
  'docs/user-guides/local-runtime-flows.md',
] as const;
const forbiddenCurrentRuntimeLineWording = [
  {
    snippet: 'unified deploy 用来证明部署',
    message: 'unified deploy must be described as a transition-only focused deploy diagnostic or wiring rehearsal, not deployment proof',
  },
  {
    snippet: 'Unified deploy is the supported deployment runtime.',
    message: 'unified deploy must not be described as the supported deployment runtime',
  },
] as const;

for (const sourcePath of currentRuntimeLineWordingFiles) {
  const content = read(sourcePath);
  for (const forbidden of forbiddenCurrentRuntimeLineWording) {
    if (content.includes(forbidden.snippet)) {
      failures.push(`${sourcePath}: ${forbidden.message}`);
    }
  }
}

const duplicateDepsBootstrapPattern = /\bintegration:deps:up\b[\s\S]{0,1400}?\bmake\s+deps-ready\b/;
for (const sourcePath of listFiles('scripts').filter((filePath) => filePath.endsWith('.sh'))) {
  if (duplicateDepsBootstrapPattern.test(read(sourcePath))) {
    failures.push(`${sourcePath} must call make deps-bootstrap instead of npm run integration:deps:up followed by make deps-ready`);
  }
}

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

const afscpRuntimeHelperPath = 'scripts/lib/afscp-local-runtime.sh';
if (!existsSync(path.join(rootDir, afscpRuntimeHelperPath))) {
  failures.push('backend-real AFSCP startup must use scripts/lib/afscp-local-runtime.sh');
} else {
  const afscpRuntimeHelper = read(afscpRuntimeHelperPath);
  if (!afscpRuntimeHelper.includes('AFSCP_LOCAL_RUNTIME_MODE="${AFSCP_LOCAL_RUNTIME_MODE:-image}"')) {
    failures.push('backend-real AFSCP startup must default to the pinned image runtime, not sibling source');
  }
  if (!afscpRuntimeHelper.includes('agentsmith-fs-control-plane:v1.0.23@sha256:cfffb60189d4c47caf29d783bdb67b91c17789774ff05bca0de45fa5e60f6f3a')) {
    failures.push('backend-real AFSCP startup must pin the current released AFSCP image digest');
  }
}

const afscpLocalRuntimeSource = read('scripts/local-manual/internal-common.sh');
if (!afscpLocalRuntimeSource.includes('afscp_local_runtime_uses_source')) {
  failures.push('AFSCP sibling source startup must be isolated behind explicit source diagnostic mode');
}
if (!afscpLocalRuntimeSource.includes('afscp_local_runtime_uses_image')) {
  failures.push('AFSCP local-real startup must support the default image-backed mode');
}
for (const forbiddenDefault of [
  'AFSCP_LOCAL_RUNTIME_MODE="${AFSCP_LOCAL_RUNTIME_MODE:-source}"',
  'AFSCP_LOCAL_RUNTIME_MODE="${AFSCP_LOCAL_RUNTIME_MODE:-sibling}"',
]) {
  if (afscpLocalRuntimeSource.includes(forbiddenDefault)) {
    failures.push(`AFSCP local-real startup must not default to sibling source mode via ${forbiddenDefault}`);
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

const lineIds = CURRENT_RUNTIME_LINE_MANIFEST.map((line) => line.id);
for (const expectedLine of ['local-manual', 'unified-deploy-local-kind', 'unified-deploy-existing-cluster']) {
  if (!lineIds.includes(expectedLine)) {
    failures.push(`current runtime-line manifest must define ${expectedLine}`);
  }
}

const localLine = CURRENT_RUNTIME_LINE_MANIFEST.find((line) => line.id === 'local-manual');
if (localLine?.surface !== 'local-flow' || !/local-real/.test(localLine.externalPath)) {
  failures.push('local-manual runtime truth must keep local-real as the supported human entrypoint');
}

const deployLines = CURRENT_RUNTIME_LINE_MANIFEST.filter((line) => line.surface === 'deploy-profile');
if (deployLines.length !== 2) {
  failures.push('current deploy runtime truth must expose exactly local-kind and existing-cluster transition-only focused diagnostic entry names');
}
for (const deployLine of deployLines) {
  if (deployLine.guidePath !== 'docs/user-guides/unified-deploy-operations.md') {
    failures.push(`${deployLine.id} must point to Unified Deploy Operations`);
  }
  if (deployLine.evidenceRoot !== 'artifacts/unified-deploy/') {
    failures.push(`${deployLine.id} must use artifacts/unified-deploy/ as evidence root`);
  }
}

const requiredUnifiedDeployScripts = [
  'test:unified-deploy:local-kind:images',
  'test:unified-deploy:local-kind',
  'test:unified-deploy:existing-cluster-smoke',
  'test:unified-deploy:product-flows',
  'test:unified-deploy:render',
  'test:unified-deploy:manifest',
  'test:unified-deploy:api-single-replica',
] as const;
for (const scriptName of requiredUnifiedDeployScripts) {
  if (!packageJson.scripts?.[scriptName]) {
    failures.push(`package.json must expose unified deploy script ${scriptName}`);
  }
}

const ruleBindings = Object.fromEntries(CURRENT_RUNTIME_SHARED_RULES.map((rule) => [rule.id, rule.binding]));
if (ruleBindings['local-real-human-entry'] !== 'operational_baseline') {
  failures.push('local-real-human-entry must stay classified as an operational_baseline');
}
if (ruleBindings['serial-local-runtime-switching'] !== 'operational_baseline') {
  failures.push('serial-local-runtime-switching must stay classified as an operational_baseline');
}
if (ruleBindings['one-agentsmith-deploy'] !== 'contract') {
  failures.push('one-agentsmith-deploy must stay classified as a binding runtime contract');
}
if (ruleBindings['docker-substrate-k8s-app-boundary'] !== 'contract') {
  failures.push('docker-substrate-k8s-app-boundary must stay classified as a binding runtime contract');
}
if (ruleBindings['api-single-replica-current'] !== 'contract') {
  failures.push('api-single-replica-current must stay classified as a binding runtime contract');
}

if (!/operational baseline/i.test(governanceModel)) {
  failures.push('current engineering governance model must describe the local runtime rules as an operational baseline');
}
if (!/操作基线/.test(localRuntimeFlows) || !/local-real/.test(localRuntimeFlows)) {
  failures.push('Local Runtime Flows must describe local-real as the current developer operation baseline');
}
if (!/持续生效的 runtime contract/.test(runtimeLinesMatrix)) {
  failures.push('Runtime Lines Matrix must keep the contract-vs-baseline split visible');
}
if (!/unified deploy/i.test(runtimeLinesMatrix) || !/local-kind/.test(runtimeLinesMatrix) || !/existing-cluster/.test(runtimeLinesMatrix)) {
  failures.push('Runtime Lines Matrix must document the unified deploy local-kind and existing-cluster diagnostic entry names');
}
if (!/artifacts\/unified-deploy\//.test(localRuntimeFlows) || !/artifacts\/unified-deploy\//.test(runtimeLinesMatrix) || !/artifacts\/unified-deploy\//.test(unifiedDeployOperations)) {
  failures.push('runtime-line docs must document artifacts/unified-deploy/ as the deploy evidence root');
}
if (!/serially|串行/.test(localRuntimeFlows) || !/serially|串行/.test(runtimeLinesMatrix)) {
  failures.push('runtime-line docs must tell operators to switch local-real and unified deploy serially');
}
if (!/api replicas?=1|api replicas stay at 1|api replicas fixed at 1/i.test(unifiedDeployOperations + runtimeLinesMatrix)) {
  failures.push('runtime-line docs must state the current api replicas=1 deployment constraint');
}
if (
  !/transition-only focused diagnostic entry names|transition-only diagnostic entry names|过渡期专项诊断/i
    .test(runtimeLinesMatrix + unifiedDeployOperations)
  || !/not separate products|不是两套产品|not two products/i.test(runtimeLinesMatrix + unifiedDeployOperations)
) {
  failures.push('runtime-line docs must state that local-kind/existing-cluster are transition-only diagnostic entry names, not separate products');
}

if (failures.length > 0) {
  console.error('[contracts] current runtime-line check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[contracts] current runtime-line check passed');
