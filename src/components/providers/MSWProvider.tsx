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

type MSWBootstrapState = 'loading' | 'ready' | 'blocked';

function resolveBootstrapState(
  strictReady: boolean,
  outcome: 'ready' | 'failed',
): MSWBootstrapState {
  if (outcome === 'ready') {
    return 'ready';
  }

  return strictReady ? 'blocked' : 'ready';
}

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
  const [bootstrapState, setBootstrapState] = useState<MSWBootstrapState>(useMsw ? 'loading' : 'ready');

  useEffect(() => {
    if (!useMsw || typeof window === 'undefined') return;
    let cancelled = false;

    const applyOutcome = (outcome: 'ready' | 'failed', error?: unknown) => {
      if (outcome === 'ready') {
        console.log('[MSW] Service Worker initialized successfully');
      } else {
        console.error('[MSW] Failed to initialize:', error);
        console.info('[MSW] Make sure you ran: npx msw init ./public');
      }

      if (!cancelled) {
        setBootstrapState(resolveBootstrapState(strictReady, outcome));
      }
    };

    initMSW()
      .then(() => {
        applyOutcome('ready');
      })
      .catch((error) => {
        applyOutcome('failed', error);
      });

    return () => {
      cancelled = true;
    };
  }, [strictReady, useMsw]);

  if (bootstrapState === 'loading') {
    return (
      <div data-testid="page-state__loading" className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-secondary">Starting mocks...</p>
        </div>
      </div>
    );
  }

  if (bootstrapState === 'blocked') {
    return (
      <div data-testid="page-state__error" className="min-h-screen flex items-center justify-center px-4 py-6">
        <div className="max-w-md text-center">
          <p className="text-sm font-medium text-foreground">Mocks failed to start.</p>
          <p className="mt-2 text-sm text-secondary">
            Strict mock readiness is enabled, so the UI stays blocked until the mock service worker becomes ready and takes control.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
