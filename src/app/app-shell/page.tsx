'use client';

import * as React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { Topbar } from '@/components/app-shell/Topbar';
import { AppShellSidebar } from '@/components/app-shell/AppShellSidebar';
import { AuthProvider } from '@/components/providers/AuthProvider';
import { MSWProvider } from '@/components/providers/MSWProvider';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { ToastContainer } from '@/components/ui/toast';
import messages from '@/messages/en-US.json';

export default function AppShellPage() {

  return (
    <AuthProvider>
      <MSWProvider>
        <QueryProvider>
          <NextIntlClientProvider locale="en-US" messages={messages}>
            <PageState state="success">
              <PageLayout>
                <div className="flex flex-col h-screen">
                  <Topbar />
                  <div className="flex flex-1 overflow-hidden">
                    <AppShellSidebar />
                    <main className="flex-1 overflow-auto p-6">
                      <div className="max-w-4xl mx-auto space-y-6">
                        <div>
                          <h1 className="text-2xl font-bold text-primary">App Shell</h1>
                          <p className="text-secondary">Application shell components with dark theme</p>
                        </div>

                        <div className="grid gap-6">
                          <div className="bg-surface border border-subtle rounded-lg p-6">
                            <h2 className="text-lg font-semibold text-primary mb-4">State</h2>
                            <div className="space-y-2 text-sm">
                              <p><span className="text-secondary">Context:</span> Workspace/Project-aware</p>
                            </div>
                          </div>

                          <div className="bg-surface border border-subtle rounded-lg p-6">
                            <h2 className="text-lg font-semibold text-primary mb-4">Components</h2>
                            <ul className="space-y-1 text-sm text-secondary">
                              <li>✓ Topbar with Logo, Switchers, User Menu</li>
                              <li>✓ Sidebar with icon menu items</li>
                              <li>✓ Active state indicators</li>
                              <li>✓ Hover effects</li>
                              <li>✓ Dark theme colors</li>
                            </ul>
                          </div>

                          <div className="bg-surface border border-subtle rounded-lg p-6">
                            <h2 className="text-lg font-semibold text-primary mb-4">Design System</h2>
                            <p className="text-sm text-secondary mb-2">Current implementation tokens live in globals.css. Constitutional UI direction lives in DESIGN.md.</p>
                            <ul className="space-y-1 text-xs">
                              <li><code className="text-accent">--bg-base: #191919</code> - App background</li>
                              <li><code className="text-accent">--bg-panel: #1f1f1f</code> - Navigation, cards</li>
                              <li><code className="text-accent">--bg-surface: #252525</code> - Dialogs, inputs</li>
                              <li><code className="text-accent">--bg-hover: #2a2a2a</code> - Hover, selected</li>
                              <li><code className="text-accent">--text-primary: #ffffff</code></li>
                              <li><code className="text-accent">--text-secondary: #c6c6c9</code></li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    </main>
                  </div>
                </div>
              </PageLayout>
            </PageState>
            <ToastContainer />
          </NextIntlClientProvider>
        </QueryProvider>
      </MSWProvider>
    </AuthProvider>
  );
}
