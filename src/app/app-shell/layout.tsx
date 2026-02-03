import * as React from 'react';
import type { Metadata } from 'next';

// Prevent static generation - child page uses useRouter via Topbar/AppShellSidebar
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'App Shell - MBOS',
  description: 'Application shell components for MBOS platform',
};

export default function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen">{children}</div>;
}
