'use client';

import * as React from 'react';
import {
  Archive,
  Braces,
  File,
  FileAudio2,
  FileCode2,
  FileImage,
  FileJson2,
  FileSpreadsheet,
  FileText,
  FileVideo2,
  Folder,
} from 'lucide-react';

export type SourceIconKind = 'prefix' | 'object';

function extensionOf(value: string): string {
  const idx = value.lastIndexOf('.');
  if (idx < 0 || idx === value.length - 1) return '';
  return value.slice(idx + 1).toLowerCase();
}

function resolveObjectIcon(contentType: string, name: string) {
  const ext = extensionOf(name);
  const imageExts = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'ico', 'avif']);
  const textExts = new Set(['txt', 'md', 'csv', 'log', 'rtf']);
  const codeExts = new Set(['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'css', 'scss', 'html', 'sh']);
  const jsonExts = new Set(['json', 'jsonl']);
  const archiveExts = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz']);
  const sheetExts = new Set(['xls', 'xlsx', 'ods']);
  const audioExts = new Set(['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a']);
  const videoExts = new Set(['mp4', 'mov', 'mkv', 'webm', 'avi']);

  if (contentType.startsWith('image/') || imageExts.has(ext)) return FileImage;
  if (contentType === 'application/pdf' || ext === 'pdf') return FileText;
  if (contentType.includes('json') || jsonExts.has(ext)) return FileJson2;
  if (contentType.includes('javascript') || contentType.includes('xml') || contentType.includes('yaml') || codeExts.has(ext)) return FileCode2;
  if (contentType.startsWith('text/') || textExts.has(ext)) return FileText;
  if (contentType.startsWith('audio/') || audioExts.has(ext)) return FileAudio2;
  if (contentType.startsWith('video/') || videoExts.has(ext)) return FileVideo2;
  if (archiveExts.has(ext)) return Archive;
  if (sheetExts.has(ext)) return FileSpreadsheet;
  if (ext === 'csv') return Braces;
  return File;
}

export function SourceItemIcon({
  kind,
  name,
  contentType,
  className,
}: {
  kind: SourceIconKind;
  name: string;
  contentType?: string;
  className?: string;
}) {
  if (kind === 'prefix') {
    return <Folder className={className} aria-hidden="true" />;
  }
  const Icon = resolveObjectIcon(contentType ?? 'application/octet-stream', name);
  return <Icon className={className} aria-hidden="true" />;
}

