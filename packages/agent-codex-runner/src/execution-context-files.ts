import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, relative } from 'node:path';

export type ExecutionContextFileItem = {
  relative_path?: string;
  content?: string;
  description?: string;
};

const MAX_FILE_COUNT = 256;
const MAX_FILE_SIZE_BYTES = 512 * 1024;
const MAX_TOTAL_SIZE_BYTES = 4 * 1024 * 1024;

function normalizeRelativePath(input: string): string {
  const trimmed = input.trim().replace(/\\/g, '/');
  if (!trimmed) {
    throw new Error('execution_file_path_missing');
  }
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    throw new Error('execution_file_path_must_be_relative');
  }
  const normalized = normalize(trimmed).replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('../') || normalized === '..') {
    throw new Error('execution_file_path_outside_workspace');
  }
  if (normalized.includes('/../') || normalized.includes('/./') || normalized.endsWith('/..')) {
    throw new Error('execution_file_path_invalid_segments');
  }
  return normalized;
}

function resolveSafeTargetPath(cwd: string, relativePath: string): string {
  const normalizedRelative = normalizeRelativePath(relativePath);
  const targetPath = join(cwd, normalizedRelative);
  const rel = relative(cwd, targetPath);
  if (!rel || rel === '.') return targetPath;
  if (rel.startsWith('..') || rel.includes('/..') || rel.includes('\\..')) {
    throw new Error('execution_file_path_escape_detected');
  }
  return targetPath;
}

function resolveCredentialRoot(relativePath: string): string | null {
  const normalized = normalizeRelativePath(relativePath);
  if (normalized === '.codex/credential/index.json' || normalized.startsWith('.codex/credential/')) {
    return '.codex/credential';
  }
  const taskScopedMatch = normalized.match(/^\.codex\/tasks\/([^/]+)\/credential(?:\/|$)/);
  if (!taskScopedMatch) return null;
  return `.codex/tasks/${taskScopedMatch[1]}/credential`;
}

export async function applyExecutionContextFiles(
  cwd: string,
  inputItems: ExecutionContextFileItem[] | undefined,
): Promise<{ written: number; totalBytes: number }> {
  const items = Array.isArray(inputItems) ? inputItems : [];
  if (items.length > MAX_FILE_COUNT) {
    throw new Error('execution_files_count_exceeded');
  }

  const credentialRoots = new Set<string>();
  for (const item of items) {
    if (!item || typeof item !== 'object' || typeof item.relative_path !== 'string') continue;
    const credentialRoot = resolveCredentialRoot(item.relative_path);
    if (credentialRoot) {
      credentialRoots.add(credentialRoot);
    }
  }
  await Promise.all(
    Array.from(credentialRoots, (credentialRoot) =>
      rm(join(cwd, credentialRoot), { recursive: true, force: true })),
  );

  let totalBytes = 0;
  let written = 0;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const relativePath = typeof item.relative_path === 'string' ? item.relative_path : '';
    const content = typeof item.content === 'string' ? item.content : '';
    if (!relativePath) {
      throw new Error('execution_file_relative_path_required');
    }
    const bytes = Buffer.byteLength(content, 'utf-8');
    if (bytes > MAX_FILE_SIZE_BYTES) {
      throw new Error('execution_file_size_exceeded');
    }
    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_SIZE_BYTES) {
      throw new Error('execution_files_total_size_exceeded');
    }

    const targetPath = resolveSafeTargetPath(cwd, relativePath);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content, { encoding: 'utf-8', mode: 0o600 });
    written += 1;
  }

  return { written, totalBytes };
}
