import type { FileObjectMeta } from '@/lib/api/types';

export type PreviewKind = 'image' | 'pdf' | 'text' | 'none';

const TEXT_CONTENT_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-yaml',
  'application/yaml',
  'text/markdown',
]);

export function basename(path: string) {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const idx = trimmed.lastIndexOf('/');
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

export function extensionOf(filename: string) {
  const idx = filename.lastIndexOf('.');
  if (idx < 0 || idx === filename.length - 1) return '';
  return filename.slice(idx + 1).toLowerCase();
}

export function resolvePreviewKind(contentType: string, key: string): PreviewKind {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType === 'application/pdf') return 'pdf';
  if (contentType.startsWith('text/') || TEXT_CONTENT_TYPES.has(contentType)) return 'text';

  const ext = extensionOf(key);
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (['txt', 'md', 'json', 'csv', 'xml', 'yml', 'yaml', 'log', 'js', 'ts', 'tsx', 'jsx', 'css', 'html'].includes(ext)) {
    return 'text';
  }
  return 'none';
}

export function previewSupportsInline(kind: PreviewKind) {
  return kind === 'image' || kind === 'pdf' || kind === 'text';
}

export function previewTypeLabel(kind: PreviewKind, t: (key: string) => string) {
  if (kind === 'image') return t('file_manager.preview_type_image');
  if (kind === 'pdf') return t('file_manager.preview_type_pdf');
  if (kind === 'text') return t('file_manager.preview_type_text');
  return t('file_manager.preview_type_binary');
}

export function formatMetaSummary(meta: FileObjectMeta, t: (key: string) => string, formatBytes: (value: number) => string) {
  const filename = basename(meta.key);
  const ext = extensionOf(filename);
  return {
    ext,
    filename,
    summary: `${ext ? ext.toUpperCase() : t('file_manager.unknown')} · ${formatBytes(meta.size_bytes)} · ${new Date(meta.last_modified).toLocaleString()}`,
  };
}
