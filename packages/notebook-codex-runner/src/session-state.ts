import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SESSION_FINGERPRINT_FILE = '.codex-session-fingerprint.json';
const SESSION_STATE_VERSION = 'runner_session_v3';
const PROMPT_POLICY_VERSION = 'latest_user_only_v1';

type SessionFingerprint = {
  session_state_version: string;
  prompt_policy_version: string;
  model: string;
  wire_api: 'chat' | 'responses';
  resource_proxy_base: string;
  interaction_kind: 'notebook';
  model_context_window: number | null;
  model_auto_compact_token_limit: number | null;
  model_catalog_signature: string | null;
};

function buildSessionFingerprint(input: {
  model: string;
  wireApi: 'chat' | 'responses';
  resourceProxyBase: string;
  interactionKind: 'notebook';
  modelContextWindow?: number;
  modelAutoCompactTokenLimit?: number;
  modelCatalogSignature?: string;
}): SessionFingerprint {
  return {
    session_state_version: SESSION_STATE_VERSION,
    prompt_policy_version: PROMPT_POLICY_VERSION,
    model: input.model,
    wire_api: input.wireApi,
    resource_proxy_base: input.resourceProxyBase,
    interaction_kind: input.interactionKind,
    model_context_window: Number.isFinite(input.modelContextWindow) ? Math.floor(input.modelContextWindow!) : null,
    model_auto_compact_token_limit: Number.isFinite(input.modelAutoCompactTokenLimit)
      ? Math.floor(input.modelAutoCompactTokenLimit!)
      : null,
    model_catalog_signature:
      typeof input.modelCatalogSignature === 'string' && input.modelCatalogSignature.trim().length > 0
        ? input.modelCatalogSignature
        : null,
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
  interactionKind: 'notebook';
  modelContextWindow?: number;
  modelAutoCompactTokenLimit?: number;
  modelCatalogSignature?: string;
}): Promise<{ resetPerformed: boolean; reason: 'missing' | 'unchanged' | 'changed' }> {
  await mkdir(input.codexDir, { recursive: true });
  const fingerprintPath = join(input.codexDir, SESSION_FINGERPRINT_FILE);
  const nextFingerprint = buildSessionFingerprint({
    model: input.model,
    wireApi: input.wireApi,
    resourceProxyBase: input.resourceProxyBase,
    interactionKind: input.interactionKind,
    modelContextWindow: input.modelContextWindow,
    modelAutoCompactTokenLimit: input.modelAutoCompactTokenLimit,
    modelCatalogSignature: input.modelCatalogSignature,
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
