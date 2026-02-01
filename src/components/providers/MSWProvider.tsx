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
    if (useMsw && typeof window !== 'undefined') {
      initMSW().then(() => {
        console.log('[MSW] Service Worker initialized successfully');
      }).catch((err) => {
        console.error('[MSW] Failed to initialize:', err);
        console.info('[MSW] Make sure you ran: npx msw init ./public');
      });
    }
  }, []);

  return <>{children}</>;
}
