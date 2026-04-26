import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { CURRENT_GATE_RESULT_SCHEMA_VERSION } from '../current-gate-result-schema';
import {
  readReleaseStatus,
  renderReleaseStatus,
  writeReleaseSummaryForCampaign,
} from '../release-summary';

function readPackageScripts(): Record<string, string> {
  return (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts;
}

const RELEASE_HUMAN_DOC_FORBIDDEN_COPYABLE_PATTERNS = [
  /\bnpm run gate:[a-z0-9:_-]+/,
  /\bnpm run lane:[a-z0-9:_-]+/,
  /\bnpm run backend-real:[a-z0-9:_-]+/,
  /\bnpm run release:campaign:full\b/,
  /\bRELEASE_CAMPAIGN_ROOT=<campaign-root>\s+npm run gate:release:full\b/,
] as const;

function writeJson(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function writeTerminalResult(campaignRoot: string, overrides: Partial<{
  status: string;
  failure_class: string;
  stage: string;
  summary: string;
}> = {}): void {
  writeJson(join(campaignRoot, 'gate-release-full', 'result.json'), {
    schema_version: CURRENT_GATE_RESULT_SCHEMA_VERSION,
    gate_id: 'gate-release-full',
    gate_adapter: {
      npm_script: 'gate:release:full',
      ci_job: null,
    },
    status: overrides.status ?? 'passed',
    failure_class: overrides.failure_class ?? 'none',
    stage: overrides.stage ?? 'aggregate',
    line_kind: 'release_full_verdict',
    evidence_dir: join(campaignRoot, 'gate-release-full'),
    summary: overrides.summary ?? 'Release-full campaign evidence passed aggregate verification.',
    generated_at: '2026-04-25T12:00:00.000Z',
  });
}

function writeSummaryCache(campaignRoot: string, overrides: Partial<Record<string, unknown>> = {}): void {
  writeJson(join(campaignRoot, 'summary.json'), {
    schema: 'agentsmith_release_summary/v1',
    campaign_id: 'release-full',
    campaign_run_id: overrides.campaign_run_id ?? 'summary-cache-test',
    campaign_root: overrides.campaign_root ?? campaignRoot,
    automated_release_verdict: overrides.automated_release_verdict ?? 'PASSED',
    status: overrides.status ?? 'passed',
    failure_class: overrides.failure_class ?? 'none',
    stage: overrides.stage ?? 'aggregate',
    blocked_step: overrides.blocked_step ?? null,
    why: overrides.why ?? 'Release-full campaign evidence passed aggregate verification.',
    next_action: overrides.next_action ?? 'Attach summary.md to the release note and complete the operator sign-off checklist.',
    terminal_result_path: overrides.terminal_result_path ?? join(campaignRoot, 'gate-release-full', 'result.json'),
    summary_json_path: overrides.summary_json_path ?? join(campaignRoot, 'summary.json'),
    summary_md_path: overrides.summary_md_path ?? join(campaignRoot, 'summary.md'),
    evidence_package: overrides.evidence_package ?? campaignRoot,
    manual_operator_signoff: overrides.manual_operator_signoff ?? 'not_covered',
    generated_at: overrides.generated_at ?? '2026-04-25T12:00:00.000Z',
  });
}

function writeLatestPointer(latestPath: string, campaignRoot: string): void {
  writeJson(latestPath, {
    schema: 'agentsmith_release_latest/v1',
    campaign_id: 'release-full',
    campaign_run_id: 'latest-pointer-test',
    campaign_root: campaignRoot,
    summary_json: join(campaignRoot, 'summary.json'),
    summary_md: join(campaignRoot, 'summary.md'),
    terminal_result_path: join(campaignRoot, 'gate-release-full', 'result.json'),
    updated_at: '2026-04-25T12:00:00.000Z',
  });
}

function writeFakeNpm(dir: string, script: string): void {
  const path = join(dir, 'npm');
  writeFileSync(path, script);
  chmodSync(path, 0o755);
}

describe('release readiness human entrypoints', () => {
  it('exposes friendly release and rehearsal aliases while keeping old commands available', () => {
    const scripts = readPackageScripts();

    expect(scripts['release:ready']).toContain('scripts/governance/release-ready.ts');
    expect(scripts['release:status']).toContain('scripts/governance/release-status.ts');
    expect(scripts['release:aggregate']).toContain('scripts/governance/run-release-aggregate.ts');
    expect(scripts['rehearse:demo']).toBe('npm run lane:demo-rehearsal');
    expect(scripts['rehearse:cluster']).toBe('npm run lane:cluster-rehearsal');

    expect(scripts['release:campaign:full']).toBeTruthy();
    expect(scripts['gate:release:full']).toBeTruthy();
    expect(scripts['lane:demo-rehearsal']).toBeTruthy();
    expect(scripts['lane:cluster-rehearsal']).toBeTruthy();
  });

  it('keeps the release readiness checklist centered on clean human entrypoints', () => {
    const checklist = readFileSync('docs/user-guides/release-readiness-checklist.md', 'utf8');

    expect(checklist).toContain('npm run release:ready');
    expect(checklist).toContain('npm run release:status');
    expect(checklist).toContain('npm run rehearse:demo');
    expect(checklist).toContain('npm run rehearse:cluster');
    expect(checklist).toContain('internal adapter');

    for (const pattern of RELEASE_HUMAN_DOC_FORBIDDEN_COPYABLE_PATTERNS) {
      expect(checklist, `release checklist must not expose internal adapter as copyable human path: ${pattern}`).not.toMatch(pattern);
    }
  });

  it('writes release summary from the campaign-scoped terminal result without rereading upstream evidence', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-summary-terminal-only-'));
    const latestPath = join(root, 'latest.json');
    try {
      writeTerminalResult(root, {
        status: 'failed',
        failure_class: 'evidence_missing',
        summary: 'Campaign step lane-visual did not pass.',
      });

      const summary = writeReleaseSummaryForCampaign({
        campaignRoot: root,
        latestPath,
      });

      expect(summary.automated_release_verdict).toBe('FAILED');
      expect(summary.failure_class).toBe('evidence_missing');
      expect(summary.blocked_step).toBe('lane-visual');
      expect(summary.terminal_result_path).toBe(join(root, 'gate-release-full', 'result.json'));
      expect(existsSync(join(root, 'summary.json'))).toBe(true);
      expect(existsSync(join(root, 'summary.md'))).toBe(true);
      expect(JSON.parse(readFileSync(latestPath, 'utf8'))).toMatchObject({
        campaign_root: root,
        summary_json: join(root, 'summary.json'),
        summary_md: join(root, 'summary.md'),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('renders release status from latest summary only and gives a next action when latest is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-status-'));
    const latestPath = join(root, 'missing-latest.json');
    try {
      const missing = readReleaseStatus({ latestPath });
      expect(missing.kind).toBe('missing_latest');

      const output = renderReleaseStatus(missing);
      expect(output).toContain('Automated release verdict: MISSING');
      expect(output).toContain('Next: run npm run release:ready');
      expect(output).not.toContain('gate:release:full');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when latest summary exists but the campaign terminal result is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-status-missing-terminal-'));
    const latestPath = join(root, 'latest.json');
    try {
      writeSummaryCache(root);
      writeLatestPointer(latestPath, root);

      const status = readReleaseStatus({ latestPath });
      expect(status.kind).not.toBe('ready');

      const output = renderReleaseStatus(status);
      expect(output).toContain('Automated release verdict: UNKNOWN');
      expect(output).toContain('terminal result');
      expect(output).not.toContain('Automated release verdict: PASSED');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when summary cache disagrees with the campaign-scoped terminal result', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-status-mismatch-'));
    const latestPath = join(root, 'latest.json');
    try {
      writeTerminalResult(root, {
        status: 'passed',
        failure_class: 'none',
        summary: 'Release-full campaign evidence passed aggregate verification.',
      });
      writeSummaryCache(root, {
        automated_release_verdict: 'FAILED',
        status: 'failed',
        failure_class: 'evidence_missing',
        why: 'stale summary cache says failed',
      });
      writeLatestPointer(latestPath, root);

      const status = readReleaseStatus({ latestPath });
      expect(status.kind).not.toBe('ready');

      const output = renderReleaseStatus(status);
      expect(output).toContain('summary cache');
      expect(output).toContain('terminal result');
      expect(output).not.toContain('Automated release verdict: FAILED');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when summary cache is missing required presentation fields', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-status-summary-shape-'));
    const latestPath = join(root, 'latest.json');
    try {
      writeTerminalResult(root);
      writeJson(join(root, 'summary.json'), {
        schema: 'agentsmith_release_summary/v1',
        campaign_id: 'release-full',
      });
      writeLatestPointer(latestPath, root);

      const status = readReleaseStatus({ latestPath });
      expect(status.kind).not.toBe('ready');

      const output = renderReleaseStatus(status);
      expect(output).toContain('summary cache');
      expect(output).toContain('required');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('stops before the campaign when release precheck fails and does not write a release verdict', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-precheck-'));
    const fakeBin = mkdtempSync(join(tmpdir(), 'agentsmith-fake-npm-'));
    const logPath = join(root, 'npm.log');
    try {
      writeFakeNpm(fakeBin, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${logPath}"
if [[ "$1" == "run" && "$2" == "test:release:precheck" ]]; then
  exit 9
fi
if [[ "$1" == "run" && "$2" == "release:campaign:full" ]]; then
  exit 0
fi
exit 0
`);

      const result = spawnSync('npx', ['tsx', 'scripts/governance/release-ready.ts'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          RELEASE_CAMPAIGN_ROOT: root,
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(9);
      expect(`${result.stdout}\n${result.stderr}`).toContain('Automated release verdict: NOT STARTED');
      expect(`${result.stdout}\n${result.stderr}`).toContain('no release verdict');
      expect(readFileSync(logPath, 'utf8')).toBe('run test:release:precheck\n');
      expect(existsSync(join(root, 'gate-release-full', 'result.json'))).toBe(false);
      expect(existsSync(join(root, 'summary.json'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it('runs the existing campaign after precheck passes and follows the campaign exit code', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-campaign-'));
    const fakeBin = mkdtempSync(join(tmpdir(), 'agentsmith-fake-npm-'));
    const logPath = join(root, 'npm.log');
    try {
      writeFakeNpm(fakeBin, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${logPath}"
if [[ "$1" == "run" && "$2" == "test:release:precheck" ]]; then
  exit 0
fi
if [[ "$1" == "run" && "$2" == "release:campaign:full" ]]; then
  exit 7
fi
exit 0
`);

      const result = spawnSync('npx', ['tsx', 'scripts/governance/release-ready.ts'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          RELEASE_CAMPAIGN_ROOT: root,
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(7);
      expect(readFileSync(logPath, 'utf8')).toBe([
        'run test:release:precheck',
        'run release:campaign:full',
        '',
      ].join('\n'));
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it('treats the release campaign as the only summary writer', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-summary-owner-'));
    const fakeBin = mkdtempSync(join(tmpdir(), 'agentsmith-fake-npm-'));
    try {
      writeFakeNpm(fakeBin, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "run" && "$2" == "test:release:precheck" ]]; then
  exit 0
fi
if [[ "$1" == "run" && "$2" == "release:campaign:full" ]]; then
  mkdir -p "\${RELEASE_CAMPAIGN_ROOT}/gate-release-full"
  campaign_run_id="$(basename "\${RELEASE_CAMPAIGN_ROOT}")"
  cat > "\${RELEASE_CAMPAIGN_ROOT}/gate-release-full/result.json" <<JSON
{
  "schema_version": "${CURRENT_GATE_RESULT_SCHEMA_VERSION}",
  "gate_id": "gate-release-full",
  "gate_adapter": { "npm_script": "gate:release:full", "ci_job": null },
  "status": "passed",
  "failure_class": "none",
  "stage": "aggregate",
  "line_kind": "release_full_verdict",
  "evidence_dir": "\${RELEASE_CAMPAIGN_ROOT}/gate-release-full",
  "summary": "Campaign-owned summary passed.",
  "generated_at": "2026-04-25T12:00:00.000Z"
}
JSON
  cat > "\${RELEASE_CAMPAIGN_ROOT}/summary.json" <<JSON
{
  "schema": "agentsmith_release_summary/v1",
  "campaign_id": "release-full",
  "campaign_run_id": "\${campaign_run_id}",
  "campaign_root": "\${RELEASE_CAMPAIGN_ROOT}",
  "automated_release_verdict": "PASSED",
  "status": "passed",
  "failure_class": "none",
  "stage": "aggregate",
  "blocked_step": null,
  "why": "Campaign-owned summary passed.",
  "next_action": "Attach summary.md to the release note and complete the operator sign-off checklist.",
  "terminal_result_path": "\${RELEASE_CAMPAIGN_ROOT}/gate-release-full/result.json",
  "summary_json_path": "\${RELEASE_CAMPAIGN_ROOT}/summary.json",
  "summary_md_path": "\${RELEASE_CAMPAIGN_ROOT}/summary.md",
  "evidence_package": "\${RELEASE_CAMPAIGN_ROOT}",
  "manual_operator_signoff": "not_covered",
  "generated_at": "campaign-owned-summary"
}
JSON
  printf '# Campaign-owned summary\\n' > "\${RELEASE_CAMPAIGN_ROOT}/summary.md"
  exit 0
fi
exit 0
`);

      const result = spawnSync('npx', ['tsx', 'scripts/governance/release-ready.ts'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          RELEASE_CAMPAIGN_ROOT: root,
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Campaign-owned summary passed.');
      const summary = JSON.parse(readFileSync(join(root, 'summary.json'), 'utf8')) as { generated_at: string };
      expect(summary.generated_at).toBe('campaign-owned-summary');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it('creates and reads the current campaign root instead of falling back to an older latest pointer', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-current-root-'));
    const fakeBin = mkdtempSync(join(tmpdir(), 'agentsmith-fake-npm-'));
    const oldCampaignRoot = join(root, 'old-campaign');
    const logPath = join(root, 'npm.log');
    const repoLatestPath = resolve('artifacts', 'release-runs', 'latest.json');
    const previousLatest = existsSync(repoLatestPath) ? readFileSync(repoLatestPath, 'utf8') : null;
    try {
      writeTerminalResult(oldCampaignRoot, {
        status: 'failed',
        failure_class: 'product_regression',
        summary: 'Old campaign failed and must not be displayed.',
      });
      writeSummaryCache(oldCampaignRoot, {
        automated_release_verdict: 'FAILED',
        status: 'failed',
        failure_class: 'product_regression',
        why: 'Old campaign failed and must not be displayed.',
        terminal_result_path: join(oldCampaignRoot, 'gate-release-full', 'result.json'),
      });
      writeLatestPointer(repoLatestPath, oldCampaignRoot);

      writeFakeNpm(fakeBin, `#!/usr/bin/env bash
set -euo pipefail
printf '%s|root=%s|run=%s\\n' "$*" "\${RELEASE_CAMPAIGN_ROOT:-}" "\${RELEASE_CAMPAIGN_RUN_ID:-}" >> "${logPath}"
if [[ "$1" == "run" && "$2" == "test:release:precheck" ]]; then
  exit 0
fi
if [[ "$1" == "run" && "$2" == "release:campaign:full" ]]; then
  mkdir -p "\${RELEASE_CAMPAIGN_ROOT}/gate-release-full"
  campaign_run_id="$(basename "\${RELEASE_CAMPAIGN_ROOT}")"
  cat > "\${RELEASE_CAMPAIGN_ROOT}/gate-release-full/result.json" <<JSON
{
  "schema_version": "${CURRENT_GATE_RESULT_SCHEMA_VERSION}",
  "gate_id": "gate-release-full",
  "gate_adapter": { "npm_script": "gate:release:full", "ci_job": null },
  "status": "passed",
  "failure_class": "none",
  "stage": "aggregate",
  "line_kind": "release_full_verdict",
  "evidence_dir": "\${RELEASE_CAMPAIGN_ROOT}/gate-release-full",
  "summary": "Current campaign passed.",
  "generated_at": "2026-04-25T12:00:00.000Z"
}
JSON
  cat > "\${RELEASE_CAMPAIGN_ROOT}/summary.json" <<JSON
{
  "schema": "agentsmith_release_summary/v1",
  "campaign_id": "release-full",
  "campaign_run_id": "\${campaign_run_id}",
  "campaign_root": "\${RELEASE_CAMPAIGN_ROOT}",
  "automated_release_verdict": "PASSED",
  "status": "passed",
  "failure_class": "none",
  "stage": "aggregate",
  "blocked_step": null,
  "why": "Current campaign passed.",
  "next_action": "Attach summary.md to the release note and complete the operator sign-off checklist.",
  "terminal_result_path": "\${RELEASE_CAMPAIGN_ROOT}/gate-release-full/result.json",
  "summary_json_path": "\${RELEASE_CAMPAIGN_ROOT}/summary.json",
  "summary_md_path": "\${RELEASE_CAMPAIGN_ROOT}/summary.md",
  "evidence_package": "\${RELEASE_CAMPAIGN_ROOT}",
  "manual_operator_signoff": "not_covered",
  "generated_at": "campaign-owned-summary"
}
JSON
  printf '# Current campaign summary\\n' > "\${RELEASE_CAMPAIGN_ROOT}/summary.md"
  exit 0
fi
exit 0
`);

      const result = spawnSync('npx', ['tsx', 'scripts/governance/release-ready.ts'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          RELEASE_RUNS_ROOT: root,
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Automated release verdict: PASSED');
      expect(result.stdout).toContain('Current campaign passed.');
      expect(result.stdout).not.toContain('Old campaign failed');
      expect(readFileSync(logPath, 'utf8')).toMatch(/run release:campaign:full\|root=.*agentsmith-release-ready-current-root-/);
      expect(readFileSync(logPath, 'utf8')).toMatch(/run release:campaign:full\|root=.*\|run=release-ready-/);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
      if (previousLatest === null) {
        rmSync(repoLatestPath, { force: true });
      } else {
        writeFileSync(repoLatestPath, previousLatest);
      }
    }
  });

  it('does not update the repo latest pointer when RELEASE_CAMPAIGN_ROOT is explicit', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-explicit-root-'));
    const fakeBin = mkdtempSync(join(tmpdir(), 'agentsmith-fake-npm-'));
    const repoLatestPath = resolve('artifacts', 'release-runs', 'latest.json');
    const previousLatest = existsSync(repoLatestPath) ? readFileSync(repoLatestPath, 'utf8') : null;
    try {
      writeJson(repoLatestPath, {
        schema: 'agentsmith_release_latest/v1',
        campaign_id: 'release-full',
        campaign_run_id: 'previous-latest',
        campaign_root: '/tmp/previous-latest-root',
        updated_at: '2026-04-25T12:00:00.000Z',
      });

      writeFakeNpm(fakeBin, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "run" && "$2" == "test:release:precheck" ]]; then
  exit 0
fi
if [[ "$1" == "run" && "$2" == "release:campaign:full" ]]; then
  mkdir -p "\${RELEASE_CAMPAIGN_ROOT}/gate-release-full"
  campaign_run_id="$(basename "\${RELEASE_CAMPAIGN_ROOT}")"
  cat > "\${RELEASE_CAMPAIGN_ROOT}/gate-release-full/result.json" <<JSON
{
  "schema_version": "${CURRENT_GATE_RESULT_SCHEMA_VERSION}",
  "gate_id": "gate-release-full",
  "gate_adapter": { "npm_script": "gate:release:full", "ci_job": null },
  "status": "passed",
  "failure_class": "none",
  "stage": "aggregate",
  "line_kind": "release_full_verdict",
  "evidence_dir": "\${RELEASE_CAMPAIGN_ROOT}/gate-release-full",
  "summary": "Explicit campaign root passed.",
  "generated_at": "2026-04-25T12:00:00.000Z"
}
JSON
  cat > "\${RELEASE_CAMPAIGN_ROOT}/summary.json" <<JSON
{
  "schema": "agentsmith_release_summary/v1",
  "campaign_id": "release-full",
  "campaign_run_id": "\${campaign_run_id}",
  "campaign_root": "\${RELEASE_CAMPAIGN_ROOT}",
  "automated_release_verdict": "PASSED",
  "status": "passed",
  "failure_class": "none",
  "stage": "aggregate",
  "blocked_step": null,
  "why": "Explicit campaign root passed.",
  "next_action": "Attach summary.md to the release note and complete the operator sign-off checklist.",
  "terminal_result_path": "\${RELEASE_CAMPAIGN_ROOT}/gate-release-full/result.json",
  "summary_json_path": "\${RELEASE_CAMPAIGN_ROOT}/summary.json",
  "summary_md_path": "\${RELEASE_CAMPAIGN_ROOT}/summary.md",
  "evidence_package": "\${RELEASE_CAMPAIGN_ROOT}",
  "manual_operator_signoff": "not_covered",
  "generated_at": "campaign-owned-summary"
}
JSON
  printf '# Explicit campaign root summary\\n' > "\${RELEASE_CAMPAIGN_ROOT}/summary.md"
  exit 0
fi
exit 0
`);

      const result = spawnSync('npx', ['tsx', 'scripts/governance/release-ready.ts'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          RELEASE_CAMPAIGN_ROOT: root,
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(JSON.parse(readFileSync(repoLatestPath, 'utf8'))).toMatchObject({
        campaign_run_id: 'previous-latest',
        campaign_root: '/tmp/previous-latest-root',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
      if (previousLatest === null) {
        rmSync(repoLatestPath, { force: true });
      } else {
        writeFileSync(repoLatestPath, previousLatest);
      }
    }
  });
});
