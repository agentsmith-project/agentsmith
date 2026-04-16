import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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
}> = {}): string {
  const story = getReleaseStoryDefinition();
  const binding = buildTraceStoryBinding(story);
  const runId = 'standalone-trace-run';
  const bundleDir = resolveUxTraceBundleDir({
    outputRoot: root,
    lane: 'backend-real',
    suite: 'integration-release-user-story',
    storyId: story.storyId,
    runId,
  });
  const traceSteps = requiredTraceSteps(story);
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
    story_id: story.storyId,
    story_source: binding.storySource,
    story_source_fingerprint: buildStorySourceFingerprint(readFileSync(resolve(sourceFile), 'utf8')),
    story_fingerprint: options.storyFingerprint ?? buildStoryFingerprint(story),
    step_map_fingerprint: buildStoryStepMapFingerprint(story),
    scenario_id: 'integration-release-user-story',
    title: story.title,
    actor: story.actor,
    lane: 'backend-real',
    suite: 'integration-release-user-story',
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
      'scripts/validate-ux-trace-bundles.ts',
      '--root',
      root,
      '--expected-lane',
      'backend-real',
      '--min-count',
      '1',
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
    expect(script).toContain('--report "${RESOURCE_RECOVERY_SMOKE_JSON}"');
    expect(script).toContain('--report "${RESOURCE_RECOVERY_MOUNT_SYNC_JSON}"');
    expect(script).toContain('FILE_LIBRARY_RESOURCE_RECOVERY_PROBE_PATH');
    expect(script).toContain('resource-recovery');
    expect(script).toContain('baseline.json');
    expect(script).toContain('report.json');
    expect(script).toContain('report.md');
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

    expect(script).toContain('scripts/validate-ux-trace-bundles.ts');
    expect(script).toContain('UX_TRACE_VALIDATION_REPORT');
    expect(script).toContain('UX_TRACE_VALID_BUNDLES');
    expect(script).toContain('backend_real_ux_trace_bundle');
    expect(script).not.toContain('find "${ARTIFACT_DIR}/ux-traces" -type f -name review.md');
  });

  it('rejects legacy standalone UX trace evidence that only contains review.md', () => {
    const root = mkdtempSync(join(tmpdir(), 'backend-real-trace-legacy-'));
    try {
      createFile(join(root, 'legacy', 'review.md'), '# Legacy UX trace review\n');

      const result = runTraceValidator(root);

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain('manifest.json');
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
