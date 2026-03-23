import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SESSION_FINGERPRINT_FILE = '.mbos-session-fingerprint.json';
const SESSION_STATE_VERSION = 'runner_session_v1';
const PROMPT_POLICY_VERSION = 'latest_user_only_v1';

type SessionFingerprint = {
  session_state_version: string;
  prompt_policy_version: string;
  model: string;
  wire_api: 'chat' | 'responses';
  resource_proxy_base: string;
  notebook_mode: boolean;
};

function buildSessionFingerprint(input: {
  model: string;
  wireApi: 'chat' | 'responses';
  resourceProxyBase: string;
  notebookMode: boolean;
}): SessionFingerprint {
  return {
    session_state_version: SESSION_STATE_VERSION,
    prompt_policy_version: PROMPT_POLICY_VERSION,
    model: input.model,
    wire_api: input.wireApi,
    resource_proxy_base: input.resourceProxyBase,
    notebook_mode: input.notebookMode,
  };
}

function isSameFingerprint(left: SessionFingerprint, right: SessionFingerprint): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function shouldResetEntry(name: string): boolean {
  if (name === 'sessions' || name === 'shell_snapshots' || name === 'tmp') return true;
  return /^state_.*\.sqlite(?:-(?:shm|wal))?$/.test(name);
}

export async function ensureCodexSessionStateCompatible(input: {
  codexDir: string;
  model: string;
  wireApi: 'chat' | 'responses';
  resourceProxyBase: string;
  notebookMode: boolean;
}): Promise<{ resetPerformed: boolean; reason: 'missing' | 'unchanged' | 'changed' }> {
  await mkdir(input.codexDir, { recursive: true });
  const fingerprintPath = join(input.codexDir, SESSION_FINGERPRINT_FILE);
  const nextFingerprint = buildSessionFingerprint({
    model: input.model,
    wireApi: input.wireApi,
    resourceProxyBase: input.resourceProxyBase,
    notebookMode: input.notebookMode,
  });

  let previousFingerprint: SessionFingerprint | null = null;
  try {
    previousFingerprint = JSON.parse(await readFile(fingerprintPath, 'utf8')) as SessionFingerprint;
  } catch {
    previousFingerprint = null;
  }

  if (previousFingerprint && isSameFingerprint(previousFingerprint, nextFingerprint)) {
    return { resetPerformed: false, reason: 'unchanged' };
  }

  if (previousFingerprint) {
    const entries = await readdir(input.codexDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!shouldResetEntry(entry.name)) continue;
      await rm(join(input.codexDir, entry.name), { recursive: true, force: true });
    }
  }

  await writeFile(fingerprintPath, JSON.stringify(nextFingerprint, null, 2), 'utf8');
  return {
    resetPerformed: Boolean(previousFingerprint),
    reason: previousFingerprint ? 'changed' : 'missing',
  };
}
