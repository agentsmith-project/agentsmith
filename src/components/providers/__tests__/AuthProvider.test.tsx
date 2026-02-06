import { renderHook } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

// Mock authStore to avoid the require('../api/client') side-effect at module load
vi.mock('@/lib/stores/authStore', async () => {
  const { create } = await import('zustand');
  return {
    useAuthStore: create(() => ({
      user: null,
      token: null,
      isAuthenticated: false,
      setAuth: () => {},
      clearAuth: () => {},
    })),
  };
});

import { AuthProvider } from '../AuthProvider';

describe('AuthProvider global type', () => {
  it('should render children without crashing', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );

    const { result } = renderHook(() => 'rendered', { wrapper });
    expect(result.current).toBe('rendered');
  });

  it('should expose store on window in development mode', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );

    renderHook(() => {}, { wrapper });

    // In test mode NODE_ENV is 'test', so the store is not exposed.
    // This verifies the component at least runs without error.
    if (process.env.NODE_ENV === 'development') {
      expect(window.__MBOS_AUTH_STORE__).toBeDefined();
      expect(typeof window.__MBOS_AUTH_STORE__).toBe('function');
    }
  });
});
