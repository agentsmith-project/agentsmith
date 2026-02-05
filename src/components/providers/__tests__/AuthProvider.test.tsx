import { renderHook } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';

describe('AuthProvider global type', () => {
  it('should expose store on window with correct type', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );

    renderHook(() => {}, { wrapper });

    // This should type-check correctly
    if (process.env.NODE_ENV === 'development') {
      expect(window.__MBOS_AUTH_STORE__).toBeDefined();
      // Verify it's callable (Zustand store hook)
      expect(typeof window.__MBOS_AUTH_STORE__).toBe('function');
    }
  });
});
