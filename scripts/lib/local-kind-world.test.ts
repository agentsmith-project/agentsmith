import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function runBash(script: string): string {
  return execFileSync('bash', ['-lc', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
  }).trim();
}

describe('local-kind-world helper', () => {
  it('destroys only scenario-owned local kind assets', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'local-kind-world-'));
    const helper = path.join(process.cwd(), 'scripts/lib/local-kind-world.sh');
    const binDir = path.join(tempRoot, 'bin');
    const kindLog = path.join(tempRoot, 'kind.log');
    const dockerLog = path.join(tempRoot, 'docker.log');
    const stateRoot = path.join(tempRoot, 'state', 'local-kind');
    const extraPath = path.join(tempRoot, 'config', 'kind-agentsmith-demo.kubeconfig');
    const untouchedPath = path.join(tempRoot, 'reports', 'keep.txt');

    mkdirSync(binDir, { recursive: true });
    mkdirSync(stateRoot, { recursive: true });
    mkdirSync(path.dirname(extraPath), { recursive: true });
    mkdirSync(path.dirname(untouchedPath), { recursive: true });
    writeFileSync(path.join(stateRoot, 'state.txt'), 'owned');
    writeFileSync(extraPath, 'kubeconfig');
    writeFileSync(untouchedPath, 'keep');

    writeFileSync(
      path.join(binDir, 'kind'),
      `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "${kindLog}"
if [[ "$1" == "get" && "$2" == "clusters" ]]; then
  printf 'agentsmith-demo\\n'
  exit 0
fi
if [[ "$1" == "delete" && "$2" == "cluster" ]]; then
  exit 0
fi
exit 0
`,
      { mode: 0o755 },
    );

    writeFileSync(
      path.join(binDir, 'docker'),
      `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "${dockerLog}"
if [[ "$1" == "ps" && "$2" == "-a" ]]; then
  printf 'agentsmith-demo-registry\\n'
  exit 0
fi
if [[ "$1" == "rm" && "$2" == "-f" ]]; then
  exit 0
fi
exit 0
`,
      { mode: 0o755 },
    );

    runBash(`
      export PATH="${binDir}:$PATH"
      source "${helper}"
      local_kind_world_destroy \
        "agentsmith-demo" \
        "agentsmith-demo-registry" \
        "${stateRoot}" \
        "${extraPath}"
    `);

    const kindCalls = readFileSync(kindLog, 'utf8');
    const dockerCalls = readFileSync(dockerLog, 'utf8');

    expect(kindCalls).toContain('get clusters');
    expect(kindCalls).toContain('delete cluster --name agentsmith-demo');
    expect(dockerCalls).toContain("ps -a --format {{.Names}}");
    expect(dockerCalls).toContain('rm -f agentsmith-demo-registry');
    expect(() => readFileSync(path.join(stateRoot, 'state.txt'), 'utf8')).toThrow();
    expect(() => readFileSync(extraPath, 'utf8')).toThrow();
    expect(readFileSync(untouchedPath, 'utf8')).toBe('keep');
  });
});
