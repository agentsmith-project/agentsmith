'use client';

import type { AbstractIntlMessages } from 'next-intl';
import { NextIntlClientProvider } from 'next-intl';

import { ToastContainer } from '@/components/ui/toast';

import { AuthProvider } from './AuthProvider';
import { MSWProvider } from './MSWProvider';
import { QueryProvider } from './QueryProvider';
import { RealtimeProvider } from './RealtimeProvider';
import { SessionRecoveryProvider } from './SessionRecoveryProvider';
import { ThemeProvider } from './ThemeProvider';

type RealtimeMode = 'real' | 'mock' | 'disabled';

type AppRootProvidersProps = {
  children: React.ReactNode;
  locale: string;
  messages: AbstractIntlMessages;
  realtimeMode?: RealtimeMode;
};

export function AppRootProviders({
  children,
  locale,
  messages,
  realtimeMode = 'disabled',
}: AppRootProvidersProps) {
  return (
    <AuthProvider>
      <MSWProvider>
        <RealtimeProvider mode={realtimeMode}>
          <QueryProvider>
            <SessionRecoveryProvider>
              <NextIntlClientProvider locale={locale} messages={messages}>
                <ThemeProvider>
                  <div data-testid="page-layout" className="h-full">
                    {children}
                  </div>
                  <ToastContainer />
                </ThemeProvider>
              </NextIntlClientProvider>
            </SessionRecoveryProvider>
          </QueryProvider>
        </RealtimeProvider>
      </MSWProvider>
    </AuthProvider>
  );
}
