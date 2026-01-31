/**
 * MSW Provider
 *
 * Initializes MSW (Mock Service Worker) for development.
 * Only runs when NEXT_PUBLIC_USE_MSW=true.
 */

'use client';

import { useEffect } from 'react';
import { initMSW } from '@/mocks/browser';

export function MSWProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const useMsw = process.env.NEXT_PUBLIC_USE_MSW === 'true';
    if (useMsw) {
      initMSW();
    }
  }, []);

  return <>{children}</>;
}
