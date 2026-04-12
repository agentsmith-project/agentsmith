import type { AuthState } from '@/lib/stores/authStore';
import type { PublicRuntimeConfig } from '@/lib/public-runtime-config';

/**
 * Global window extensions for development/testing
 */
declare global {
  interface Window {
    /**
     * Exposed auth store for E2E testing (development only)
     * This is a Zustand UseBoundStore hook with getState() for external access.
     */
    __MBOS_AUTH_STORE__?: (() => AuthState) & {
      getState: () => AuthState;
    };

    /**
     * Flag indicating mock auth setup is in progress (E2E testing)
     */
    __MBOS_AUTH_SETUP__?: boolean;

    /**
     * Current E2E mock auth context used for auth re-seeding after redirects.
     */
    __MBOS_AUTH_E2E_CONTEXT__?: {
      wsId: string;
      userEmail: string;
      userId: string;
      token?: string;
    };

    __MBOS_VISUAL_E2E_CONTEXT__?: {
      thirdPartyAccountsBootstrap?: boolean;
    };

    __MBOS_PUBLIC_RUNTIME_CONFIG__?: PublicRuntimeConfig;
  }
}

export {};
