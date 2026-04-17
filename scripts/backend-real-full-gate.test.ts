import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

type ValidatorResult = ReturnType<typeof spawnSync>;

function createFile(path: string, content = 'fixture\n'): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function writeJson(path: string, payload: unknown): void {
  createFile(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function requiredTraceSteps(story: StoryDefinition): readonly StoryStepDefinition[] {
  return story.steps.filter((step) => step.evidence.includes('trace') && !step.optional);
}

function stepRoute(story: StoryDefinition, step: StoryStepDefinition): string {
  return story.scenes.find((scene) => scene.sceneId === step.sceneId)?.route ?? story.entryRoute;
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
  writeJson(join(root, 'ux-trace-index.json'), {
    version: 1,
    generated_at: '2026-04-12T12:00:01.000Z',
    bundles: [{
      lane: manifest.lane,
      suite: manifest.suite,
      story_id: manifest.story_id,
      scenario_id: manifest.scenario_id,
      run_id: manifest.run_id,
      bundle_relpath: bundleRelpath,
      manifest_relpath: `${bundleRelpath}/manifest.json`,
      review_relpath: `${bundleRelpath}/review.md`,
      contract_snapshot_relpath: `${bundleRelpath}/contract-snapshot.json`,
    }],
  });
  if (!options.omitEvents) {
    createFile(join(bundleDir, 'events.jsonl'), `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
  }
  createFile(join(bundleDir, 'review.md'), renderReview(manifest));
  return bundleDir;
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
    expect(script).toContain('"${RESOURCE_RECOVERY_MOUNT_SYNC_JSON}"');
    expect(script).toContain('FILE_LIBRARY_RESOURCE_RECOVERY_PROBE_PATH');
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

  it('continues through later resource-recovery envelopes after an earlier step fails and writes fallback reports when verify crashes', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');

    expect(script).toContain('overall_status=0');
    expect(script).toContain('if ! run_resource_recovery_step "file-library-real-smoke"');
    expect(script).toContain('if ! run_resource_recovery_step "file-library-mount-sync-smoke"');
    expect(script).toContain('fallback-report');
    expect(script).not.toMatch(
      /\nrun_resource_recovery_step "file-library-real-smoke" "\$\{RESOURCE_RECOVERY_SMOKE_JSON\}" "" \\/,
    );
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

  it('runs stale JuiceFS orphan preflight before capturing the file-library boot baseline', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');
    const preflightIndex = script.indexOf('scripts/juicefs-orphan-preflight.ts');
    const trapIndex = script.indexOf("trap 'cleanup $?' EXIT");
    const bootBaselineCaptureIndex = script.indexOf('ensure_boot_resource_recovery_baseline', preflightIndex + 1);

    expect(script).toContain('scripts/juicefs-orphan-preflight.ts');
    expect(script).toContain('--apply --context "file-library-real-gate"');
    expect(script).toContain('ensure_boot_resource_recovery_baseline()');
    expect(preflightIndex).toBeGreaterThanOrEqual(0);
    expect(trapIndex).toBeGreaterThanOrEqual(0);
    expect(bootBaselineCaptureIndex).toBeGreaterThanOrEqual(0);
    expect(trapIndex).toBeLessThan(preflightIndex);
    expect(preflightIndex).toBeLessThan(bootBaselineCaptureIndex);
  });

  it('materializes startup evidence instead of exiting bare when orphan preflight fails before boot baseline', () => {
    const script = readFileSync('scripts/run-file-library-real-gate.sh', 'utf8');
    const preflightBlockStart = script.indexOf(
      'if ! npx tsx "${ROOT_DIR}/scripts/juicefs-orphan-preflight.ts" --apply --context "file-library-real-gate"; then',
    );
    const bootBaselineCaptureIndex = script.indexOf('ensure_boot_resource_recovery_baseline', preflightBlockStart + 1);
    const preflightFailureBlock = script.slice(preflightBlockStart, bootBaselineCaptureIndex);
    const materializeIndex = preflightFailureBlock.indexOf(
      'materialize_pre_ready_failure_evidence "${pre_ready_failure_reason}"',
    );
    const exitIndex = preflightFailureBlock.indexOf('exit 1');

    expect(preflightBlockStart).toBeGreaterThanOrEqual(0);
    expect(bootBaselineCaptureIndex).toBeGreaterThan(preflightBlockStart);
    expect(preflightFailureBlock).toContain(
      'pre_ready_failure_reason="juicefs orphan preflight failed before boot baseline"',
    );
    expect(preflightFailureBlock).toContain(
      'materialize_pre_ready_failure_evidence "${pre_ready_failure_reason}"',
    );
    expect(preflightFailureBlock).toContain(
      'File library gate could not materialize startup resource recovery evidence before exiting.',
    );
    expect(materializeIndex).toBeGreaterThanOrEqual(0);
    expect(exitIndex).toBeGreaterThan(materializeIndex);
    expect(exitIndex).toBeLessThan(bootBaselineCaptureIndex - preflightBlockStart);
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

  it('fails closed for mount truth probes instead of treating missing commands as not mounted', () => {
    const smokeScript = readFileSync('scripts/file-library-mount-sync-smoke.sh', 'utf8');

    expect(smokeScript).toContain('require_cmd findmnt');
    expect(smokeScript).toContain('require_cmd ps');
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
    expect(cleanupBody).toContain('cleanup failed to stop the owned api process tree');
    expect(cleanupBody).toContain('cleanup failed to confirm api port');
    expect(cleanupBody).toContain('write_resource_recovery_summary "${summary_extra_args[@]}"');
    expect(cleanupBody).toContain('if [[ "${summary_status}" -ne 0 || "${cleanup_stop_status}" -ne 0 || "${cleanup_wait_status}" -ne 0 ]]; then');
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
    expect(script).toContain('STARTUP_STEADY_STATE_HELPER_LABEL_ALLOWANCES=(');
    expect(script).toContain('"helper:mc|0"');
    expect(script).toContain('startup_quiesce_snapshot_satisfies_steady_state()');
    expect(script).toContain('"${RESOURCE_RECOVERY_BOOT_BASELINE_JSON}"');
    expect(script).toContain('append_startup_steady_state_args startup_args');
    expect(script).toContain('--steady-state-helper-label');
    expect(script).toContain('--steady-state-api-tcp');
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
    expect(script).toContain('node "${ROOT_DIR}/scripts/notebook-agent-refresh-token.js" > "${STARTUP_WARMUP_TOKEN_FILE}"');
    expect(script).toContain('Authorization: Bearer $(cat "${STARTUP_WARMUP_TOKEN_FILE}")');
    expect(script).toContain('"${API_BASE%/}/api/v1/me/desktop/file-libraries"');
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

  it('assigns release services to a run-scoped owner token before starting local API and Web', () => {
    const script = readFileSync('scripts/backend-real-full-gate.sh', 'utf8');

    expect(script).toMatch(/LOCAL_RUNTIME_RUN_ID="\$\{RUN_ID\}"/);
    expect(script).toMatch(/LOCAL_RUNTIME_LINE_KIND="release_backend_real"/);
    expect(script).toMatch(/LOCAL_RUNTIME_OWNER_TOKEN="\$\{RUN_ID\}:release_backend_real:/);
    expect(script).toMatch(/LOCAL_RUNTIME_PROCESS_STATE_DIR="\$\{RELEASE_RUN_ROOT\}\/processes"/);
  });

  it('passes executable commands to local_runtime_start_owned_service instead of shell-only helper functions', () => {
    const script = readFileSync('scripts/backend-real-full-gate.sh', 'utf8');

    expect(script).not.toMatch(/local_runtime_start_owned_service[\s\S]*?env[\s\S]*?run_clean npm run api:node:dev/);
    expect(script).not.toMatch(/local_runtime_start_owned_service[\s\S]*?env[\s\S]*?run_clean bash scripts\/run-next-dev-safe\.sh/);
    expect(script).toContain('env -u http_proxy -u https_proxy -u all_proxy');
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
      const bundleDir = writeSemanticTraceBundle(root);

      const result = runTraceValidator(root, reportPath);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(bundleDir);
      const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
        valid_count: number;
        valid_bundle_paths: string[];
      };
      expect(report.valid_count).toBe(1);
      expect(report.valid_bundle_paths).toEqual([bundleDir]);
      expect(readFileSync(join(root, 'valid-bundles.txt'), 'utf8')).toBe(`${bundleDir}\n`);
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
