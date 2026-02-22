import { readdir, readFile, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { basename, extname, join } from 'node:path';

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

export async function scanArtifactsDirectory(cwd: string): Promise<ScannedArtifact[]> {
  const artifactsDir = join(cwd, 'artifacts');
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
      task_relative_path: `artifacts/${entry.name}`,
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

export function filterNewArtifactsForCwd(
  seenByCwd: Map<string, Set<string>>,
  cwd: string,
  artifacts: ScannedArtifact[],
): ScannedArtifact[] {
  let seen = seenByCwd.get(cwd);
  if (!seen) {
    seen = new Set<string>();
    seenByCwd.set(cwd, seen);
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

