import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useResolvedProjectRoute } from '../use-resolved-project-route';

describe('useResolvedProjectRoute', () => {
  it('resolves validated project route params', async () => {
    const { result } = renderHook(() =>
      useResolvedProjectRoute(
        Promise.resolve({
          workspace: 'ws_default',
          project: 'proj_001',
          locale: 'zh-CN',
        }),
      ),
    );

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    expect(result.current).toEqual({
      workspace: 'ws_default',
      project: 'proj_001',
      locale: 'zh-CN',
      isReady: true,
      isValid: true,
    });
  });

  it('marks invalid route params after validation', async () => {
    const { result } = renderHook(() =>
      useResolvedProjectRoute(
        Promise.resolve({
          workspace: '<script>',
          project: 'proj_001',
          locale: 'en-US',
        }),
      ),
    );

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    expect(result.current.workspace).toBeNull();
    expect(result.current.project).toBe('proj_001');
    expect(result.current.isValid).toBe(false);
  });

  it('uses en-US when locale is missing-like input', async () => {
    const { result } = renderHook(() =>
      useResolvedProjectRoute(
        Promise.resolve({
          workspace: 'ws_default',
          project: 'proj_001',
          locale: '',
        }),
      ),
    );

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    expect(result.current.locale).toBe('en-US');
  });
});
