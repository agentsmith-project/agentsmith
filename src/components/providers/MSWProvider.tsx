/**
 * MSW Provider
 *
 * Initializes MSW (Mock Service Worker) for development.
 * Only runs when NEXT_PUBLIC_USE_MSW=true.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { initMSW } from '@/mocks/browser';
import { getPublicRuntimeConfig } from '@/lib/public-runtime-config';

export function MSWProvider({ children }: { children: React.ReactNode }) {
  const runtimeConfig = useMemo(() => getPublicRuntimeConfig(), []);
  const useMsw = useMemo(
    () => runtimeConfig.useMsw,
    [runtimeConfig],
  );
  const strictReady = useMemo(
    () => runtimeConfig.mswStrictReady,
    [runtimeConfig],
  );
  const [ready, setReady] = useState(!useMsw);

  useEffect(() => {
    if (!useMsw || typeof window === 'undefined') return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (!cancelled) {
        if (strictReady) {
          console.warn('[MSW] init timeout, strict mode keeps UI blocked until worker is ready');
        } else {
          console.warn('[MSW] init timeout, continuing without blocking UI');
          setReady(true);
        }
      }
    }, 5000);

    initMSW().then(() => {
      console.log('[MSW] Service Worker initialized successfully');
      if (!cancelled) setReady(true);
    }).catch((err) => {
      console.error('[MSW] Failed to initialize:', err);
      console.info('[MSW] Make sure you ran: npx msw init ./public');
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [strictReady, useMsw]);

  if (!ready) {
    return (
      <div data-testid="page-state__loading" className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-secondary">Starting mocks...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
