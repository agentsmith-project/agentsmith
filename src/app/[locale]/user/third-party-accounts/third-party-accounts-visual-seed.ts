import type { UserExternalConnection } from '@/lib/api';

declare global {
  interface Window {
    __MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__?: UserExternalConnection[];
  }
}

export function readVisualThirdPartyAccountsSeed(): UserExternalConnection[] | null {
  if (typeof window === 'undefined') return null;
  const seed = window.__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__;
  return Array.isArray(seed) ? seed : null;
}
