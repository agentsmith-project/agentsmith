export function inferImageMimeType(fileName: string): string | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'bmp') return 'image/bmp';
  if (ext === 'svg') return 'image/svg+xml';
  return null;
}

export function resolveImageMimeType(fileType: string, fileName: string): string | null {
  if (fileType.startsWith('image/')) return fileType;
  return inferImageMimeType(fileName);
}

export function toImageDataUrl(contentBase64: string | undefined, mimeType: string | null): string | null {
  if (!contentBase64 || !mimeType) return null;
  return `data:${mimeType};base64,${contentBase64}`;
}
