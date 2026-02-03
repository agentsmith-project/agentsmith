'use client';

import { ReactNode } from 'react';
import { Topbar } from '@/components/app-shell/Topbar';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function UserLayout({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-background flex flex-col">
        <Topbar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </ProtectedRoute>
  );
}
