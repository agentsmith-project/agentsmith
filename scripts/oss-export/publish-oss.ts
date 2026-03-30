import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { OSS_GITHUB_REPO, OSS_TARGET_DIR } from './export-manifest.js';

function run(cmd: string, args: string[], cwd = OSS_TARGET_DIR, capture = false): string {
  const result = execFileSync(cmd, args, { cwd, stdio: capture ? 'pipe' : 'inherit', encoding: capture ? 'utf8' : undefined });
  return typeof result === 'string' ? result.trim() : '';
}

if (!existsSync(OSS_TARGET_DIR)) throw new Error(`oss_target_missing:${OSS_TARGET_DIR}`);
if (!existsSync(join(OSS_TARGET_DIR, '.git'))) {
  run('git', ['init', '-b', 'main']);
}

const hasOrigin = (() => {
  try {
    run('git', ['remote', 'get-url', 'origin'], OSS_TARGET_DIR, true);
    return true;
  } catch {
    return false;
  }
})();

if (!hasOrigin) {
  try {
    execFileSync('gh', ['repo', 'view', OSS_GITHUB_REPO], { stdio: 'ignore' });
  } catch {
    run('gh', ['repo', 'create', OSS_GITHUB_REPO, '--public']);
  }
  if (!hasOrigin) {
    run('git', ['remote', 'add', 'origin', `https://github.com/${OSS_GITHUB_REPO}.git`]);
  }
}

run('gh', ['auth', 'setup-git']);
run('git', ['add', '-A']);
const status = run('git', ['status', '--short'], OSS_TARGET_DIR, true);
if (!status) {
  console.log('OSS repo already up to date.');
  process.exit(0);
}
const sourceSha = run('git', ['-C', process.cwd(), 'rev-parse', 'HEAD'], process.cwd(), true);
run('git', ['commit', '-m', `sync oss from agentsmith @ ${sourceSha}`]);
run('git', ['push', '-u', 'origin', 'main']);
