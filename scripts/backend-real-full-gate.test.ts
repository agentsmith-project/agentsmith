import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildStoryFingerprint,
  buildStorySourceFingerprint,
  buildStoryStepMapFingerprint,
  resolveStoryTraceOrderContract,
  type StoryDefinition,
  type StoryStepDefinition,
} from '../e2e/story-contract';
import { getReleaseStoryDefinition } from '../e2e/release-user-story.contract';
import { buildTraceStoryBinding } from '../e2e/story-trace-binding';
import {
  resolveUxTraceBundleDir,
  type UxTraceBundleManifest,
} from '../e2e/trace-bundle-support';
import { CURRENT_RELEASE_BACKEND_REAL_UX_TRACE_MEMBERSHIP } from './governance/current-gate-manifest';

type ValidatorResult = ReturnType<typeof spawnSync>;

function createFile(path: string, content = 'fixture\n'): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function writeJson(path: string, payload: unknown): void {
  createFile(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function readTraceIndexBundles(root: string): unknown[] {
  try {
    const payload = JSON.parse(readFileSync(join(root, 'ux-trace-index.json'), 'utf8')) as { bundles?: unknown };
    return Array.isArray(payload.bundles) ? payload.bundles : [];
  } catch {
    return [];
  }
}

function requiredTraceSteps(story: StoryDefinition): readonly StoryStepDefinition[] {
  return story.steps.filter((step) => step.evidence.includes('trace') && !step.optional);
}

function stepRoute(story: StoryDefinition, step: StoryStepDefinition): string {
  return story.scenes.find((scene) => scene.sceneId === step.sceneId)?.route ?? story.entryRoute;
}

function shellFunctionBody(source: string, functionName: string): string {
  const match = source.match(new RegExp(`^${functionName}\\(\\) \\{\\n([\\s\\S]*?)^\\}`, 'mu'));
  return match?.[1] ?? '';
}

function shellFunctionDefinition(source: string, functionName: string): string {
  const match = source.match(new RegExp(`^${functionName}\\(\\) \\{\\n[\\s\\S]*?^\\}`, 'mu'));
  return match?.[0] ?? '';
}

function renderReview(manifest: UxTraceBundleManifest): string {
  return [
    `# ${manifest.title}`,
    '',
    '- schema: ux_trace_bundle_review/v1',
    `- story_id: ${manifest.story_id}`,
    `- scenario_id: ${manifest.scenario_id}`,
    `- story_fingerprint: ${manifest.story_fingerprint}`,
    `- step_map_fingerprint: ${manifest.step_map_fingerprint}`,
    `- run_id: ${manifest.run_id}`,
    `- outcome: ${manifest.outcome}`,
    '- verdict: accepted',
    '- findings: No blocking findings.',
    '',
  ].join('\n');
}

function writeSemanticTraceBundle(root: string, options: Partial<{
  storyFingerprint: string;
  omitEvents: boolean;
  omitFirstScreenshotFile: boolean;
  suite: string;
  scenarioId: string;
  storyId: string;
}> = {}): string {
  const story = getReleaseStoryDefinition();
  const binding = buildTraceStoryBinding(story);
  const runId = 'standalone-trace-run';
  const suite = options.suite ?? 'integration-release-user-story';
  const storyId = options.storyId ?? story.storyId;
  const scenarioId = options.scenarioId ?? 'integration-release-user-story';
  const bundleDir = resolveUxTraceBundleDir({
    outputRoot: root,
    lane: 'backend-real',
    suite,
    storyId,
    runId,
  });
  const traceSteps = requiredTraceSteps(story);
  const canonicalStoryFingerprint = buildStoryFingerprint(story);
  const stepMapFingerprint = buildStoryStepMapFingerprint(story);
  const events = traceSteps.map((step, index) => {
    const seq = index + 1;
    const screenshot = step.sceneId ? `screenshots/${String(seq).padStart(3, '0')}-${step.stepId}.png` : undefined;
    if (screenshot && !(options.omitFirstScreenshotFile && index === 0)) {
      createFile(join(bundleDir, screenshot), `screenshot for ${step.stepId}\n`);
    }
    return {
      seq,
      ts: '2026-04-12T12:00:00.000Z',
      step_id: step.stepId,
      action: step.action,
      target: step.target,
      route: stepRoute(story, step),
      assertion: step.expectedFeedback,
      note: step.note ?? step.expectedFeedback,
      screenshot,
    };
  });
  const sourceFile = story.sourceFile ?? story.filePath;
  const manifest: UxTraceBundleManifest = {
    version: 1,
    story_id: storyId,
    story_source: binding.storySource,
    story_source_fingerprint: buildStorySourceFingerprint(readFileSync(resolve(sourceFile), 'utf8')),
    story_fingerprint: options.storyFingerprint ?? canonicalStoryFingerprint,
    step_map_fingerprint: stepMapFingerprint,
    scenario_id: scenarioId,
    title: story.title,
    actor: story.actor,
    lane: 'backend-real',
    suite,
    route: story.entryRoute,
    spec_file: 'e2e/integration-release-user-story.spec.ts',
    browser: 'chromium',
    run_id: runId,
    git_sha: 'backend-real-full-gate-test',
    goal: story.goal,
    preconditions: story.preconditions ?? [],
    seed_data: story.seedData ?? [],
    required_trace_steps: traceSteps.map((step) => step.stepId),
    required_screenshot_steps: traceSteps.filter((step) => step.sceneId).map((step) => step.stepId),
    trace_order_contract: resolveStoryTraceOrderContract(story),
    started_at: '2026-04-12T11:59:00.000Z',
    finished_at: '2026-04-12T12:00:00.000Z',
    outcome: 'pass',
    event_count: events.length,
    screenshot_count: events.filter((event) => Boolean(event.screenshot)).length,
    screenshots: events
      .filter((event): event is typeof event & { screenshot: string } => Boolean(event.screenshot))
      .map((event) => ({
        seq: event.seq,
        step_id: event.step_id,
        file: event.screenshot,
        route: event.route,
        note: event.note,
      })),
  };

  writeJson(join(bundleDir, 'manifest.json'), manifest);
  writeJson(join(bundleDir, 'contract-snapshot.json'), {
    version: 1,
    lane: manifest.lane,
    suite: manifest.suite,
    story_id: manifest.story_id,
    scenario_id: manifest.scenario_id,
    run_id: manifest.run_id,
    story_source: binding.storySource,
    story_source_fingerprint: manifest.story_source_fingerprint,
    story_fingerprint: canonicalStoryFingerprint,
    step_map_fingerprint: stepMapFingerprint,
    required_trace_steps: manifest.required_trace_steps,
    required_screenshot_steps: manifest.required_screenshot_steps,
    trace_order_contract: manifest.trace_order_contract,
    steps: traceSteps.map((step) => ({
      step_id: step.stepId,
      action: step.action,
      ...(step.target ? { target: step.target } : {}),
      ...(step.targetMatch ? { target_match: step.targetMatch } : {}),
      scene_id: step.sceneId ?? null,
    })),
  });
  const bundleRelpath = relative(root, bundleDir).split('\\').join('/');
  const preservedBundles = readTraceIndexBundles(root)
    .filter((entry): entry is Record<string, unknown> => (
      Boolean(entry)
      && typeof entry === 'object'
      && (entry as { bundle_relpath?: unknown }).bundle_relpath !== bundleRelpath
    ));
  writeJson(join(root, 'ux-trace-index.json'), {
    version: 1,
    generated_at: '2026-04-12T12:00:01.000Z',
    bundles: [
      ...preservedBundles,
      {
        lane: manifest.lane,
        suite: manifest.suite,
        story_id: manifest.story_id,
        scenario_id: manifest.scenario_id,
        run_id: manifest.run_id,
        bundle_relpath: bundleRelpath,
        manifest_relpath: `${bundleRelpath}/manifest.json`,
        review_relpath: `${bundleRelpath}/review.md`,
        contract_snapshot_relpath: `${bundleRelpath}/contract-snapshot.json`,
      },
    ].sort((left, right) => String(left.bundle_relpath).localeCompare(String(right.bundle_relpath))),
  });
  if (!options.omitEvents) {
    createFile(join(bundleDir, 'events.jsonl'), `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
  }
  createFile(join(bundleDir, 'review.md'), renderReview(manifest));
  return bundleDir;
}

function writeRequiredSemanticTraceBundles(root: string): string[] {
  return CURRENT_RELEASE_BACKEND_REAL_UX_TRACE_MEMBERSHIP
    .map((membership) => writeSemanticTraceBundle(root, {
      suite: membership.suite,
      storyId: membership.storyId,
      scenarioId: membership.scenarioId,
    }))
    .sort((left, right) => left.localeCompare(right));
}

function runTraceValidator(root: string, reportPath = join(root, 'validation.json')): ValidatorResult {
  return spawnSync(
    'npx',
    [
      'tsx',
      'scripts/governance/run-release-full-aggregate.ts',
      'validate-ux-trace-root',
      '--campaign-id',
      'release-full',
      '--step-id',
      'gate-release',
      '--path',
      root,
      '--report',
      reportPath,
      '--valid-paths',
      join(root, 'valid-bundles.txt'),
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );
}

describe('backend-real full gate runtime ownership contract', () => {
  it('fails fast when the pinned AFSCP image cannot run JVS and JuiceFS clone', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');
    const helperStart = script.indexOf('ensure_file_library_afscp_local_runtime()');
    const helperEnd = script.indexOf('FILE_LIBRARY_AFSCP_LOCAL_RUNTIME_OWNED=1', helperStart);
    const helperBody = script.slice(helperStart, helperEnd);

    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helperEnd).toBeGreaterThan(helperStart);
    expect(helperBody).toContain('scripts/afscp-jvs-image-smoke.sh');
    expect(helperBody).toContain('AFSCP_IMAGE="${AFSCP_LOCAL_RUNTIME_IMAGE:-${AFSCP_IMAGE:-}}"');
    expect(helperBody).toContain('export PATH="${FILE_LIBRARY_REAL_GATE_BIN_DIR}:${PATH}"');
    expect(helperBody).toContain('export LD_LIBRARY_PATH="${FILE_LIBRARY_REAL_GATE_BIN_DIR}/juicefs-lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"');
    expect(helperBody).toContain('AFSCP_JUICEFS_OUTPUT_PATH="${FILE_LIBRARY_REAL_GATE_BIN_DIR}/juicefs"');
  });

  it('treats file-library resource recovery as a required substep with dedicated reports instead of smoke-only success', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');

    expect(script).toContain('scripts/file-library-resource-recovery.ts');
    expect(script).toContain('snapshot');
    expect(script).toContain('verify');
    expect(script).toContain('summary');
    expect(script).toContain('run_resource_recovery_step');
    expect(script).toContain('summary_args+=');
    expect(script).toContain('report_paths=(');
    expect(script).toContain('"${RESOURCE_RECOVERY_SMOKE_JSON}"');
    expect(script).not.toContain('"${RESOURCE_RECOVERY_MOUNT_SYNC_JSON}"');
    expect(script).not.toContain('FILE_LIBRARY_RESOURCE_RECOVERY_PROBE_PATH');
    expect(script).toContain('resource-recovery');
    expect(script).toContain('boot-baseline.json');
    expect(script).toContain('baseline.json');
    expect(script).toContain('file-library-api-startup.json');
    expect(script).toContain('report.json');
    expect(script).toContain('report.md');
    expect(script).toContain('startup-report');
    expect(script).toContain('rm -f');
    expect(script).toContain('"${RESOURCE_RECOVERY_STARTUP_JSON}"');
    expect(script).toContain('--boot-baseline "${RESOURCE_RECOVERY_BOOT_BASELINE_JSON}"');
    expect(script).toContain('STARTUP_STEADY_STATE_API_TCP_CONTRACTS=(');
    expect(script).toContain('"api-entry|${POSTGRES_PORT}|ESTABLISHED|0|1"');
    expect(script).toContain('"api-entry|${MONGO_PORT}|ESTABLISHED|4|4"');
    expect(script).toContain('append_startup_steady_state_args startup_args');
    expect(script).toContain('--steady-state-api-tcp');
    expect(script).not.toContain('--allow-api-remote-port');
    expect(script).toContain('"${RESOURCE_RECOVERY_STARTUP_JSON}"');
    expect(script).toContain('--api-pid "${API_PID}"');
    expect(script).not.toContain('npx "${args[@]}" >/dev/null 2>&1 || true');
  });

  it('still writes verify evidence when a smoke step fails and refuses to ignore missing recovery reports', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');

    expect(script).toContain('set +e');
    expect(script).toContain('smoke_status=$?');
    expect(script).toContain('verify_status=0');
    expect(script).toContain('if [[ ! -f "${report_path}" ]]; then');
    expect(script).toContain('missing required recovery report');
    expect(script).not.toContain('if [[ -f "${report_path}" ]]');
  });

  it('writes fallback reports when the Files API smoke verification crashes', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');

    expect(script).toContain('overall_status=0');
    expect(script).toContain('if ! run_resource_recovery_step "file-library-real-smoke"');
    expect(script).not.toContain('if ! run_resource_recovery_step "file-library-mount-sync-smoke"');
    expect(script).toContain('fallback-report');
  });

  it('materializes startup evidence and summary even when the api never reaches ready', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');

    expect(script).toContain('RESOURCE_RECOVERY_PRE_READY_FAILURE=0');
    expect(script).toContain('materialize_pre_ready_failure_evidence()');
    expect(script).toContain('write_startup_resource_recovery_report');
    expect(script).toContain('RESOURCE_RECOVERY_PRE_READY_FAILURE=1');
    expect(script).toContain('--failure-message "${failure_message}"');
    expect(script).toContain('if [[ "${RESOURCE_RECOVERY_PRE_READY_FAILURE}" == "1" ]]; then');
    expect(script).toContain('report_paths=("${RESOURCE_RECOVERY_STARTUP_JSON}")');
    expect(script).toContain('capture_resource_recovery_baseline "${RESOURCE_RECOVERY_FAILURE_OBSERVATION_JSON}"');
    expect(script).toContain('startup_candidate_args+=(--failure-observation "${RESOURCE_RECOVERY_FAILURE_OBSERVATION_JSON}")');
    expect(script).toContain('File library gate could not materialize startup resource recovery evidence before exiting.');
  });

  it('passes campaign-uploaded child internal evidence root to nested backend-real specs', () => {
    const script = readFileSync('scripts/backend-real-full-gate.sh', 'utf8');
    const runRealCommand = shellFunctionBody(script, 'run_real_cmd');

    expect(script).toContain(
      'CHILD_INTERNAL_EVIDENCE_DIR="${RELEASE_REAL_CHILD_INTERNAL_EVIDENCE_DIR:-$(dirname "${LOCAL_READY_LOG_DIR}")/child-internal-evidence}"',
    );
    expect(runRealCommand).toContain('local child_internal_real_dir="${CHILD_INTERNAL_EVIDENCE_DIR}/internal-gate-${api_port}"');
    expect(runRealCommand).toContain('export INTERNAL_REAL_DIR="${child_internal_real_dir}"');
    expect(runRealCommand).toContain('export INTERNAL_REAL_CHILD_EVIDENCE_DIR="${CHILD_INTERNAL_EVIDENCE_DIR}"');
    expect(script).toContain(
      'run_release_gate_step "backend_real_scenario" "Files restore continuation backend-real scenario failed: npm run test:e2e:integration:files:user-stories:restore-continue" run_real_cmd 21020 3121 "npm run test:e2e:integration:files:user-stories:restore-continue"',
    );
  });

  it('treats a fail-verdict startup report as materialized evidence during pre-ready failure handling when the report file exists', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');
    const helperStart = script.indexOf('materialize_pre_ready_failure_evidence()');
    const helperEnd = script.indexOf('write_resource_recovery_summary()', helperStart);
    const helperBody = script.slice(helperStart, helperEnd);

    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helperEnd).toBeGreaterThan(helperStart);
    expect(helperBody).toContain('capture_resource_recovery_baseline "${RESOURCE_RECOVERY_FAILURE_OBSERVATION_JSON}"');
    expect(helperBody).toContain('startup_candidate_args=(');
    expect(helperBody).toContain('--startup-candidate "${STARTUP_QUIESCE_SNAPSHOT_JSON}"');
    expect(helperBody).toContain('if [[ -f "${RESOURCE_RECOVERY_FAILURE_OBSERVATION_JSON}" ]]; then');
    expect(helperBody).toContain('startup_candidate_args+=(--failure-observation "${RESOURCE_RECOVERY_FAILURE_OBSERVATION_JSON}")');
    expect(helperBody).toContain('if write_startup_resource_recovery_report "${failure_message}"');
    expect(helperBody).toContain('[[ -f "${RESOURCE_RECOVERY_STARTUP_JSON}" ]]');
    expect(helperBody).toContain('return 0');
    expect(helperBody).not.toContain('cp "${STARTUP_QUIESCE_SNAPSHOT_JSON}" "${RESOURCE_RECOVERY_BASELINE_JSON}"');
  });

  it('falls back to a plain failure-observation snapshot when owned api capture loses authority mid-materialization', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');
    const helperStart = script.indexOf('materialize_pre_ready_failure_evidence()');
    const helperEnd = script.indexOf('write_resource_recovery_summary()', helperStart);
    const helperBody = script.slice(helperStart, helperEnd);

    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helperEnd).toBeGreaterThan(helperStart);
    expect(helperBody).toContain('capture_resource_recovery_baseline "${RESOURCE_RECOVERY_FAILURE_OBSERVATION_JSON}"');
    expect(helperBody).toContain('if [[ "${capture_status}" -ne 0 ]]; then');
    expect(helperBody).toContain('local -a plain_snapshot_args=(');
    expect(helperBody).toContain('snapshot');
    expect(helperBody).toContain('--output "${RESOURCE_RECOVERY_FAILURE_OBSERVATION_JSON}"');
    expect(helperBody).toContain('npx "${plain_snapshot_args[@]}"');
    expect(helperBody).not.toContain('--api-pid "${API_PID}"');
  });

  it('captures the file-library boot baseline without running the retired orphan preflight', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');
    const trapIndex = script.indexOf("trap 'cleanup $?' EXIT");
    const bootBaselineCaptureIndex = script.indexOf('ensure_boot_resource_recovery_baseline', trapIndex + 1);

    expect(script).not.toContain('scripts/juicefs-orphan-preflight.ts');
    expect(script).not.toContain('--apply --context "file-library-real-gate"');
    expect(script).toContain('ensure_boot_resource_recovery_baseline()');
    expect(trapIndex).toBeGreaterThanOrEqual(0);
    expect(bootBaselineCaptureIndex).toBeGreaterThanOrEqual(0);
    expect(trapIndex).toBeLessThan(bootBaselineCaptureIndex);
  });

  it('does not keep orphan preflight failure handling in the file-library real gate', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');

    expect(script).not.toContain('juicefs orphan preflight failed before boot baseline');
    expect(script).not.toContain('if ! npx tsx "${ROOT_DIR}/scripts/juicefs-orphan-preflight.ts"');
  });

  it('fails closed when an authority-tagged api baseline snapshot starts but loses the tracked pid mid-capture', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');

    expect(script).toContain('capture_resource_recovery_baseline()');
    expect(script).toContain('if [[ -n "${API_PID}" ]]; then');
    expect(script).toContain('API_PID="$(resolve_owned_api_listener_pid)"');
    expect(script).toContain('local -a api_snapshot_args=("${snapshot_args[@]}" --api-pid "${API_PID}")');
    expect(script).toContain('npx "${api_snapshot_args[@]}"');
    expect(script).toContain('return 0');
    expect(script).not.toContain('if npx "${api_snapshot_args[@]}"; then');
  });

  it('does not register the retired mount-sync smoke as file-library real-gate evidence', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');

    expect(script).not.toContain('file-library-mount-sync-smoke');
    expect(script).not.toContain('FILE_LIBRARY_RESOURCE_RECOVERY_PROBE_PATH');
  });

  it('uses the backend-real loopback Keycloak default so the file-library gate can refresh tokens against the real stack', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');

    expect(script).toContain('INTEGRATION_KEYCLOAK_PORT:-18080');
    expect(script).not.toContain('INTEGRATION_KEYCLOAK_PORT:-28081');
    expect(script).toContain('resolve_reachable_keycloak_base');
    expect(script).toContain('.well-known/openid-configuration');
  });

  it('resolves loopback dependency ports from reachable backend-real services instead of assuming the env-file integration ports are authoritative', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');

    expect(script).toContain('resolve_reachable_tcp_port');
    expect(script).toContain('15432');
    expect(script).toContain('17017');
    expect(script).toContain('19000');
  });

  it('starts file-library gate api under the owner-aware local runtime contract instead of tracking the wrapper pid directly', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');

    expect(script).toContain('scripts/lib/local-runtime-processes.sh');
    expect(script).toContain('LOCAL_RUNTIME_RUN_ID=');
    expect(script).toContain('LOCAL_RUNTIME_LINE_KIND=');
    expect(script).toContain('LOCAL_RUNTIME_OWNER_TOKEN=');
    expect(script).toContain('LOCAL_RUNTIME_PROCESS_STATE_DIR=');
    expect(script).toContain('API_ROOT_PID="$(');
    expect(script).toContain('local_runtime_start_owned_service api "${API_PORT}" "${API_LOG}" bash -lc');
    expect(script).not.toContain('npm run api:node:dev >"${API_LOG}" 2>&1 &');
    expect(script).not.toContain('API_PID=$!');
  });

  it('starts and stops its own AFSCP local-real runtime inside the file-library owner gate lifecycle', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');
    const trapIndex = script.indexOf("trap 'cleanup $?' EXIT");
    const ensureIndex = script.indexOf('\nensure_file_library_afscp_local_runtime\n', trapIndex);
    const apiStartIndex = script.indexOf('API_ROOT_PID="$(', trapIndex);
    const cleanupStart = script.indexOf('cleanup() {');
    const cleanupEnd = script.indexOf("trap 'cleanup $?' EXIT", cleanupStart);
    const cleanupBody = script.slice(cleanupStart, cleanupEnd);
    const stopAfscpIndex = cleanupBody.indexOf('stop_file_library_afscp_local_runtime');
    const stopApiIndex = cleanupBody.indexOf('local_runtime_stop_owned_process_tree "${API_ROOT_PID}" api "${API_PORT}"');

    expect(script).toContain('ensure_file_library_afscp_local_runtime()');
    expect(script).toContain('stop_file_library_afscp_local_runtime()');
    expect(script).toContain('source "${ROOT_DIR}/scripts/local-manual/internal-common.sh"');
    expect(script).toContain('ensure_afscp_local_runtime');
    expect(script).toContain('stop_afscp_local_runtime');
    expect(trapIndex).toBeGreaterThanOrEqual(0);
    expect(ensureIndex).toBeGreaterThan(trapIndex);
    expect(apiStartIndex).toBeGreaterThan(ensureIndex);
    expect(cleanupBody).toContain('FILE_LIBRARY_AFSCP_LOCAL_RUNTIME_OWNED');
    expect(cleanupBody).toContain('local cleanup_afscp_status=0');
    expect(stopAfscpIndex).toBeGreaterThanOrEqual(0);
    expect(stopApiIndex).toBeGreaterThan(stopAfscpIndex);
    expect(script).not.toContain('run-internal-agent-task-real-gate.sh');
  });

  it('resets the file-library-owned AFSCP local-real data before ensuring the runtime', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');
    const ensureStart = script.indexOf('ensure_file_library_afscp_local_runtime()');
    const ensureEnd = script.indexOf('stop_file_library_afscp_local_runtime()', ensureStart);
    const ensureBody = script.slice(ensureStart, ensureEnd);
    const sourceIndex = ensureBody.indexOf('source "${ROOT_DIR}/scripts/local-manual/internal-common.sh"');
    const ensureKindIndex = ensureBody.indexOf('\n    ensure_kind_cluster\n', sourceIndex);
    const stopIndex = ensureBody.indexOf('stop_afscp_local_runtime >/dev/null 2>&1 || true');
    const markerIndex = ensureBody.indexOf('export AFSCP_ENVIRONMENT=local-real');
    const resetIndex = ensureBody.indexOf('reset_owned_afscp_local_runtime_for_gate');
    const ensureRuntimeIndex = ensureBody.indexOf('ensure_afscp_local_runtime', resetIndex + 1);

    expect(ensureStart).toBeGreaterThanOrEqual(0);
    expect(ensureEnd).toBeGreaterThan(ensureStart);
    expect(sourceIndex).toBeGreaterThanOrEqual(0);
    expect(ensureKindIndex).toBeGreaterThan(sourceIndex);
    expect(stopIndex).toBeGreaterThanOrEqual(0);
    expect(markerIndex).toBeGreaterThan(stopIndex);
    expect(resetIndex).toBeGreaterThan(ensureKindIndex);
    expect(resetIndex).toBeGreaterThan(markerIndex);
    expect(ensureRuntimeIndex).toBeGreaterThan(resetIndex);
  });

  it('declares isolated file-library AFSCP defaults derived from the gate api port', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');

    expect(script).toContain('AFSCP_BASE_URL="${AFSCP_BASE_URL:-http://127.0.0.1:$((API_PORT + 9030))}"');
    expect(script).toContain('AFSCP_EXPORT_GATEWAY_BASE_URL="${AFSCP_EXPORT_GATEWAY_BASE_URL:-http://127.0.0.1:$((API_PORT + 9031))}"');
    expect(script).toContain('AFSCP_DEFAULT_VOLUME_ID="${AFSCP_DEFAULT_VOLUME_ID:-vol_file_library_${API_PORT}}"');
    expect(script).toContain('DATABASE_URL="${DATABASE_URL:-postgresql://mbos:mbos_dev_password@${POSTGRES_HOST}:${POSTGRES_PORT}/mbos?sslmode=disable}"');
    expect(script).toContain('AFSCP_CALLER_SERVICE="${AFSCP_CALLER_SERVICE:-agentsmith-api}"');
    expect(script).toContain('AFSCP_SERVICE_TOKEN="${AFSCP_SERVICE_TOKEN:-agentsmith-local-afscp-product-token}"');
    expect(script).toContain('AFSCP_BOOTSTRAP_CALLER_SERVICE="${AFSCP_BOOTSTRAP_CALLER_SERVICE:-agentsmith-bootstrap}"');
    expect(script).toContain('AFSCP_BOOTSTRAP_SERVICE_TOKEN="${AFSCP_BOOTSTRAP_SERVICE_TOKEN:-agentsmith-local-afscp-bootstrap-token}"');
    expect(script).toContain('AFSCP_ORCHESTRATOR_CALLER_SERVICE="${AFSCP_ORCHESTRATOR_CALLER_SERVICE:-agentsmith-sandbox-control-plane}"');
    expect(script).toContain('AFSCP_ORCHESTRATOR_SERVICE_TOKEN="${AFSCP_ORCHESTRATOR_SERVICE_TOKEN:-agentsmith-local-afscp-orchestrator-token}"');
  });

  it('passes the full AFSCP client contract into the file-library api launch command', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');
    const commandStart = script.indexOf('build_file_library_api_launch_command()');
    const commandEnd = script.indexOf('capture_resource_recovery_baseline()', commandStart);
    const commandBody = script.slice(commandStart, commandEnd);

    expect(commandStart).toBeGreaterThanOrEqual(0);
    expect(commandEnd).toBeGreaterThan(commandStart);
    for (const key of [
      'AFSCP_BASE_URL',
      'AFSCP_EXPORT_GATEWAY_BASE_URL',
      'AFSCP_DEFAULT_VOLUME_ID',
      'AFSCP_CALLER_SERVICE',
      'AFSCP_SERVICE_TOKEN',
      'AFSCP_BOOTSTRAP_CALLER_SERVICE',
      'AFSCP_BOOTSTRAP_SERVICE_TOKEN',
      'AFSCP_ORCHESTRATOR_CALLER_SERVICE',
      'AFSCP_ORCHESTRATOR_SERVICE_TOKEN',
    ]) {
      expect(commandBody).toContain(`${key}=$(printf '%q' "\${${key}}")`);
    }
    expect(commandBody).toContain('npm run api:node:dev');
  });

  it('passes the existing local-manual AFSCP helper contract when starting the file-library runtime', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');
    const ensureStart = script.indexOf('ensure_file_library_afscp_local_runtime()');
    const ensureEnd = script.indexOf('stop_file_library_afscp_local_runtime()', ensureStart);
    const ensureBody = script.slice(ensureStart, ensureEnd);

    expect(ensureStart).toBeGreaterThanOrEqual(0);
    expect(ensureEnd).toBeGreaterThan(ensureStart);
    expect(ensureBody).toContain('export INTERNAL_REAL_DIR="${FILE_LIBRARY_REAL_GATE_AFSCP_DIR}"');
    expect(ensureBody).toContain('export LOCAL_MANUAL_INTERNAL_ENV_FILE=/dev/null');
    expect(ensureBody).toContain('export DATABASE_URL');
    expect(ensureBody).toContain('export AFSCP_DATABASE_URL="${DATABASE_URL}"');
    expect(ensureBody).toContain('export AFSCP_EXPORT_GATEWAY_POSTGRES_DSN="${DATABASE_URL}"');
    expect(ensureBody).toContain('export POSTGRES_PORT');
    expect(ensureBody).toContain('export MINIO_API_PORT="${MINIO_PORT}"');
    expect(ensureBody).toContain('export KEYCLOAK_PORT');
    expect(ensureBody).toContain('export SUBSTRATE_POSTGRES_PORT="${POSTGRES_PORT}"');
    expect(ensureBody).toContain('export SUBSTRATE_MINIO_API_PORT="${MINIO_PORT}"');
    expect(ensureBody).toContain('ensure_afscp_local_runtime');
  });

  it('resolves the current owned api listener pid from the listening port before handing pid truth to resource recovery', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');

    expect(script).toContain('resolve_owned_api_listener_pid()');
    expect(script).toContain('local_runtime_port_listener_pids "${API_PORT}"');
    expect(script).toContain('local_runtime_verified_owner_pid_for_tree_member "${listener_pid}" api "${API_PORT}"');
    expect(script).toContain('[[ "${owner_pid}" == "${API_ROOT_PID}" ]]');
    expect(script).toContain('API_PID="$(resolve_owned_api_listener_pid');
  });

  it('uses the owned root pid for cleanup, records cleanup failures, and still writes the summary first', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');
    const cleanupStart = script.indexOf('cleanup() {');
    const cleanupEnd = script.indexOf("trap 'cleanup $?' EXIT", cleanupStart);
    const cleanupBody = script.slice(cleanupStart, cleanupEnd);

    expect(cleanupStart).toBeGreaterThanOrEqual(0);
    expect(cleanupEnd).toBeGreaterThan(cleanupStart);
    expect(cleanupBody).toContain('write_resource_recovery_summary');
    expect(cleanupBody).toContain('local cleanup_stop_status=0');
    expect(cleanupBody).toContain('local cleanup_wait_status=0');
    expect(cleanupBody).toContain('local -a summary_extra_args=()');
    expect(cleanupBody).toContain('local_runtime_stop_owned_process_tree "${API_ROOT_PID}" api "${API_PORT}"');
    expect(cleanupBody).toContain('cleanup_stop_status=$?');
    expect(cleanupBody).toContain('local_runtime_wait_port_free "${API_PORT}" api 10');
    expect(cleanupBody).toContain('cleanup_wait_status=$?');
    expect(cleanupBody).toContain('summary_extra_args+=(');
    expect(cleanupBody).toContain('--extra-finding');
    expect(cleanupBody).toContain('cleanup failed to stop the owned AFSCP local runtime');
    expect(cleanupBody).toContain('cleanup failed to stop the owned api process tree');
    expect(cleanupBody).toContain('cleanup failed to confirm api port');
    expect(cleanupBody).toContain('write_resource_recovery_summary "${summary_extra_args[@]}"');
    expect(cleanupBody).toContain('if [[ "${summary_status}" -ne 0 || "${cleanup_afscp_status}" -ne 0 || "${cleanup_stop_status}" -ne 0 || "${cleanup_wait_status}" -ne 0 ]]; then');
    expect(cleanupBody).not.toContain('local_runtime_stop_owned_process_tree "${API_ROOT_PID}" api "${API_PORT}" || true');
    expect(cleanupBody).not.toContain('local_runtime_wait_port_free "${API_PORT}" api 10 || true');
    expect(cleanupBody).not.toContain('kill "${API_PID}" >/dev/null 2>&1 || true');
    expect(cleanupBody).not.toContain('wait "${API_PID}" >/dev/null 2>&1 || true');
  });

  it('does not let api port release masquerade as owned runtime cleanup truth in the final summary', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');
    const cleanupStart = script.indexOf('cleanup() {');
    const cleanupEnd = script.indexOf("trap 'cleanup $?' EXIT", cleanupStart);
    const cleanupBody = script.slice(cleanupStart, cleanupEnd);
    const stopConditionIndex = cleanupBody.indexOf('if [[ "${cleanup_stop_status}" -ne 0 ]]; then');
    const waitConditionIndex = cleanupBody.indexOf('if [[ "${cleanup_wait_status}" -ne 0 ]]; then');
    const stopFindingIndex = cleanupBody.indexOf(
      '"cleanup failed to stop the owned api process tree on port ${API_PORT} with exit code ${cleanup_stop_status}"',
    );
    const waitFindingIndex = cleanupBody.indexOf(
      '"cleanup failed to confirm api port ${API_PORT} became free after stopping the owned api process tree with exit code ${cleanup_wait_status}"',
    );

    expect(stopConditionIndex).toBeGreaterThanOrEqual(0);
    expect(waitConditionIndex).toBeGreaterThan(stopConditionIndex);
    expect(stopFindingIndex).toBeGreaterThan(stopConditionIndex);
    expect(waitFindingIndex).toBeGreaterThan(waitConditionIndex);
    expect(cleanupBody).toContain('if [[ "${#summary_extra_args[@]}" -gt 0 ]]; then');
    expect(cleanupBody).toContain('write_resource_recovery_summary "${summary_extra_args[@]}"');
    expect(cleanupBody).not.toContain('cleanup confirmed the owned api process tree was cleared');
    expect(cleanupBody).not.toContain('cleanup succeeded because api port');
    expect(cleanupBody).not.toContain('if [[ "${cleanup_stop_status}" -eq 0 && "${cleanup_wait_status}" -eq 0 ]]; then');
  });

  it('waits for a minimally stable startup window before freezing the ready baseline so startup helper transients do not immediately poison it', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');

    expect(script).toContain('wait_for_startup_quiesce()');
    expect(script).toContain('freeze_startup_ready_baseline_from_quiesce_proof()');
    expect(script).toContain('startup_quiesce_snapshot_satisfies_steady_state()');
    expect(script).toContain('"${RESOURCE_RECOVERY_BOOT_BASELINE_JSON}"');
    expect(script).toContain('append_startup_steady_state_args startup_args');
    expect(script).toContain('--steady-state-api-tcp');
    expect(script).not.toContain('STARTUP_STEADY_STATE_HELPER_LABEL_ALLOWANCES=(');
    expect(script).not.toContain('--steady-state-helper-label');
    expect(script).not.toContain('"helper:mc|0"');
    expect(script).toContain('STARTUP_QUIESCE_TIMEOUT_SECONDS');
    expect(script).toContain('STARTUP_QUIESCE_STABLE_SAMPLES');
    expect(script).toContain('if ! freeze_startup_ready_baseline_from_quiesce_proof; then');
    expect(script).not.toContain('startup_helper_labels_within_steady_state()');
    expect(script).not.toContain('startup_quiesce_snapshot_meets_warmed_floor()');
    expect(script).not.toContain('STARTUP_WARMED_FLOOR_API_TCP_REQUIREMENTS=(');
  });

  it('binds startup steady-state proof and ready-baseline freeze to the same authority object instead of a pid-only handoff check', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');
    const freezeFnStart = script.indexOf('freeze_startup_ready_baseline_from_quiesce_proof()');
    const freezeFnEnd = script.indexOf('write_startup_resource_recovery_report()', freezeFnStart);
    const freezeBody = script.slice(freezeFnStart, freezeFnEnd);

    expect(freezeFnStart).toBeGreaterThanOrEqual(0);
    expect(freezeFnEnd).toBeGreaterThan(freezeFnStart);
    expect(script).toContain('STARTUP_QUIESCE_AUTHORITY_JSON=');
    expect(script).toContain('write_startup_listener_authority_file()');
    expect(script).toContain('startup_listener_authority_matches_saved_file()');
    expect(script).toContain('local_runtime_process_identity_token');
    expect(script).toContain('local_runtime_read_sidecar_field');
    expect(freezeBody).toContain('current_listener_pid="$(resolve_owned_api_listener_pid 2>/dev/null || true)"');
    expect(freezeBody).toContain('startup_listener_authority_matches_saved_file "${STARTUP_QUIESCE_AUTHORITY_JSON}" "${current_listener_pid}"');
    expect(freezeBody).toContain('cp "${STARTUP_QUIESCE_SNAPSHOT_JSON}" "${RESOURCE_RECOVERY_BASELINE_JSON}"');
    expect(script).not.toContain('STARTUP_QUIESCE_PROVEN_LISTENER_PID=');
    expect(freezeBody).not.toContain('[[ "${current_listener_pid}" == "${STARTUP_QUIESCE_PROVEN_LISTENER_PID}" ]]');
    expect(freezeBody).not.toContain('capture_resource_recovery_baseline "${RESOURCE_RECOVERY_BASELINE_JSON}"');
  });

  it('revalidates the saved startup authority object before reusing a startup candidate during pre-ready failure materialization', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');
    const helperStart = script.indexOf('materialize_pre_ready_failure_evidence()');
    const helperEnd = script.indexOf('write_resource_recovery_summary()', helperStart);
    const helperBody = script.slice(helperStart, helperEnd);

    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helperEnd).toBeGreaterThan(helperStart);
    expect(helperBody).toContain('if [[ -f "${STARTUP_QUIESCE_SNAPSHOT_JSON}" && -f "${STARTUP_QUIESCE_AUTHORITY_JSON}" ]]; then');
    expect(helperBody).toContain('current_listener_pid="$(resolve_owned_api_listener_pid 2>/dev/null || true)"');
    expect(helperBody).toContain('startup_listener_authority_matches_saved_file "${STARTUP_QUIESCE_AUTHORITY_JSON}" "${current_listener_pid}"');
    expect(helperBody).toContain('startup_candidate_args+=(--comparison-current-source startup_candidate)');
    expect(helperBody).toContain('startup_candidate_args+=(--comparison-current-source failure_observation)');
  });

  it('uses a single startup steady-state contract inside startup-report instead of a shell-only warmed floor authority', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');
    const quiesceFnIndex = script.indexOf('startup_quiesce_snapshot_satisfies_steady_state()');
    const startupReportIndex = script.indexOf('local startup_status=0', quiesceFnIndex);

    expect(script).toContain('STARTUP_STEADY_STATE_API_TCP_CONTRACTS=(');
    expect(script).toContain('"api-entry|${MONGO_PORT}|ESTABLISHED|4|4"');
    expect(script).not.toContain('STARTUP_WARMED_FLOOR_API_TCP_REQUIREMENTS=(');
    expect(script).not.toContain('startup_quiesce_snapshot_meets_warmed_floor');
    expect(quiesceFnIndex).toBeGreaterThanOrEqual(0);
    expect(startupReportIndex).toBeGreaterThan(quiesceFnIndex);
  });

  it('preserves the last startup candidate snapshot and report across quiesce retries instead of deleting them before timeout materialization', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');
    const quiesceFnIndex = script.indexOf('startup_quiesce_snapshot_satisfies_steady_state()');
    const quiesceFnEnd = script.indexOf('wait_for_startup_quiesce()', quiesceFnIndex);
    const quiesceBody = script.slice(quiesceFnIndex, quiesceFnEnd);

    expect(quiesceFnIndex).toBeGreaterThanOrEqual(0);
    expect(quiesceFnEnd).toBeGreaterThan(quiesceFnIndex);
    expect(quiesceBody).toContain('local snapshot_tmp="${STARTUP_QUIESCE_SNAPSHOT_JSON}.tmp"');
    expect(quiesceBody).toContain('local report_tmp="${STARTUP_QUIESCE_REPORT_JSON}.tmp"');
    expect(quiesceBody).toContain('local authority_tmp="${STARTUP_QUIESCE_AUTHORITY_JSON}.tmp"');
    expect(quiesceBody).toContain('if [[ -f "${snapshot_tmp}" && -f "${report_tmp}" && -f "${authority_tmp}" ]]; then');
    expect(quiesceBody).toContain('mv "${snapshot_tmp}" "${STARTUP_QUIESCE_SNAPSHOT_JSON}"');
    expect(quiesceBody).toContain('mv "${report_tmp}" "${STARTUP_QUIESCE_REPORT_JSON}"');
    expect(quiesceBody).toContain('mv "${authority_tmp}" "${STARTUP_QUIESCE_AUTHORITY_JSON}"');
    expect(quiesceBody).not.toContain('rm -f "${STARTUP_QUIESCE_SNAPSHOT_JSON}" "${STARTUP_QUIESCE_REPORT_JSON}"');
  });

  it('fails closed when startup quiesce never settles instead of freezing a fake ready baseline', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');
    const quiesceBlockStart = script.indexOf('if ! wait_for_startup_quiesce; then');
    const quiesceBlockEnd = script.indexOf('if ! freeze_startup_ready_baseline_from_quiesce_proof; then', quiesceBlockStart);
    const quiesceBlock = script.slice(quiesceBlockStart, quiesceBlockEnd);

    expect(quiesceBlockStart).toBeGreaterThanOrEqual(0);
    expect(quiesceBlockEnd).toBeGreaterThan(quiesceBlockStart);
    expect(quiesceBlock).toContain(
      'pre_ready_failure_reason="file-library gate startup quiesce did not settle before the declared steady-state contract"',
    );
    expect(quiesceBlock).toContain('materialize_pre_ready_failure_evidence "${pre_ready_failure_reason}"');
    expect(quiesceBlock).toContain('File library gate could not materialize startup resource recovery evidence before exiting.');
    expect(quiesceBlock).toContain('exit 1');
    expect(quiesceBlock).not.toContain('proceeding with the current owned API listener pid');
  });

  it('warms authenticated docstore steady-state before startup quiesce freezes the ready baseline', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');
    const warmupIndex = script.indexOf('perform_startup_authenticated_docstore_warmup');
    const quiesceIndex = script.indexOf('wait_for_startup_quiesce', warmupIndex + 1);

    expect(script).toContain('STARTUP_WARMUP_TOKEN_FILE=');
    expect(script).toContain('perform_startup_authenticated_docstore_warmup()');
    expect(script).toContain('node "${ROOT_DIR}/scripts/agent-runner-refresh-token.js" > "${STARTUP_WARMUP_TOKEN_FILE}"');
    expect(script).toContain('Authorization: Bearer $(cat "${STARTUP_WARMUP_TOKEN_FILE}")');
    expect(script).toContain('"${API_BASE%/}/api/v1/workspaces/ws_default/projects/proj_1/file-libraries"');
    expect(script).not.toContain('"${API_BASE%/}/api/v1/me/desktop/file-libraries"');
    expect(script).toContain('authenticated docStore warmup failed before freezing the ready baseline');
    expect(warmupIndex).toBeGreaterThanOrEqual(0);
    expect(quiesceIndex).toBeGreaterThan(warmupIndex);
  });

  it('uses the shared owner-aware runtime helpers instead of undefined port helpers', () => {
    const script = readFileSync('scripts/backend-real-full-gate.sh', 'utf8');

    expect(script).toContain('scripts/lib/local-runtime-processes.sh');
    expect(script).toContain('scripts/lib/backend-real-gate-ports.sh');
    expect(script).toContain('local_runtime_port_is_listening');
    expect(script).toContain('local_runtime_start_owned_service');
    expect(script).toContain('local_runtime_stop_owned_process_tree');
    expect(script).toContain('cleanup_gate_ports "${api_port}" "${web_port}"');

    expect(script).not.toMatch(/\bis_port_listening\b/);
    expect(script).not.toMatch(/\bkill_port_listeners\b/);
  });

  it('sources backend-real state helpers before using release run ownership helpers', () => {
    const script = readFileSync('scripts/backend-real-full-gate.sh', 'utf8');
    const sourceIndex = script.indexOf('source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"');
    const newRunDirIndex = script.indexOf('backend_real_new_run_dir');
    const pruneCurrentIndex = script.indexOf('backend_real_prune_forbidden_current_entries');
    const markRunStatusIndex = script.indexOf('backend_real_mark_run_status');

    expect(sourceIndex).toBeGreaterThanOrEqual(0);
    expect(newRunDirIndex).toBeGreaterThan(sourceIndex);
    expect(pruneCurrentIndex).toBeGreaterThan(sourceIndex);
    expect(markRunStatusIndex).toBeGreaterThan(sourceIndex);
  });

  it('assigns release services to a run-scoped owner token before starting local API and Web', () => {
    const script = readFileSync('scripts/backend-real-full-gate.sh', 'utf8');

    expect(script).toMatch(/LOCAL_RUNTIME_RUN_ID="\$\{RUN_ID\}"/);
    expect(script).toMatch(/LOCAL_RUNTIME_LINE_KIND="release_backend_real"/);
    expect(script).toMatch(/LOCAL_RUNTIME_OWNER_TOKEN="\$\{RUN_ID\}:release_backend_real:/);
    expect(script).toMatch(/LOCAL_RUNTIME_PROCESS_STATE_DIR="\$\{RELEASE_RUN_ROOT\}\/processes"/);
  });

  it('does not treat local-kind image handoff readiness as kind cluster bootstrap readiness', () => {
    const script = readFileSync('scripts/backend-real-full-gate.sh', 'utf8');
    const prewarmStart = script.indexOf('prewarm_internal_kind_cluster()');
    const prewarmEnd = script.indexOf('cleanup() {', prewarmStart);
    const prewarmBody = script.slice(prewarmStart, prewarmEnd);

    expect(prewarmBody).not.toContain('readiness_state_field_ready_with_identity local_kind_image_import_completed');
    expect(prewarmBody).not.toContain('reusing parent-verified local kind cluster');
    expect(prewarmBody).toContain('ensure_local_kind_cluster');
  });

  it('lets internal Agent Task gates skip runner rebuild only with matching runner image readiness identity', () => {
    const script = readFileSync('scripts/lib/internal-backend-real-gate.sh', 'utf8');
    const runnerReuseBody = shellFunctionBody(script, 'internal_real_gate_runner_image_reuse_ready');
    const prepareBody = shellFunctionBody(script, 'prepare_internal_backend_real_gate_runtime');

    expect(script).toContain('internal_real_gate_runner_image_reuse_ready()');
    expect(runnerReuseBody).toContain('runner_image_id="$(internal_real_gate_runner_image_id "${RUNNER_IMAGE}")"');
    expect(runnerReuseBody).toContain('[[ -n "${runner_image_id}" ]] || return 1');
    expect(runnerReuseBody).toContain('readiness_state_field_ready_with_identity runner_image_digest_prepared');
    expect(runnerReuseBody).toContain('runner_image_ref=${RUNNER_IMAGE}');
    expect(runnerReuseBody).toContain('runner_image_id=${runner_image_id}');
    expect(script).toContain('reusing parent-verified runner image digest');
    expect(script).not.toContain('internal_real_gate_local_kind_image_import_reuse_ready()');
    expect(prepareBody).not.toContain('readiness_state_field_ready_with_identity local_kind_image_import_completed');
    expect(prepareBody).not.toContain('reusing parent-verified kind runner image import');
    expect(prepareBody).not.toContain('reusing parent-verified CSI image import');
    expect(prepareBody).toContain('internal_real_gate_ensure_kind_image "${RUNNER_IMAGE}"');
    expect(prepareBody).toContain('internal_real_gate_ensure_afscp_storage_csi');
  });

  it('imports internal gate kind image tarballs through stdin redirection instead of a pipe', () => {
    const script = readFileSync('scripts/lib/internal-backend-real-gate.sh', 'utf8');
    const body = shellFunctionBody(script, 'internal_real_gate_ensure_kind_image');
    const ensureLocalIndex = body.indexOf('internal_real_gate_ensure_local_image "${image}"');
    const dockerSaveIndex = body.indexOf('docker save "${image}" -o "${tarball}"');

    expect(ensureLocalIndex).toBeGreaterThanOrEqual(0);
    expect(dockerSaveIndex).toBeGreaterThanOrEqual(0);
    expect(ensureLocalIndex).toBeLessThan(dockerSaveIndex);
    expect(body).not.toMatch(/cat\s+"\$\{tarball\}"\s*\|\s*docker exec -i/u);
    expect(body).toMatch(/docker exec -i "\$\{KIND_NODE_NAME\}"[\s\S]*< "\$\{tarball\}"/u);
    expect(body).toContain('trap \'rm -f "${tarball}"\' EXIT');
  });

  it('lets the release user story reuse runner build while handing ASBCP a digest-pinned kind registry image', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');
    const runnerReuseBody = shellFunctionBody(script, 'release_user_story_runner_image_reuse_ready');
    const csiBody = shellFunctionBody(script, 'ensure_afscp_storage_csi');
    const prepareBody = shellFunctionBody(script, 'prepare_release_user_story_managed_runner_image_handoff');

    expect(script).toContain('scripts/lib/run-readiness-state.sh');
    expect(script).toContain('scripts/lib/managed-runner-image-handoff.sh');
    expect(script).toContain('release_user_story_runner_image_reuse_ready()');
    expect(runnerReuseBody).toContain('runner_image_id="$(release_user_story_runner_image_id)"');
    expect(runnerReuseBody).toContain('[[ -n "${runner_image_id}" ]] || return 1');
    expect(runnerReuseBody).toContain('readiness_state_field_ready_with_identity runner_image_digest_prepared');
    expect(runnerReuseBody).toContain('runner_image_ref=${RUNNER_IMAGE}');
    expect(runnerReuseBody).toContain('runner_image_id=${runner_image_id}');
    expect(script).toContain('reusing parent-verified runner image digest');
    expect(script).not.toContain('release_user_story_local_kind_image_import_reuse_ready()');
    expect(script).toContain('prepare_release_user_story_managed_runner_image_handoff');
    expect(prepareBody).toContain('managed_runner_image_handoff_is_digest_ref "${RUNNER_IMAGE}"');
    expect(prepareBody).toContain('RUNNER_IMAGE="$(release_user_story_publish_local_runner_image_ref "${RUNNER_IMAGE}")"');
    expect(prepareBody).toContain('release_user_story_preflight_kind_registry_runner_image');
    expect(csiBody).not.toContain('readiness_state_field_ready_with_identity local_kind_image_import_completed');
    expect(csiBody).not.toContain('reusing parent-verified kind image imports');
    expect(csiBody).toContain('if ! release_user_story_runner_image_from_kind_registry; then');
    expect(csiBody).toContain('ensure_kind_image "${RUNNER_IMAGE}"');
    expect(csiBody).toContain('wait_for_afscp_storage_csi_ready');
  });

  it('ensures release user story kind image imports pull the local image before docker save', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');
    const body = shellFunctionBody(script, 'ensure_kind_image');
    const ensureLocalIndex = body.indexOf('ensure_local_image "${image}"');
    const dockerSaveIndex = body.indexOf('docker save "${image}" -o "${tarball}"');

    expect(ensureLocalIndex).toBeGreaterThanOrEqual(0);
    expect(dockerSaveIndex).toBeGreaterThanOrEqual(0);
    expect(ensureLocalIndex).toBeLessThan(dockerSaveIndex);
  });

  it('exposes a gate-scoped AFSCP local runtime reset helper with the local-real marker', () => {
    const helper = readFileSync('scripts/lib/afscp-local-runtime.sh', 'utf8');

    expect(helper).toContain('export AFSCP_ENVIRONMENT="${AFSCP_ENVIRONMENT:-local-real}"');
    expect(helper).toContain('export AFSCP_LOCAL_RUNTIME_MODE="${AFSCP_LOCAL_RUNTIME_MODE:-image}"');
    expect(helper).toContain('export AFSCP_LOCAL_RUNTIME_IMAGE="${AFSCP_LOCAL_RUNTIME_IMAGE:-${AFSCP_IMAGE:-ghcr.io/agentsmith-project/agentsmith-fs-control-plane:v1.0.31@sha256:4b7f3f9251519faddc9f11632ae38a3553e4bc0e7f1c42016d247f7928abffeb}}"');
    expect(helper).toContain('prepare_afscp_gate_juicefs_from_image()');
    expect(helper).toContain('AFSCP_JUICEFS_OUTPUT_PATH="${bin_dir}/juicefs"');
    expect(helper).toContain('export PATH="${runtime_dir}/bin:${PATH}"');
    expect(helper).toContain('export LD_LIBRARY_PATH="${runtime_dir}/bin/juicefs-lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"');
    expect(helper).toContain('if [[ "${AFSCP_LOCAL_RUNTIME_MODE}" == "image" && "${runtime_command}" == "ensure_afscp_local_runtime" ]]; then');
    expect(helper).toContain('probe_afscp_read_export_for_gate()');
    expect(helper).toContain('AFSCP_READ_EXPORT_PROBE_LOG="${AFSCP_READ_EXPORT_PROBE_LOG:-${runtime_dir}/afscp-read-export-probe.log}"');
    expect(helper).toContain('node "${AFSCP_LOCAL_RUNTIME_ROOT_DIR}/scripts/lib/afscp-read-export-probe.mjs"');
    expect(helper).toContain('probe_afscp_read_export_for_gate "${runtime_dir}"');
    expect(helper).toContain('reset_afscp_local_runtime_for_gate()');
    expect(helper).toContain('with_afscp_local_runtime_env "${runtime_dir}" reset_owned_afscp_local_runtime_for_gate');
  });

  it('resets owned integration AFSCP local-real data before ensuring the runtime', () => {
    const script = readFileSync('scripts/run-integration-e2e-full.sh', 'utf8');
    const start = script.indexOf('ensure_integration_afscp_local_runtime()');
    const end = script.indexOf('stop_integration_afscp_local_runtime()', start);
    const body = script.slice(start, end);
    const stopIndex = body.indexOf('stop_afscp_local_runtime_for_gate "${INTEGRATION_AFSCP_DIR}"');
    const kindIndex = body.indexOf('ensure_integration_afscp_local_kind_context || return 1');
    const resetIndex = body.indexOf('reset_afscp_local_runtime_for_gate "${INTEGRATION_AFSCP_DIR}"');
    const ensureIndex = body.indexOf('ensure_afscp_local_runtime_for_gate "${INTEGRATION_AFSCP_DIR}"');

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(stopIndex).toBeGreaterThanOrEqual(0);
    expect(kindIndex).toBeGreaterThan(stopIndex);
    expect(resetIndex).toBeGreaterThan(kindIndex);
    expect(ensureIndex).toBeGreaterThan(resetIndex);
  });

  it('fails fast and preserves AFSCP local runtime log tails when integration runtime bootstrap fails', () => {
    const script = readFileSync('scripts/run-integration-e2e-full.sh', 'utf8');
    const ensureBody = shellFunctionBody(script, 'ensure_integration_afscp_local_runtime');
    const kindBody = shellFunctionBody(script, 'ensure_integration_afscp_local_kind_context');
    const collectorBody = shellFunctionBody(script, 'collect_integration_afscp_local_runtime_failure_evidence');
    const failureIndex = script.indexOf('if ! ensure_integration_afscp_local_runtime; then');
    const collectIndex = script.indexOf('collect_integration_afscp_local_runtime_failure_evidence', failureIndex);
    const recordIndex = script.indexOf(
      'gate_record_failure "${INTEGRATION_LOG_DIR}" "infra_dependency_unready" "afscp_local_runtime"',
      failureIndex,
    );

    expect(kindBody).toContain('LOCAL_KIND_FINAL_KUBECONFIG_PATH="${target_kubeconfig}"');
    expect(kindBody).toContain('export KIND_CLUSTER_NAME KIND_CONTEXT_NAME LOCAL_KIND_CLUSTER_NAME LOCAL_KIND_FINAL_KUBECONFIG_PATH KUBECONFIG');
    expect(kindBody).toContain('ensure_local_kind_cluster || return 1');
    expect(kindBody).toContain('kubectl config use-context "${KIND_CONTEXT_NAME}"');
    expect(ensureBody).toContain('ensure_integration_afscp_local_kind_context || return 1');
    expect(ensureBody).toContain('reset_afscp_local_runtime_for_gate "${INTEGRATION_AFSCP_DIR}" || return 1');
    expect(ensureBody).toContain('ensure_afscp_local_runtime_for_gate "${INTEGRATION_AFSCP_DIR}" || return 1');
    expect(collectorBody).toContain('CURRENT_GATE_RESULT_EVIDENCE_DIR:-${INTEGRATION_LOG_DIR}');
    expect(collectorBody).toContain('afscp-export-gateway.log');
    expect(collectorBody).toContain('afscp-api.log');
    expect(collectorBody).toContain('afscp-worker.log');
    expect(collectorBody).toContain('afscp-read-export-probe.log');
    expect(failureIndex).toBeGreaterThanOrEqual(0);
    expect(collectIndex).toBeGreaterThan(failureIndex);
    expect(recordIndex).toBeGreaterThan(collectIndex);
  });

  it('resets owned release user-story AFSCP local-real data before ensuring the runtime', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');
    const start = script.indexOf('ensure_release_user_story_afscp_local_runtime()');
    const end = script.indexOf('stop_release_user_story_afscp_local_runtime()', start);
    const body = script.slice(start, end);
    const stopIndex = body.indexOf('stop_afscp_local_runtime_for_gate "${INTEGRATION_AFSCP_DIR}"');
    const resetIndex = body.indexOf('reset_afscp_local_runtime_for_gate "${INTEGRATION_AFSCP_DIR}"');
    const ensureIndex = body.indexOf('ensure_afscp_local_runtime_for_gate "${INTEGRATION_AFSCP_DIR}"');

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(stopIndex).toBeGreaterThanOrEqual(0);
    expect(resetIndex).toBeGreaterThan(stopIndex);
    expect(ensureIndex).toBeGreaterThan(resetIndex);
  });

  it('captures an authoritative release-ready API pid from the shared local runtime helper while preserving root cleanup ownership', () => {
    const script = readFileSync('scripts/backend-real-full-gate.sh', 'utf8');

    expect(script).toContain('LOCAL_API_ROOT_PID=""');
    expect(script).toContain('LOCAL_API_PID=""');
    expect(script).toContain('LOCAL_API_ROOT_PID="$(');
    expect(script).toContain('local_runtime_start_owned_service api "${API_PORT}" "${API_LOG}" env');
    expect(script).toContain(
      'LOCAL_API_PID="$(local_runtime_capture_authoritative_service_pid "${LOCAL_API_ROOT_PID}" api "${API_PORT}"',
    );
    expect(script).toContain('local_runtime_stop_owned_process_tree "${LOCAL_API_ROOT_PID}" api "${API_PORT}"');
    expect(script).not.toContain('LOCAL_API_PID="$(\n      local_runtime_start_owned_service api "${API_PORT}" "${API_LOG}" env');
  });

  it('passes executable commands to local_runtime_start_owned_service instead of shell-only helper functions', () => {
    const script = readFileSync('scripts/backend-real-full-gate.sh', 'utf8');

    expect(script).not.toMatch(/local_runtime_start_owned_service[\s\S]*?env[\s\S]*?run_clean npm run api:node:dev/);
    expect(script).not.toMatch(/local_runtime_start_owned_service[\s\S]*?env[\s\S]*?run_clean bash scripts\/run-next-dev-safe\.sh/);
    expect(script).toContain('env -u http_proxy -u https_proxy -u all_proxy');
  });

  it('invokes backend-real:ready with explicit release-ready ports and without ambient integration port leakage', () => {
    const script = readFileSync('scripts/backend-real-full-gate.sh', 'utf8');
    const readyCommandStart = script.indexOf("run_cmd \"env -u INTEGRATION_API_PORT -u INTEGRATION_WEB_PORT");
    const readyCommandEnd = script.indexOf('npm run backend-real:ready', readyCommandStart);
    const readyCommand = script.slice(readyCommandStart, readyCommandEnd);

    expect(script).toContain(
      "run_cmd \"env -u INTEGRATION_API_PORT -u INTEGRATION_WEB_PORT BACKEND_REAL_READY_PROBE_ONLY=1 INTEGRATION_PARENT_STACK_REUSE=true BACKEND_REAL_STATE_DIR='${RELEASE_RUN_ROOT}' API_PORT='${API_PORT}' WEB_PORT='${WEB_PORT}'",
    );
    expect(readyCommand).toContain('BACKEND_REAL_READY_PROBE_ONLY=1');
    expect(readyCommand).toContain('INTEGRATION_PARENT_STACK_REUSE=true');
    expect(script).toContain("KEYCLOAK_PORT='${KEYCLOAK_PORT}'");
    expect(script).toContain("API_BASE='${RUNTIME_HOST_API_BASE_URL}'");
    expect(script).toContain("BASE_URL='${RUNTIME_BROWSER_WEB_BASE_URL}'");
    expect(script).toContain("KEYCLOAK_BASE_URL='${KEYCLOAK_BASE_URL}'");
    expect(script).toContain('npm run backend-real:ready');
  });

  it('uses isolated release dependency and app ports instead of demo-facing defaults', () => {
    const script = readFileSync('scripts/backend-real-full-gate.sh', 'utf8');

    expect(script).toContain('API_PORT="${PORT_API:-${API_PORT:-20090}}"');
    expect(script).toContain('WEB_PORT="${PORT_WEB:-${WEB_PORT:-3091}}"');
    expect(script).toContain('POSTGRES_PORT="${POSTGRES_PORT:-${INTEGRATION_POSTGRES_PORT:-25432}}"');
    expect(script).toContain('MONGO_PORT="${MONGO_PORT:-${INTEGRATION_MONGO_PORT:-27027}}"');
    expect(script).toContain('REDIS_PORT="${REDIS_PORT:-${INTEGRATION_REDIS_PORT:-26379}}"');
    expect(script).toContain('REDIS_PASSWORD="${REDIS_PASSWORD:-mbos_dev_password}"');
    expect(script).toContain('MINIO_API_PORT="${MINIO_API_PORT:-${INTEGRATION_MINIO_API_PORT:-29000}}"');
    expect(script).toContain('MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT:-${INTEGRATION_MINIO_CONSOLE_PORT:-29001}}"');
    expect(script).toContain('KEYCLOAK_PORT="${KEYCLOAK_PORT:-${INTEGRATION_KEYCLOAK_PORT:-28081}}"');
    expect(script).toContain("MINIO_PORT=\"${MINIO_PORT:-${MINIO_API_PORT}}\"");
    expect(script).toContain("DATABASE_URL=\"${DATABASE_URL:-postgresql://mbos:mbos_dev_password@localhost:${POSTGRES_PORT}/mbos}\"");
    expect(script).toContain("MONGO_URL=\"${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:${MONGO_PORT}/admin}\"");
    expect(script).toContain("POSTGRES_PORT='${POSTGRES_PORT}' MONGO_PORT='${MONGO_PORT}' REDIS_PORT='${REDIS_PORT}' REDIS_PASSWORD='${REDIS_PASSWORD}' MINIO_API_PORT='${MINIO_API_PORT}' MINIO_CONSOLE_PORT='${MINIO_CONSOLE_PORT}' KEYCLOAK_PORT='${KEYCLOAK_PORT}'");
    expect(script).not.toContain('API_PORT="${PORT_API:-20000}"');
    expect(script).not.toContain('WEB_PORT="${PORT_WEB:-3001}"');
    expect(script).not.toContain('MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:17017/admin}"');
    expect(script).not.toContain('KEYCLOAK_PORT="${KEYCLOAK_PORT:-18080}"');
    expect(script).not.toContain('MINIO_PORT="${MINIO_PORT:-19000}"');
  });

  it('keeps authoritative release ux traces scoped to release-owned browser specs and isolates visual review traces under a side artifact dir', () => {
    const script = readFileSync('scripts/backend-real-full-gate.sh', 'utf8');
    const visualReviewIndex = script.indexOf("RELEASE_REAL_VISUAL_ARTIFACT_DIR='${VISUAL_REVIEW_ARTIFACT_DIR}' npm run test:visual:backend-real:review");
    const browserSpecsIndex = script.indexOf(
      'run_release_gate_step "backend_real_scenario" "release browser UX trace scenarios failed" run_release_browser_trace_specs',
      visualReviewIndex,
    );
    const releaseStoryIndex = script.indexOf("ARTIFACT_DIR='${ARTIFACT_DIR}' RESET_FIRST=0 bash scripts/run-integration-release-user-story.sh");

    expect(script).toContain('AUTHORITATIVE_UX_TRACE_ROOT="${ARTIFACT_DIR}/ux-traces"');
    expect(script).toContain('VISUAL_REVIEW_ARTIFACT_DIR="${ARTIFACT_DIR}/visual-review"');
    expect(script).toContain("RELEASE_REAL_VISUAL_ARTIFACT_DIR='${VISUAL_REVIEW_ARTIFACT_DIR}'");
    expect(script).toContain('npm run test:visual:backend-real:review');
    expect(script).toContain('e2e/integration-system-admin-entry.spec.ts');
    expect(script).toContain('e2e/integration-workspace-public-login.spec.ts');
    expect(script).toContain('e2e/integration-workspace-entry.spec.ts');
    expect(script).toContain('e2e/integration-workspace-publish-usable.spec.ts');
    expect(script).toContain('e2e/integration-workspace-settings-directory.spec.ts');
    expect(script).toContain("ARTIFACT_DIR='${ARTIFACT_DIR}' RESET_FIRST=0 bash scripts/run-integration-release-user-story.sh");
    expect(script).toContain("--path '${AUTHORITATIVE_UX_TRACE_ROOT}'");
    expect(visualReviewIndex).toBeGreaterThanOrEqual(0);
    expect(browserSpecsIndex).toBeGreaterThan(visualReviewIndex);
    expect(releaseStoryIndex).toBeGreaterThan(browserSpecsIndex);
  });

  it('records backend-real child step failures as scenario evidence before fail-fast exit', () => {
    const script = readFileSync('scripts/backend-real-full-gate.sh', 'utf8');
    const body = shellFunctionBody(script, 'run_release_gate_step');

    expect(body).toContain('set +e');
    expect(body).toContain('(\n    set -e\n    "$@"\n  )');
    expect(body).toContain('"$@"');
    expect(script).toContain('release_child_infra_failure_classification()');
    expect(body).toContain('child_classification="$(release_child_infra_failure_classification || true)"');
    expect(body).toContain('gate_record_failure "${LOCAL_READY_LOG_DIR}" "${child_classification}" "${stage}" "${message}"');
    expect(body).toContain('gate_record_failure "${LOCAL_READY_LOG_DIR}" "scenario_assertion_failed" "${stage}" "${message}"');
    expect(body).toContain('exit "${status}"');
    expect(script).toContain(
      'run_release_gate_step "backend_real_scenario" "backend-real focused Playwright scenarios failed: npm run backend-real:run" run_real_cmd 20050 3051 "npm run backend-real:run"',
    );
    expect(script).toContain(
      'run_release_gate_step "backend_real_scenario" "backend-real visual review scenario failed: npm run test:visual:backend-real:review" run_real_cmd 20080 3081',
    );
    expect(script).toContain(
      'run_release_gate_step "backend_real_scenario" "release browser UX trace scenarios failed" run_release_browser_trace_specs',
    );
    expect(script).toContain(
      'run_release_user_story_gate_step "backend_real_scenario" "release user story backend-real scenario failed: scripts/run-integration-release-user-story.sh"',
    );
  });

  it('preserves run_real_cmd fail-fast cleanup semantics under the gate-step failure wrapper', () => {
    const script = readFileSync('scripts/backend-real-full-gate.sh', 'utf8');
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'backend-real-full-gate-cleanup-flow-'));
    const runnerPath = join(fixtureRoot, 'runner.sh');
    const failureLog = join(fixtureRoot, 'failures.log');
    const cleanupLog = join(fixtureRoot, 'cleanup.log');
    const scenarioLog = join(fixtureRoot, 'scenario.log');

    try {
      writeFileSync(runnerPath, [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        `ROOT_DIR="${fixtureRoot}"`,
        `LOCAL_READY_LOG_DIR="${fixtureRoot}"`,
        `CHILD_INTERNAL_EVIDENCE_DIR="${fixtureRoot}/child-internal-evidence"`,
        'PRESET_ENDPOINT_API_KEY_VALUE="fixture-key"',
        'gate_record_failure() {',
        '  printf "%s|%s|%s\\n" "$2" "$3" "$4" >> "${LOCAL_READY_LOG_DIR}/failures.log"',
        '}',
        'cleanup_gate_ports() {',
        '  printf "cleanup\\n" >> "${LOCAL_READY_LOG_DIR}/cleanup.log"',
        '  return 37',
        '}',
        'info() {',
        '  printf "%s\\n" "$*" >> "${LOCAL_READY_LOG_DIR}/info.log"',
        '}',
        shellFunctionDefinition(script, 'run_real_cmd'),
        shellFunctionDefinition(script, 'release_child_infra_failure_classification'),
        shellFunctionDefinition(script, 'run_release_gate_step'),
        `run_release_gate_step "backend_real_scenario" "backend-real focused Playwright scenarios failed: npm run backend-real:run" run_real_cmd 20050 3051 "printf scenario-ran > '${scenarioLog}'"`,
        '',
      ].join('\n'));

      const result = spawnSync('bash', [runnerPath], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      expect(result.status).toBe(37);
      expect(readFileSync(failureLog, 'utf8')).toBe(
        'scenario_assertion_failed|backend_real_scenario|backend-real focused Playwright scenarios failed: npm run backend-real:run\n',
      );
      expect(readFileSync(cleanupLog, 'utf8')).toBe('cleanup\n');
      expect(existsSync(scenarioLog)).toBe(false);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('preserves child internal infra preflight classification in the release native result path', () => {
    const script = readFileSync('scripts/backend-real-full-gate.sh', 'utf8');
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'backend-real-full-gate-child-classification-'));
    const runnerPath = join(fixtureRoot, 'runner.sh');
    const failureLog = join(fixtureRoot, 'failures.log');

    try {
      writeFileSync(runnerPath, [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        `LOCAL_READY_LOG_DIR="${fixtureRoot}"`,
        `CHILD_INTERNAL_EVIDENCE_DIR="${fixtureRoot}/child-internal-evidence"`,
        'gate_record_failure() {',
        '  printf "%s|%s|%s\\n" "$2" "$3" "$4" >> "${LOCAL_READY_LOG_DIR}/failures.log"',
        '}',
        'failing_internal_preflight() {',
        '  mkdir -p "${CHILD_INTERNAL_EVIDENCE_DIR}/internal-gate-20050"',
        '  printf \'{"classification":"infra_dependency_unready","stage":"internal_runtime_preflight","message":"Error response from daemon: write /var/lib/docker/tmp/x: no space left on device"}\\n\' > "${CHILD_INTERNAL_EVIDENCE_DIR}/internal-gate-20050/failure-classification.json"',
        '  return 42',
        '}',
        shellFunctionDefinition(script, 'release_child_infra_failure_classification'),
        shellFunctionDefinition(script, 'run_release_gate_step'),
        'run_release_gate_step "backend_real_scenario" "backend-real focused Playwright scenarios failed: npm run backend-real:run" failing_internal_preflight',
        '',
      ].join('\n'));

      const result = spawnSync('bash', [runnerPath], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      expect(result.status).toBe(42);
      expect(readFileSync(failureLog, 'utf8')).toBe(
        'infra_dependency_unready|backend_real_scenario|backend-real focused Playwright scenarios failed: npm run backend-real:run\n',
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('classifies release user story runtime readiness failures as stability blockers', () => {
    const script = readFileSync('scripts/backend-real-full-gate.sh', 'utf8');
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'backend-real-full-gate-release-story-runtime-'));
    const runnerPath = join(fixtureRoot, 'runner.sh');
    const failureLog = join(fixtureRoot, 'failures.log');
    const detailsPath = join(
      fixtureRoot,
      'child-internal-evidence',
      'integration_release_user_story',
      'runtime-readiness-details.json',
    );

    try {
      writeFileSync(runnerPath, [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        `LOCAL_READY_LOG_DIR="${fixtureRoot}"`,
        `CHILD_INTERNAL_EVIDENCE_DIR="${fixtureRoot}/child-internal-evidence"`,
        'gate_record_failure() {',
        '  printf "%s|%s|%s\\n" "$2" "$3" "$4" >> "${LOCAL_READY_LOG_DIR}/failures.log"',
        '}',
        'failing_release_story() {',
        '  mkdir -p "${CHILD_INTERNAL_EVIDENCE_DIR}/integration_release_user_story"',
        '  printf \'{"classification":"stability_blocker"}\\n\' > "${CHILD_INTERNAL_EVIDENCE_DIR}/integration_release_user_story/runtime-readiness-details.json"',
        '  return 43',
        '}',
        shellFunctionDefinition(script, 'runtime_readiness_details_classification'),
        shellFunctionDefinition(script, 'run_release_user_story_gate_step'),
        'run_release_user_story_gate_step "backend_real_scenario" "release user story backend-real scenario failed: scripts/run-integration-release-user-story.sh" failing_release_story',
        '',
      ].join('\n'));

      const result = spawnSync('bash', [runnerPath], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      expect(result.status).toBe(43);
      expect(readFileSync(failureLog, 'utf8')).toBe(
        `stability_blocker|backend_real_scenario|release user story backend-real scenario failed: scripts/run-integration-release-user-story.sh; runtime readiness stability blocker: ${detailsPath}\n`,
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('propagates the first failed release browser trace spec under the gate-step failure wrapper', () => {
    const script = readFileSync('scripts/backend-real-full-gate.sh', 'utf8');
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'backend-real-full-gate-control-flow-'));
    const runnerPath = join(fixtureRoot, 'runner.sh');
    const failureLog = join(fixtureRoot, 'failures.log');
    const specLog = join(fixtureRoot, 'specs.log');

    try {
      writeFileSync(runnerPath, [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        `LOCAL_READY_LOG_DIR="${fixtureRoot}"`,
        'gate_record_failure() {',
        '  printf "%s|%s|%s\\n" "$2" "$3" "$4" >> "${LOCAL_READY_LOG_DIR}/failures.log"',
        '}',
        'run_release_browser_trace_spec() {',
        '  local spec_file="$1"',
        '  printf "%s\\n" "${spec_file}" >> "${LOCAL_READY_LOG_DIR}/specs.log"',
        '  if [[ "${spec_file}" == "e2e/integration-system-admin-entry.spec.ts" ]]; then',
        '    return 37',
        '  fi',
        '  return 0',
        '}',
        shellFunctionDefinition(script, 'release_child_infra_failure_classification'),
        shellFunctionDefinition(script, 'run_release_gate_step'),
        shellFunctionDefinition(script, 'run_release_browser_trace_specs'),
        'run_release_gate_step "backend_real_scenario" "release browser UX trace scenarios failed" run_release_browser_trace_specs',
        '',
      ].join('\n'));

      const result = spawnSync('bash', [runnerPath], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      expect(result.status).toBe(37);
      expect(readFileSync(failureLog, 'utf8')).toBe(
        'scenario_assertion_failed|backend_real_scenario|release browser UX trace scenarios failed\n',
      );
      expect(readFileSync(specLog, 'utf8')).toBe('e2e/integration-system-admin-entry.spec.ts\n');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('runs moved release browser trace specs on the parent-owned release stack instead of spawning nested stacks', () => {
    const script = readFileSync('scripts/backend-real-full-gate.sh', 'utf8');
    const start = script.indexOf('run_release_browser_trace_specs()');
    const end = script.indexOf('\nrun_cmd "POSTGRES_PORT=', start);
    const body = script.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(body).toContain('run_release_browser_trace_spec "e2e/integration-system-admin-entry.spec.ts"');
    expect(body).toContain('run_release_browser_trace_spec "e2e/integration-workspace-public-login.spec.ts"');
    expect(body).toContain('run_release_browser_trace_spec "e2e/integration-workspace-entry.spec.ts"');
    expect(body).toContain('run_release_browser_trace_spec "e2e/integration-workspace-publish-usable.spec.ts"');
    expect(body).toContain('run_release_browser_trace_spec "e2e/integration-workspace-settings-directory.spec.ts"');
    expect(body).toContain('INTEGRATION_PARENT_STACK_REUSE=true');
    expect(body).toContain('INTEGRATION_PARENT_STACK_OWNER_TOKEN="${LOCAL_RUNTIME_OWNER_TOKEN}"');
    expect(body).toContain('INTEGRATION_PARENT_STACK_API_ROOT_PID="${LOCAL_API_ROOT_PID}"');
    expect(body).toContain('INTEGRATION_PARENT_STACK_API_PID="${LOCAL_API_PID}"');
    expect(body).toContain('INTEGRATION_PARENT_STACK_WEB_ROOT_PID="${LOCAL_WEB_PID}"');
    expect(body).toContain('INTEGRATION_PARENT_STACK_DEPS_READY=true');
    expect(body).toContain('INTEGRATION_PARENT_STACK_DEPS_INIT_READY=true');
    expect(body).toContain('INTEGRATION_API_PORT="${API_PORT}"');
    expect(body).toContain('INTEGRATION_WEB_PORT="${WEB_PORT}"');
    expect(body).toContain('INTEGRATION_RUN_ROOT="${RELEASE_RUN_ROOT}/browser-trace-specs/${spec_slug}"');
    expect(body).not.toContain('run_real_cmd 20084');
    expect(body).not.toContain('run_real_cmd 20086');
    expect(body).not.toContain('run_real_cmd 20088');
    expect(body).not.toContain('run_real_cmd 20092');
    expect(body).not.toContain('run_real_cmd 20094');
    expect(body).not.toContain('cleanup_gate_ports "${API_PORT}" "${WEB_PORT}"');
  });

  it('fails closed before parent-stack browser reuse when release API or Web ports are already occupied', () => {
    const script = readFileSync('scripts/backend-real-full-gate.sh', 'utf8');
    const ensureStart = script.indexOf('ensure_local_release_stack()');
    const ensureEnd = script.indexOf('prewarm_internal_kind_cluster()', ensureStart);
    const ensureBody = script.slice(ensureStart, ensureEnd);
    const apiFailIndex = ensureBody.indexOf('fail_if_release_stack_port_already_in_use api "${API_PORT}"');
    const webFailIndex = ensureBody.indexOf('fail_if_release_stack_port_already_in_use web "${WEB_PORT}"');
    const apiStartIndex = ensureBody.indexOf('local_runtime_start_owned_service api "${API_PORT}"');
    const webStartIndex = ensureBody.indexOf('local_runtime_start_owned_service web "${WEB_PORT}"');

    expect(script).toContain('fail_if_release_stack_port_already_in_use()');
    expect(script).toContain('parent stack reuse requires release-owned API/Web ports');
    expect(apiFailIndex).toBeGreaterThanOrEqual(0);
    expect(webFailIndex).toBeGreaterThan(apiFailIndex);
    expect(apiStartIndex).toBeGreaterThan(webFailIndex);
    expect(webStartIndex).toBeGreaterThan(apiStartIndex);
    expect(ensureBody).not.toContain('if ! local_runtime_port_is_listening "${API_PORT}"; then');
    expect(ensureBody).not.toContain('if ! local_runtime_port_is_listening "${WEB_PORT}"; then');
  });

  it('includes Files restore continuation in the release-grade backend-real lane after core coverage', () => {
    const script = readFileSync('scripts/backend-real-full-gate.sh', 'utf8');
    const coreIndex = script.indexOf('run_real_cmd 20050 3051 "npm run backend-real:run"');
    const restoreContinueIndex = script.indexOf(
      'run_real_cmd 21020 3121 "npm run test:e2e:integration:files:user-stories:restore-continue"',
    );
    const visualReviewIndex = script.indexOf(
      'run_real_cmd 20080 3081 "RELEASE_REAL_VISUAL_ARTIFACT_DIR=',
    );

    expect(coreIndex).toBeGreaterThanOrEqual(0);
    expect(restoreContinueIndex).toBeGreaterThan(coreIndex);
    expect(visualReviewIndex).toBeGreaterThan(restoreContinueIndex);
  });

  it('delegates standalone UX trace evidence acceptance to the semantic validator instead of find review.md', () => {
    const script = readFileSync('scripts/backend-real-full-gate.sh', 'utf8');

    expect(script).toContain('scripts/governance/run-release-full-aggregate.ts validate-ux-trace-root');
    expect(script).toContain('--campaign-id release-full');
    expect(script).toContain('--step-id gate-release');
    expect(script).toContain('UX_TRACE_VALIDATION_REPORT');
    expect(script).toContain('UX_TRACE_VALID_BUNDLES');
    expect(script).toContain('backend_real_ux_trace_bundle');
    expect(script).not.toContain('scripts/validate-ux-trace-bundles.ts');
    expect(script).not.toContain('find "${ARTIFACT_DIR}/ux-traces" -type f -name review.md');
  });

  it('rejects legacy standalone UX trace evidence that only contains review.md', () => {
    const root = mkdtempSync(join(tmpdir(), 'backend-real-trace-legacy-'));
    try {
      createFile(join(root, 'legacy', 'review.md'), '# Legacy UX trace review\n');

      const result = runTraceValidator(root);

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain('ux-trace-index.json');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts a semantically complete standalone UX trace bundle and writes reusable evidence indexes', () => {
    const root = mkdtempSync(join(tmpdir(), 'backend-real-trace-valid-'));
    try {
      const reportPath = join(root, 'validation.json');
      const bundleDirs = writeRequiredSemanticTraceBundles(root);

      const result = runTraceValidator(root, reportPath);

      expect(result.status).toBe(0);
      for (const bundleDir of bundleDirs) {
        expect(result.stdout).toContain(bundleDir);
      }
      const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
        valid_count: number;
        valid_bundle_paths: string[];
      };
      expect(report.valid_count).toBe(bundleDirs.length);
      expect(report.valid_bundle_paths).toEqual(bundleDirs);
      expect(readFileSync(join(root, 'valid-bundles.txt'), 'utf8')).toBe(`${bundleDirs.join('\n')}\n`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects standalone UX trace evidence that is semantically valid but outside the current release story membership', () => {
    const root = mkdtempSync(join(tmpdir(), 'backend-real-trace-membership-'));
    try {
      writeSemanticTraceBundle(root, {
        suite: 'integration-governance-member-workflow-continuity',
        scenarioId: 'integration-governance-member-workflow-continuity',
        storyId: 'governance-member-workflow-continuity',
      });

      const result = runTraceValidator(root);

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain('integration-release-user-story');
      expect(`${result.stdout}\n${result.stderr}`).toContain('release-user-story-end-to-end');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects standalone UX trace evidence when story fingerprints drift', () => {
    const root = mkdtempSync(join(tmpdir(), 'backend-real-trace-fingerprint-'));
    try {
      writeSemanticTraceBundle(root, {
        storyFingerprint: `sha256:${'1'.repeat(64)}`,
      });

      const result = runTraceValidator(root);

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain('story_fingerprint drift');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects standalone UX trace evidence with missing events or screenshots', () => {
    const missingEventsRoot = mkdtempSync(join(tmpdir(), 'backend-real-trace-missing-events-'));
    const missingScreenshotRoot = mkdtempSync(join(tmpdir(), 'backend-real-trace-missing-screenshot-'));
    try {
      writeSemanticTraceBundle(missingEventsRoot, { omitEvents: true });
      writeSemanticTraceBundle(missingScreenshotRoot, { omitFirstScreenshotFile: true });

      const missingEvents = runTraceValidator(missingEventsRoot);
      const missingScreenshot = runTraceValidator(missingScreenshotRoot);

      expect(missingEvents.status).not.toBe(0);
      expect(`${missingEvents.stdout}\n${missingEvents.stderr}`).toContain('events.jsonl');
      expect(missingScreenshot.status).not.toBe(0);
      expect(`${missingScreenshot.stdout}\n${missingScreenshot.stderr}`).toContain('screenshot file missing');
    } finally {
      rmSync(missingEventsRoot, { recursive: true, force: true });
      rmSync(missingScreenshotRoot, { recursive: true, force: true });
    }
  });
});
