'use client';

import { useEffect, useMemo, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/lib/stores/authStore';
import { addSessionRecoveryListener } from '@/lib/auth/session-recovery';

function resolveLocaleFromPathname(pathname: string | null): string {
  const first = pathname?.split('/').filter(Boolean)[0] ?? '';
  if (first === 'en-US' || first === 'zh-CN') return first;
  return 'en-US';
}

export function SessionRecoveryProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { clearAuth } = useAuthStore();
  const handlingRef = useRef(false);
  const locale = useMemo(() => resolveLocaleFromPathname(pathname), [pathname]);

  useEffect(() => {
    const unsubscribe = addSessionRecoveryListener(() => {
      if (handlingRef.current) return;
      handlingRef.current = true;
      clearAuth();
      queryClient.clear();
      router.replace(`/${locale}/login`);
      window.setTimeout(() => {
        handlingRef.current = false;
      }, 250);
    });

    return unsubscribe;
  }, [clearAuth, locale, queryClient, router]);

  return <>{children}</>;
}
