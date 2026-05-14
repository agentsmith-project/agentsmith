import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  READINESS_STATE_ENV,
  buildReadinessStatePath,
  createRunReadinessState,
  ensureRunReadinessState,
  updateRunReadinessStateField,
  validateRunReadinessStateForConsumer,
} from '../run-readiness-state';

function withTempRoot<T>(action: (root: string) => T): T {
  const root = join(tmpdir(), `agentsmith-readiness-state-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  try {
    return action(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('run-local readiness state', () => {
  it('writes readiness state under the run report root with redacted allowlisted env digests', () => {
    withTempRoot((root) => {
      const { statePath, state, env } = createRunReadinessState({
        scope: 'verify',
        root,
        gitSha: 'git-sha-123',
        input: {
          entrypoint: 'verify',
          goal: 'debug',
        },
        env: {
          NEXT_PUBLIC_API_BASE: ' https://api.example.test/v1 ',
          NEXT_PUBLIC_USE_MSW: 'true',
          RUNNER_TICKET: 'runner-ticket-raw-secret',
          PRESET_ENDPOINT_API_KEY: 'sk-raw-secret',
          GOOGLE_APPLICATION_CREDENTIALS: '/tmp/raw-credential-path.json',
        },
        invocationId: 'verify-invocation-1',
        processNonce: 'verify-process-nonce-1',
        now: new Date('2026-05-14T10:00:00.000Z'),
      });

      const raw = readFileSync(statePath, 'utf8');

      expect(statePath).toBe(join(root, 'state', 'readiness.json'));
      expect(existsSync(statePath)).toBe(true);
      expect(state.kind).toBe('operational_state');
      expect(state.release_authority).toBe('not_release_authority');
      expect(state.env_digest.entries.map((entry) => entry.name)).toEqual([
        'NEXT_PUBLIC_API_BASE',
        'NEXT_PUBLIC_USE_MSW',
      ]);
      expect(raw).toContain('NEXT_PUBLIC_API_BASE');
      expect(raw).toContain('sha256:');
      expect(raw).not.toContain('https://api.example.test');
      expect(raw).not.toContain('runner-ticket-raw-secret');
      expect(raw).not.toContain('sk-raw-secret');
      expect(raw).not.toContain('/tmp/raw-credential-path.json');
      expect(env[READINESS_STATE_ENV.path]).toBe(statePath);
      expect(env[READINESS_STATE_ENV.invocationId]).toBe('verify-invocation-1');
      expect(env[READINESS_STATE_ENV.processNonce]).toBe('verify-process-nonce-1');
    });
  });

  it('validates same-process consumers and fails closed on nonce or digest mismatch', () => {
    withTempRoot((root) => {
      const { statePath, state } = createRunReadinessState({
        scope: 'release',
        root,
        gitSha: 'git-sha-456',
        input: {
          campaign_root: root,
          run_id: 'release-run-1',
        },
        env: {
          NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1',
        },
        invocationId: 'release-invocation-1',
        processNonce: 'release-process-nonce-1',
        now: new Date('2026-05-14T11:00:00.000Z'),
      });

      expect(validateRunReadinessStateForConsumer({
        statePath,
        invocationId: state.invocation_id,
        processNonce: state.process_nonce,
        inputDigest: state.input_digest,
        envDigest: state.env_digest.digest,
        gitSha: state.git_sha,
      })).toMatchObject({ ok: true });

      expect(validateRunReadinessStateForConsumer({
        statePath,
        invocationId: state.invocation_id,
        processNonce: 'new-command-process-nonce',
        inputDigest: state.input_digest,
        envDigest: state.env_digest.digest,
        gitSha: state.git_sha,
      })).toMatchObject({
        ok: false,
        error: expect.stringContaining('process_nonce'),
      });

      expect(validateRunReadinessStateForConsumer({
        statePath,
        invocationId: state.invocation_id,
        processNonce: state.process_nonce,
        inputDigest: 'sha256:other-input-digest',
        envDigest: state.env_digest.digest,
        gitSha: state.git_sha,
      })).toMatchObject({
        ok: false,
        error: expect.stringContaining('input_digest'),
      });

      expect(validateRunReadinessStateForConsumer({
        statePath,
        invocationId: state.invocation_id,
        processNonce: state.process_nonce,
        inputDigest: state.input_digest,
        envDigest: 'sha256:other-env-digest',
        gitSha: state.git_sha,
      })).toMatchObject({
        ok: false,
        error: expect.stringContaining('env_digest'),
      });
    });
  });

  it('fails closed when required readiness state fields are missing', () => {
    withTempRoot((root) => {
      const statePath = buildReadinessStatePath(root);
      mkdirSync(dirname(statePath), { recursive: true });
      writeFileSync(statePath, `${JSON.stringify({
        schema: 'agentsmith_run_readiness_state/v1',
        kind: 'operational_state',
      }, null, 2)}\n`);

      expect(validateRunReadinessStateForConsumer({
        statePath,
        invocationId: 'missing-fields-invocation',
        processNonce: 'missing-fields-nonce',
      })).toMatchObject({
        ok: false,
        error: expect.stringContaining('required'),
      });
    });
  });

  it('refuses to trust an old command readiness env with a new process nonce', () => {
    withTempRoot((root) => {
      const input = {
        campaign_root: root,
        run_id: 'release-run-old-command',
      };
      const baseEnv = {
        NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1',
      };
      const oldCommand = createRunReadinessState({
        scope: 'release',
        root,
        gitSha: 'git-sha-old-command',
        input,
        env: baseEnv,
        invocationId: 'old-command-invocation',
        processNonce: 'old-command-process-nonce',
      });

      expect(() => ensureRunReadinessState({
        scope: 'release',
        root,
        gitSha: 'git-sha-old-command',
        input,
        env: {
          ...baseEnv,
          ...oldCommand.env,
          [READINESS_STATE_ENV.processNonce]: 'new-command-process-nonce',
        },
      })).toThrow(/process_nonce/);
    });
  });

  it('lets the parent writer mark integration deps ready and exposes a read-only CLI check', () => {
    withTempRoot((root) => {
      const context = createRunReadinessState({
        scope: 'release',
        root,
        gitSha: 'git-sha-update',
        input: {
          campaign_root: root,
          run_id: 'release-run-update',
        },
        env: {
          NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1',
        },
        invocationId: 'update-invocation',
        processNonce: 'update-process-nonce',
      });

      expect(spawnSync('npx', ['tsx', 'scripts/governance/run-readiness-state.ts', 'check', '--field', 'integration_deps_ready'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...context.env,
        },
        encoding: 'utf8',
      }).status).toBe(1);

      const updated = updateRunReadinessStateField({
        statePath: context.statePath,
        invocationId: context.state.invocation_id,
        processNonce: context.state.process_nonce,
        inputDigest: context.state.input_digest,
        envDigest: context.state.env_digest.digest,
        gitSha: context.state.git_sha,
        field: 'integration_deps_ready',
        status: 'ready',
      });

      expect(updated.readiness.integration_deps_ready).toBe('ready');
      expect(spawnSync('npx', ['tsx', 'scripts/governance/run-readiness-state.ts', 'check', '--field', 'integration_deps_ready'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...context.env,
        },
        encoding: 'utf8',
      }).status).toBe(0);
      expect(spawnSync('npx', ['tsx', 'scripts/governance/run-readiness-state.ts', 'check', '--field', 'integration_deps_ready'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...context.env,
          [READINESS_STATE_ENV.processNonce]: 'stale-process-nonce',
        },
        encoding: 'utf8',
      }).status).toBe(1);
      expect(spawnSync('npx', ['tsx', 'scripts/governance/run-readiness-state.ts', 'check', '--field', 'unknown_field'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...context.env,
        },
        encoding: 'utf8',
      }).status).toBe(1);
    });
  });

  it('requires matching resource identity before reusing a ready field', () => {
    withTempRoot((root) => {
      const context = createRunReadinessState({
        scope: 'release',
        root,
        gitSha: 'git-sha-identity',
        input: {
          campaign_root: root,
          run_id: 'release-run-identity',
        },
        env: {
          NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1',
        },
        invocationId: 'identity-invocation',
        processNonce: 'identity-process-nonce',
      });

      updateRunReadinessStateField({
        statePath: context.statePath,
        invocationId: context.state.invocation_id,
        processNonce: context.state.process_nonce,
        inputDigest: context.state.input_digest,
        envDigest: context.state.env_digest.digest,
        gitSha: context.state.git_sha,
        field: 'runner_image_digest_prepared',
        status: 'ready',
        identity: {
          runner_image_ref: 'agentsmith-agent-task-runner:local',
          runner_image_id: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      });

      expect(spawnSync('npx', [
        'tsx',
        'scripts/governance/run-readiness-state.ts',
        'check',
        '--field',
        'runner_image_digest_prepared',
        '--identity',
        'runner_image_ref=agentsmith-agent-task-runner:local',
        '--identity',
        'runner_image_id=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...context.env,
        },
        encoding: 'utf8',
      }).status).toBe(0);

      expect(spawnSync('npx', [
        'tsx',
        'scripts/governance/run-readiness-state.ts',
        'check',
        '--field',
        'runner_image_digest_prepared',
        '--identity',
        'runner_image_ref=agentsmith-agent-task-runner:local',
        '--identity',
        'runner_image_id=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...context.env,
        },
        encoding: 'utf8',
      }).status).toBe(1);

      const raw = readFileSync(context.statePath, 'utf8');
      expect(raw).toContain('runner_image_digest_prepared');
      expect(raw).toContain('runner_image_id');
      expect(raw).not.toContain('PRESET_ENDPOINT_API_KEY');
    });
  });

  it('keeps shell readiness consumers read-only behind a shared helper before skipping deps startup', () => {
    const helper = readFileSync('scripts/lib/run-readiness-state.sh', 'utf8');
    const backendBootstrap = readFileSync('scripts/backend-real-bootstrap.sh', 'utf8');
    const releaseUserStory = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');

    expect(helper).toContain('readiness_state_field_ready');
    expect(helper).toContain('readiness_state_field_ready_with_identity');
    expect(helper).toContain('run-readiness-state.ts');
    expect(helper).toContain('check');

    for (const [path, content] of [
      ['scripts/backend-real-bootstrap.sh', backendBootstrap],
      ['scripts/run-integration-release-user-story.sh', releaseUserStory],
    ] as const) {
      expect(content, `${path} must source the shared read-only readiness helper`)
        .toContain('scripts/lib/run-readiness-state.sh');
      expect(content, `${path} must check integration_deps_ready before dependency startup`)
        .toContain('readiness_state_field_ready integration_deps_ready');
      expect(content, `${path} must not write readiness state from shell children`)
        .not.toContain('update --field');
    }
  });
});
