import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentWireApi } from '@mbos/agent-runner-contract';

const SESSION_FINGERPRINT_FILE = '.codex-session-fingerprint.json';
const RESUME_STATE_FILE = '.agentsmith-codex-resume-state.json';
const SESSION_STATE_VERSION = 'runner_session_v5';
const PROMPT_POLICY_VERSION = 'latest_user_only_v1';
const RESUME_STATE_VERSION = 'runner_resume_state_v1';

type SessionFingerprint = {
  session_state_version: string;
  prompt_policy_version: string;
  model: string;
  wire_api: AgentWireApi;
  resource_proxy_base: string;
  model_context_window: number | null;
  model_max_output_tokens: number | null;
  model_auto_compact_token_limit: number | null;
  model_catalog_signature: string | null;
};

type ResumeState = {
  resume_state_version: string;
  task_id: string;
};

function buildSessionFingerprint(input: {
  model: string;
  wireApi: AgentWireApi;
  resourceProxyBase: string;
  modelContextWindow?: number;
  modelMaxOutputTokens?: number;
  modelAutoCompactTokenLimit?: number;
  modelCatalogSignature?: string;
}): SessionFingerprint {
  return {
    session_state_version: SESSION_STATE_VERSION,
    prompt_policy_version: PROMPT_POLICY_VERSION,
    model: input.model,
    wire_api: input.wireApi,
    resource_proxy_base: input.resourceProxyBase,
    model_context_window: Number.isFinite(input.modelContextWindow) ? Math.floor(input.modelContextWindow!) : null,
    model_max_output_tokens: Number.isFinite(input.modelMaxOutputTokens) ? Math.floor(input.modelMaxOutputTokens!) : null,
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

function isSqliteSessionStateEntry(name: string): boolean {
  return /^state_.*\.sqlite(?:-(?:shm|wal))?$/.test(name) || /^logs_.*\.sqlite(?:-(?:shm|wal))?$/.test(name);
}

function shouldResetEntry(name: string): boolean {
  if (name === 'sessions' || name === 'shell_snapshots' || name === 'tmp' || name === RESUME_STATE_FILE) return true;
  return isSqliteSessionStateEntry(name);
}

async function readResumeState(codexDir: string): Promise<ResumeState | null> {
  const resumeStatePath = join(codexDir, RESUME_STATE_FILE);
  try {
    const parsed = JSON.parse(await readFile(resumeStatePath, 'utf8')) as Partial<ResumeState>;
    if (
      parsed.resume_state_version === RESUME_STATE_VERSION
      && typeof parsed.task_id === 'string'
      && parsed.task_id.trim().length > 0
    ) {
      return {
        resume_state_version: RESUME_STATE_VERSION,
        task_id: parsed.task_id.trim(),
      };
    }
  } catch {
    return null;
  }
  return null;
}

async function clearResumeState(codexDir: string): Promise<void> {
  await rm(join(codexDir, RESUME_STATE_FILE), { force: true });
}

async function hasReusableCodexSessionState(codexDir: string): Promise<boolean> {
  const entries = await readdir(codexDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'sessions' && entry.isDirectory()) {
      const sessionEntries = await readdir(join(codexDir, entry.name));
      if (sessionEntries.length > 0) return true;
      continue;
    }
    if (isSqliteSessionStateEntry(entry.name)) return true;
  }
  return false;
}

async function resetPersistedCodexSessionState(codexDir: string): Promise<void> {
  const entries = await readdir(codexDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!shouldResetEntry(entry.name)) continue;
    await rm(join(codexDir, entry.name), { recursive: true, force: true });
  }
}

export async function markCodexSessionStateReusable(input: {
  codexDir: string;
  taskId: string;
}): Promise<void> {
  await mkdir(input.codexDir, { recursive: true });
  if (!(await hasReusableCodexSessionState(input.codexDir))) {
    await clearResumeState(input.codexDir);
    return;
  }
  await writeFile(
    join(input.codexDir, RESUME_STATE_FILE),
    JSON.stringify({
      resume_state_version: RESUME_STATE_VERSION,
      task_id: input.taskId,
    }, null, 2),
    'utf8',
  );
}

export async function ensureCodexSessionStateCompatible(input: {
  codexDir: string;
  taskId: string;
  model: string;
  wireApi: AgentWireApi;
  resourceProxyBase: string;
  modelContextWindow?: number;
  modelMaxOutputTokens?: number;
  modelAutoCompactTokenLimit?: number;
  modelCatalogSignature?: string;
}): Promise<{ resetPerformed: boolean; reason: 'missing' | 'unchanged' | 'changed'; resumeAllowed: boolean }> {
  await mkdir(input.codexDir, { recursive: true });
  const fingerprintPath = join(input.codexDir, SESSION_FINGERPRINT_FILE);
  const nextFingerprint = buildSessionFingerprint({
    model: input.model,
    wireApi: input.wireApi,
    resourceProxyBase: input.resourceProxyBase,
    modelContextWindow: input.modelContextWindow,
    modelMaxOutputTokens: input.modelMaxOutputTokens,
    modelAutoCompactTokenLimit: input.modelAutoCompactTokenLimit,
    modelCatalogSignature: input.modelCatalogSignature,
  });

  let previousFingerprint: SessionFingerprint | null = null;
  try {
    previousFingerprint = JSON.parse(await readFile(fingerprintPath, 'utf8')) as SessionFingerprint;
  } catch {
    previousFingerprint = null;
  }

  if (!previousFingerprint) {
    const [resumeState, reusableStateExists] = await Promise.all([
      readResumeState(input.codexDir),
      hasReusableCodexSessionState(input.codexDir),
    ]);
    const shouldResetStaleState = reusableStateExists || resumeState !== null;
    if (shouldResetStaleState) {
      await resetPersistedCodexSessionState(input.codexDir);
    }
    await writeFile(fingerprintPath, JSON.stringify(nextFingerprint, null, 2), 'utf8');
    return {
      resetPerformed: shouldResetStaleState,
      reason: 'missing',
      resumeAllowed: false,
    };
  }

  if (!isSameFingerprint(previousFingerprint, nextFingerprint)) {
    await resetPersistedCodexSessionState(input.codexDir);
    await writeFile(fingerprintPath, JSON.stringify(nextFingerprint, null, 2), 'utf8');
    return {
      resetPerformed: true,
      reason: 'changed',
      resumeAllowed: false,
    };
  }

  const [resumeState, reusableStateExists] = await Promise.all([
    readResumeState(input.codexDir),
    hasReusableCodexSessionState(input.codexDir),
  ]);

  if (!reusableStateExists) {
    if (resumeState) {
      await clearResumeState(input.codexDir);
    }
    return {
      resetPerformed: false,
      reason: 'unchanged',
      resumeAllowed: false,
    };
  }

  if (resumeState?.task_id === input.taskId) {
    return {
      resetPerformed: false,
      reason: 'unchanged',
      resumeAllowed: true,
    };
  }

  await resetPersistedCodexSessionState(input.codexDir);
  return {
    resetPerformed: true,
    reason: 'changed',
    resumeAllowed: false,
  };
}
