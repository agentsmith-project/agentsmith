export function buildUpstreamUrl(baseUrl: string, proxyPath: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const cleanPath = proxyPath.replace(/^\/+/, '');
  if (!cleanPath) return cleanBase;
  if (cleanPath.toLowerCase() === 'messages' || cleanPath.toLowerCase().startsWith('messages/')) {
    const suffix = cleanPath.toLowerCase() === 'messages'
      ? 'messages'
      : cleanPath.replace(/^messages\//i, 'messages/');
    const lowerBase = cleanBase.toLowerCase();
    if (lowerBase.endsWith('/messages') || lowerBase.includes('/messages/')) {
      if (lowerBase.endsWith(`/${cleanPath.toLowerCase()}`)) return cleanBase;
      if (lowerBase.endsWith('/messages') && suffix !== 'messages') {
        return `${cleanBase}/${suffix.replace(/^messages\//i, '')}`;
      }
      return cleanBase;
    }
    if (/\/v\d+$/i.test(cleanBase)) {
      return `${cleanBase}/${suffix}`;
    }
    return `${cleanBase}/v1/${suffix}`;
  }

  // Be tolerant of base URLs that already include the target API path.
  // Example: base_url ".../chat/completions" + proxyPath "chat/completions".
  if (
    cleanBase.toLowerCase().endsWith(`/${cleanPath.toLowerCase()}`) ||
    cleanBase.toLowerCase().endsWith(cleanPath.toLowerCase())
  ) {
    return cleanBase;
  }

  return `${cleanBase}/${cleanPath}`;
}
