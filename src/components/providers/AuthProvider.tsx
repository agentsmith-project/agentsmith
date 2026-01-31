'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/lib/stores/authStore';

interface AuthProviderProps {
  children: React.ReactNode;
}

/**
 * AuthProvider - Handles zustand store hydration on client side.
 *
 * This component ensures that the persisted auth state is properly restored
 * when the app loads on the client side.
 *
 * With skipHydration: true in the persist configuration, we need to manually
 * trigger rehydration after the component mounts on the client.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let mounted = true;

    // Only run on client side
    if (typeof window !== 'undefined') {
      // Manually trigger rehydration and wait for it to complete
      useAuthStore.persist.rehydrate().then(() => {
        if (mounted) {
          setHydrated(true);
        }
      });

      // Also listen for storage events (for cross-tab sync or programmatic changes)
      const handleStorageChange = (e: StorageEvent) => {
        if (e.key === 'mbos-auth' && e.newValue) {
          useAuthStore.persist.rehydrate();
        }
      };

      window.addEventListener('storage', handleStorageChange);

      return () => {
        mounted = false;
        window.removeEventListener('storage', handleStorageChange);
      };
    }
  }, []);

  // Don't block rendering - just track hydration state internally
  // Components that need auth can check the store directly
  return <>{children}</>;
}
