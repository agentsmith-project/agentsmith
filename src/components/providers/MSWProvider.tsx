/**
 * MSW Provider
 *
 * Initializes MSW (Mock Service Worker) for development.
 * Only runs when NEXT_PUBLIC_USE_MSW=true.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { initMSW } from '@/mocks/browser';

export function MSWProvider({ children }: { children: React.ReactNode }) {
  const useMsw = useMemo(
    () => process.env.NEXT_PUBLIC_USE_MSW === 'true',
    [],
  );
  const [ready, setReady] = useState(!useMsw);

  useEffect(() => {
    if (useMsw && typeof window !== 'undefined') {
      initMSW().then(() => {
        console.log('[MSW] Service Worker initialized successfully');
        setReady(true);
      }).catch((err) => {
        console.error('[MSW] Failed to initialize:', err);
        console.info('[MSW] Make sure you ran: npx msw init ./public');
        setReady(true);
      });
    }
  }, [useMsw]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-secondary">Starting mocks...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
