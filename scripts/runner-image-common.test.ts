import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function writeFile(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

function writeExecutable(filePath: string, content: string): void {
  writeFile(filePath, content);
  chmodSync(filePath, 0o755);
}

function runBuildRunnerImageFixture(args: {
  env?: NodeJS.ProcessEnv;
  dockerScript?: string;
} = {}): {
  status: number;
  stdout: string;
  stderr: string;
  dockerLog: string;
  tempRoot: string;
} {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'agentsmith-runner-image-common-'));
  const binDir = path.join(tempRoot, 'bin');
  const dockerLog = path.join(tempRoot, 'docker.log');
  const dockerScript = args.dockerScript ?? `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${dockerLog}"
if [[ "\${1:-}" == "build" ]]; then
  if [[ "$*" == *"NODE_BASE_IMAGE=node:24.14.1-bookworm"* ]]; then
    printf 'unexpected status from HEAD request to https://docker.m.daocloud.io/v2/library/node/manifests/24.14.1-bookworm?ns=docker.io: 401 Unauthorized\\n' >&2
    exit 1
  fi
  exit 0
fi
exit 0
`;

  mkdirSync(binDir, { recursive: true });
  writeExecutable(path.join(binDir, 'docker'), dockerScript);
  writeFile(path.join(tempRoot, 'infra', 'runner', 'Dockerfile.agent-task-runner-base'), 'ARG NODE_BASE_IMAGE\nFROM ${NODE_BASE_IMAGE}\n');
  writeFile(path.join(tempRoot, 'infra', 'runner', 'Dockerfile.agent-task-runner'), 'ARG RUNNER_BASE_IMAGE\nFROM ${RUNNER_BASE_IMAGE}\n');

  const script = `
set -euo pipefail
ROOT_DIR="${repoRoot}"
source "${repoRoot}/scripts/lib/runner-image-common.sh"
build_runner_image agent-task agentsmith-agent-task-runner-base:local agentsmith-agent-task-runner:local "" 1 1 "${tempRoot}"
`;
  const result = spawnSync('bash', ['-lc', script], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      ...args.env,
    },
    encoding: 'utf8',
    stdio: 'pipe',
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    dockerLog: readFileSync(dockerLog, 'utf8'),
    tempRoot,
  };
}

describe('runner image build base fallback', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      const tempRoot = tempRoots.pop();
      if (tempRoot) {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it('retries an equivalent non-Docker-Hub node base image when the default mirror rejects metadata', () => {
    const result = runBuildRunnerImageFixture();
    tempRoots.push(result.tempRoot);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('base image build failed for agent-task with NODE_BASE_IMAGE=node:24.14.1-bookworm');
    expect(result.stderr).toContain('401 Unauthorized');
    expect(result.stderr).toContain(
      'built agent-task runner base image with fallback NODE_BASE_IMAGE=public.ecr.aws/docker/library/node:24.14.1-bookworm',
    );
    expect(result.dockerLog).toContain('NODE_BASE_IMAGE=node:24.14.1-bookworm');
    expect(result.dockerLog).toContain('NODE_BASE_IMAGE=public.ecr.aws/docker/library/node:24.14.1-bookworm');
    expect(result.dockerLog).toContain('RUNNER_BASE_IMAGE=agentsmith-agent-task-runner-base:local');
  });

  it('fails closed when fallback base images are explicitly disabled', () => {
    const result = runBuildRunnerImageFixture({
      env: {
        RUNNER_NODE_BASE_IMAGE_FALLBACKS: 'none',
      },
    });
    tempRoots.push(result.tempRoot);

    expect(result.status).toBe(1);
    expect(result.dockerLog).toContain('NODE_BASE_IMAGE=node:24.14.1-bookworm');
    expect(result.dockerLog).not.toContain('public.ecr.aws/docker/library/node');
  });
});
