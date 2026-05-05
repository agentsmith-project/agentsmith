import { readdir, readFile, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { basename, extname, isAbsolute, join, relative } from 'node:path';

export type ScannedArtifact = {
  filename: string;
  task_relative_path: string;
  artifact_type: 'text' | 'image' | 'file' | 'other';
  mime_type?: string;
  file_size: number;
  title?: string;
  content?: string;
  thumbnail_url?: string;
  mtime_ms?: number;
};

const MAX_SCANNED_ARTIFACT_FILES = Math.max(1, Number(process.env.MBOS_AGENT_ARTIFACT_SCAN_MAX_FILES ?? '50') || 50);
const MAX_SCANNED_ARTIFACT_FILE_BYTES = Math.max(
  1024,
  Number(process.env.MBOS_AGENT_ARTIFACT_SCAN_MAX_FILE_BYTES ?? '10485760') || 10 * 1024 * 1024,
);
const MAX_INLINE_IMAGE_BYTES = Math.max(
  1024,
  Number(process.env.MBOS_AGENT_ARTIFACT_INLINE_IMAGE_MAX_BYTES ?? '2097152') || 2 * 1024 * 1024,
);
const MAX_TEXT_ARTIFACT_PREVIEW_BYTES = Math.max(
  256,
  Number(process.env.MBOS_AGENT_ARTIFACT_TEXT_PREVIEW_MAX_BYTES ?? '65536') || 64 * 1024,
);
const MAX_WORKSPACE_FILE_SCAN = Math.max(
  50,
  Number(process.env.MBOS_AGENT_WORKSPACE_FILE_SCAN_MAX_FILES ?? '500') || 500,
);
const MAX_WORKSPACE_FILE_CHANGE_LIST = Math.max(
  10,
  Number(process.env.MBOS_AGENT_WORKSPACE_FILE_CHANGE_LIST_MAX ?? '50') || 50,
);

export type WorkspaceFileSnapshot = Map<string, { size: number; mtimeMs: number }>;
export type WorkspaceFileChangeSummary = {
  scanned_count: number;
  added: string[];
  modified: string[];
  deleted: string[];
  truncated?: boolean;
};
export type WorkspaceFileScanOptions = {
  runtimeRoot?: string;
};

function inferArtifactKind(filename: string): {
  artifactType: ScannedArtifact['artifact_type'];
  mimeType?: string;
  isText: boolean;
  isImage: boolean;
} {
  const ext = extname(filename).toLowerCase();
  const imageMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  };
  if (imageMap[ext]) return { artifactType: 'image', mimeType: imageMap[ext], isText: false, isImage: true };
  const textMap: Record<string, string> = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.log': 'text/plain',
    '.yaml': 'application/yaml',
    '.yml': 'application/yaml',
    '.html': 'text/html',
  };
  if (textMap[ext]) return { artifactType: 'text', mimeType: textMap[ext], isText: true, isImage: false };
  const fileMap: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
  };
  if (fileMap[ext]) return { artifactType: 'file', mimeType: fileMap[ext], isText: false, isImage: false };
  return { artifactType: 'file', isText: false, isImage: false };
}

export async function scanArtifactsDirectory(artifactsDir: string, _taskId?: string): Promise<ScannedArtifact[]> {
  const relativePrefix = '.artifacts';
  let entries: Dirent[];
  try {
    entries = await readdir(artifactsDir, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return [];
  }
  const out: ScannedArtifact[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (out.length >= MAX_SCANNED_ARTIFACT_FILES) break;
    const absPath = join(artifactsDir, entry.name);
    let fileStat;
    try {
      fileStat = await stat(absPath);
    } catch {
      continue;
    }
    if (!fileStat.isFile() || fileStat.size > MAX_SCANNED_ARTIFACT_FILE_BYTES) continue;
    const inferred = inferArtifactKind(entry.name);
    const artifact: ScannedArtifact = {
      filename: entry.name,
      task_relative_path: `${relativePrefix}/${entry.name}`,
      artifact_type: inferred.artifactType,
      ...(inferred.mimeType ? { mime_type: inferred.mimeType } : {}),
      file_size: fileStat.size,
      title: basename(entry.name),
      mtime_ms: fileStat.mtimeMs,
    };
    try {
      if (inferred.isImage && fileStat.size <= MAX_INLINE_IMAGE_BYTES && artifact.mime_type) {
        const imageBytes = await readFile(absPath);
        const dataUrl = `data:${artifact.mime_type};base64,${imageBytes.toString('base64')}`;
        artifact.content = dataUrl;
        artifact.thumbnail_url = dataUrl;
      } else if (inferred.isText) {
        const textBytes = await readFile(absPath);
        artifact.content = textBytes.subarray(0, MAX_TEXT_ARTIFACT_PREVIEW_BYTES).toString('utf-8');
      }
    } catch {
      // metadata-only fallback
    }
    out.push(artifact);
  }
  return out;
}

function artifactFingerprint(artifact: ScannedArtifact): string {
  return [
    artifact.task_relative_path,
    String(artifact.file_size ?? 0),
    String(Math.floor(artifact.mtime_ms ?? 0)),
  ].join('|');
}

export function rememberArtifactsForRun(
  seenByRun: Map<string, Set<string>>,
  runKey: string,
  artifacts: ScannedArtifact[],
): void {
  let seen = seenByRun.get(runKey);
  if (!seen) {
    seen = new Set<string>();
    seenByRun.set(runKey, seen);
  }
  for (const artifact of artifacts) {
    seen.add(artifactFingerprint(artifact));
  }
}

export function filterNewArtifactsForRun(
  seenByRun: Map<string, Set<string>>,
  runKey: string,
  artifacts: ScannedArtifact[],
): ScannedArtifact[] {
  let seen = seenByRun.get(runKey);
  if (!seen) {
    seen = new Set<string>();
    seenByRun.set(runKey, seen);
  }
  const next: ScannedArtifact[] = [];
  for (const artifact of artifacts) {
    const fp = artifactFingerprint(artifact);
    if (seen.has(fp)) continue;
    seen.add(fp);
    next.push(artifact);
  }
  return next;
}

function isPathInsideOrSame(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function shouldSkipRuntimeRoot(cwd: string, absPath: string, runtimeRoot?: string): boolean {
  const normalizedRuntimeRoot = runtimeRoot?.trim();
  if (!normalizedRuntimeRoot) return false;
  const runtimeRel = relative(cwd, normalizedRuntimeRoot);
  if (runtimeRel === '' || runtimeRel.startsWith('..') || isAbsolute(runtimeRel)) return false;
  return isPathInsideOrSame(normalizedRuntimeRoot, absPath);
}

function shouldSkipWorkspaceEntry(relPath: string, entry: Dirent): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return true;
  const top = parts[0]!;
  if (
    top === '.codex'
    || top === '.artifacts'
    || top === '.mbos'
    || top === '.agents'
    || top === '.cache'
    || top === '.config'
    || top === '.local'
    || top === '.cargo'
    || top === '.rustup'
    || top === '.ipython'
    || top === '.trash'
    || top === '.minio.sys'
  ) return true;
  if (top === '.git' || top === 'node_modules') return true;
  if (entry.name.startsWith('.DS_Store')) return true;
  return false;
}

async function walkWorkspaceFiles(
  cwd: string,
  dir: string,
  out: WorkspaceFileSnapshot,
  state: { scanned: number; stop: boolean },
  options: WorkspaceFileScanOptions,
): Promise<void> {
  if (state.stop) return;
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (state.stop) return;
    const abs = join(dir, entry.name);
    const rel = relative(cwd, abs);
    if (!rel || rel.startsWith('..')) continue;
    if (shouldSkipRuntimeRoot(cwd, abs, options.runtimeRoot)) continue;
    if (shouldSkipWorkspaceEntry(rel, entry)) continue;
    if (entry.isDirectory()) {
      await walkWorkspaceFiles(cwd, abs, out, state, options);
      continue;
    }
    if (!entry.isFile()) continue;
    let st;
    try {
      st = await stat(abs);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    out.set(rel.replace(/\\/g, '/'), { size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
    state.scanned += 1;
    if (state.scanned >= MAX_WORKSPACE_FILE_SCAN) {
      state.stop = true;
      return;
    }
  }
}

export async function scanWorkspaceFilesSnapshot(
  cwd: string,
  options: WorkspaceFileScanOptions = {},
): Promise<WorkspaceFileSnapshot> {
  const snapshot: WorkspaceFileSnapshot = new Map();
  const state = { scanned: 0, stop: false };
  await walkWorkspaceFiles(cwd, cwd, snapshot, state, options);
  return snapshot;
}

function limitList(items: string[]): { items: string[]; truncated: boolean } {
  if (items.length <= MAX_WORKSPACE_FILE_CHANGE_LIST) return { items, truncated: false };
  return { items: items.slice(0, MAX_WORKSPACE_FILE_CHANGE_LIST), truncated: true };
}

export function diffWorkspaceFileSnapshots(
  before: WorkspaceFileSnapshot,
  after: WorkspaceFileSnapshot,
): WorkspaceFileChangeSummary {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  for (const [path, meta] of after.entries()) {
    const prev = before.get(path);
    if (!prev) {
      added.push(path);
      continue;
    }
    if (prev.size !== meta.size || prev.mtimeMs !== meta.mtimeMs) {
      modified.push(path);
    }
  }
  for (const path of before.keys()) {
    if (!after.has(path)) deleted.push(path);
  }
  added.sort();
  modified.sort();
  deleted.sort();
  const a = limitList(added);
  const m = limitList(modified);
  const d = limitList(deleted);
  return {
    scanned_count: after.size,
    added: a.items,
    modified: m.items,
    deleted: d.items,
    ...(a.truncated || m.truncated || d.truncated ? { truncated: true } : {}),
  };
}
