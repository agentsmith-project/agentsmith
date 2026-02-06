'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/lib/stores/authStore';

interface AuthProviderProps {
  children: React.ReactNode;
}

/**
 * AuthProvider - Handles zustand store hydration on client side.
 *
 * This component ensures that the persisted auth state is properly restored
 * when the app loads on the client side.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  useEffect(() => {
    // useEffect only runs on the client, no typeof window check needed
    // The zustand persist middleware with custom storage will handle hydration automatically

    // Expose store globally for testing (development only)
    if (process.env.NODE_ENV === 'development') {
      window.__MBOS_AUTH_STORE__ = useAuthStore;
    }
  }, []);

  return <>{children}</>;
}
