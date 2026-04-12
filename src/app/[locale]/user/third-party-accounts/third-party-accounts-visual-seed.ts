import type { UserExternalConnection } from '@/lib/api';

const VISUAL_SEED_STORAGE_KEY = '__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__';

declare global {
  interface Window {
    __MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__?: UserExternalConnection[];
    __MBOS_VISUAL_E2E_CONTEXT__?: {
      thirdPartyAccountsBootstrap?: boolean;
    };
  }
}

function hasVisualThirdPartyAccountsBootstrapOptIn(): boolean {
  return window.__MBOS_VISUAL_E2E_CONTEXT__?.thirdPartyAccountsBootstrap === true;
}

export function readVisualThirdPartyAccountsSeed(options: { enabled: boolean }): UserExternalConnection[] | null {
  if (typeof window === 'undefined') return null;
  if (!options.enabled || !hasVisualThirdPartyAccountsBootstrapOptIn()) {
    return null;
  }
  try {
    const stored = window.sessionStorage.getItem(VISUAL_SEED_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as unknown;
        if (Array.isArray(parsed)) {
          return parsed as UserExternalConnection[];
        }
      } finally {
        window.sessionStorage.removeItem(VISUAL_SEED_STORAGE_KEY);
      }
    }
  } catch {
    // Fall back to the in-memory bootstrap channel below when session storage is unavailable.
  }
  const seed = window.__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__;
  return Array.isArray(seed) ? seed : null;
}

export function clearVisualThirdPartyAccountsSeed(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(VISUAL_SEED_STORAGE_KEY);
  } catch {
    // Ignore inaccessible storage; the in-memory bootstrap channel is already one-shot.
  }
  try {
    delete (window as Window & { __MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__?: UserExternalConnection[] }).__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__;
  } catch {
    (window as Window & { __MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__?: UserExternalConnection[] }).__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__ = undefined;
  }
  const visualContext = window.__MBOS_VISUAL_E2E_CONTEXT__;
  if (visualContext) {
    delete visualContext.thirdPartyAccountsBootstrap;
    if (Object.keys(visualContext).length === 0) {
      delete window.__MBOS_VISUAL_E2E_CONTEXT__;
    }
  }
}
