export const MBOS_TEST_NOW_HEADER = 'X-MBOS-Test-Now';

function parseReferenceNow(value: string | null | undefined): Date | null {
  if (!value || value.trim().length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

declare global {
  interface Window {
    __MBOS_TEST_NOW__?: string;
  }
}

export function getInjectedTestNow(): Date | null {
  if (typeof window === 'undefined') return null;
  return parseReferenceNow(window.__MBOS_TEST_NOW__);
}

export function getReferenceNow(): Date {
  return getInjectedTestNow() ?? new Date();
}

export function getRequestReferenceNow(request: Pick<Request, 'headers'> | null | undefined): Date {
  if (!request) return new Date();
  return parseReferenceNow(request.headers.get(MBOS_TEST_NOW_HEADER)) ?? new Date();
}
