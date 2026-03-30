export function buildUpstreamUrl(baseUrl: string, proxyPath: string): string {
  const cleanBase = baseUrl
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/responses$/i, '')
    .replace(/\/messages(?:\/count_tokens)?$/i, '');
  const cleanPath = proxyPath.replace(/^\/+/, '').replace(/^v1\//i, '');
  const canonicalPath = cleanPath
    .replace(/^openai\//i, '')
    .replace(/^anthropic\//i, '');
  if (!canonicalPath) return cleanBase;
  if (canonicalPath.toLowerCase() === 'messages' || canonicalPath.toLowerCase().startsWith('messages/')) {
    const suffix = canonicalPath.toLowerCase() === 'messages'
      ? 'messages'
      : canonicalPath.replace(/^messages\//i, 'messages/');
    const lowerBase = cleanBase.toLowerCase();
    if (lowerBase.endsWith('/messages') || lowerBase.includes('/messages/')) {
      if (lowerBase.endsWith(`/${canonicalPath.toLowerCase()}`)) return cleanBase;
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
    cleanBase.toLowerCase().endsWith(`/${canonicalPath.toLowerCase()}`) ||
    cleanBase.toLowerCase().endsWith(canonicalPath.toLowerCase())
  ) {
    return cleanBase;
  }

  return `${cleanBase}/${canonicalPath}`;
}
