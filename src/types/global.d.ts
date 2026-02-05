import { AuthState } from '@/lib/stores/authStore';

/**
 * Global window extensions for development/testing
 */
declare global {
  interface Window {
    /**
     * Exposed auth store for E2E testing (development only)
     * This is a Zustand hook function, not the store instance.
     * When called, it returns the current auth state.
     */
    __MBOS_AUTH_STORE__?: () => AuthState;

    /**
     * Flag indicating mock auth setup is in progress (E2E testing)
     */
    __MBOS_AUTH_SETUP__?: boolean;
  }
}

export {};
