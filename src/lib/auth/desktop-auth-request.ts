'use client';

import { buildPublicApiUrl } from '@/lib/public-runtime-config';

export function buildDesktopAuthRequestHref(locale: string, requestId: string): string {
  return `/${locale}/desktop/auth/request?desktop_auth_request_id=${encodeURIComponent(requestId)}`;
}

export function buildDesktopAuthCompleteHref(locale: string, requestId: string): string {
  return `/${locale}/desktop/auth/complete?desktop_auth_request_id=${encodeURIComponent(requestId)}`;
}

export async function completeDesktopAuthRequest(requestId: string, accessToken: string): Promise<void> {
  const response = await fetch(buildPublicApiUrl(`/me/desktop/auth/requests/${encodeURIComponent(requestId)}/complete`), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`desktop_auth_complete_failed_${response.status}`);
  }
}
