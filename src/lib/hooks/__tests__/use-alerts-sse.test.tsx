/**
 * Tests for Real-time Alert SSE Hook (Epic C2 SSE Integration)
 *
 * Tests the SSE-based alert subscription hook that integrates
 * the alertStore with server-sent notifications.
 *
 * @module lib/hooks/__tests__/use-alerts-sse.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAlertsSSE, useProjectAlertsSSE, useWorkspaceAlertsSSE } from '../use-alerts-sse';

// Mock the SSE client module
vi.mock('@/lib/api/sse-client', () => ({
  createAuthenticatedSSEAsync: vi.fn(),
}));

// Mock EventSource type for tests
interface MockEventSourceOptions {
  autoConnect?: boolean;
  failConnect?: boolean;
}

class MockEventSource {
  readyState: number = 0; // CONNECTING = 0
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  url: string;
  _listeners: Map<string, Set<(event: MessageEvent | Event) => void>> = new Map();
  private _autoConnect: boolean;
  private _failConnect: boolean;

  constructor(url: string, options: MockEventSourceOptions = {}) {
    this.url = url;
    this._autoConnect = options.autoConnect ?? true;
    this._failConnect = options.failConnect ?? false;

    // Simulate async connection
    if (this._autoConnect && !this._failConnect) {
      setTimeout(() => {
        this.readyState = 1; // OPEN
        this._emitOpen();
      }, 10);
    } else if (this._failConnect) {
      setTimeout(() => {
        this.readyState = 2; // CLOSED
        this._emitError();
      }, 10);
    }
  }

  addEventListener(type: string, callback: (event: Event | MessageEvent) => void) {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, new Set());
    }
    this._listeners.get(type)!.add(callback);
  }

  removeEventListener(type: string, callback: (event: Event | MessageEvent) => void) {
    this._listeners.get(type)?.delete(callback);
  }

  close() {
    this.readyState = 2; // CLOSED
  }

  // Test helpers
  _emitOpen() {
    const openEvent = new Event('open');
    this.dispatchEvent(openEvent);
  }

  _emitMessage(type: string, data: unknown) {
    const messageEvent = new MessageEvent(type, { data });
    this._listeners.get(type)?.forEach((cb) => cb(messageEvent));
  }

  _emitError() {
    const errorEvent = new Event('error');
    this.dispatchEvent(errorEvent);
  }

  dispatchEvent(_event: Event) {
    // Simplified - in real EventSource this would trigger onmessage handlers
  }

  // Helper to manually set readyState for testing
  _setReadyState(state: number) {
    this.readyState = state;
  }
}

import { createAuthenticatedSSEAsync } from '@/lib/api/sse-client';

describe('use-alerts-sse: Real-time Alert Hook', () => {
  let _mockEventSourceInstance: MockEventSource | null = null;

  beforeEach(() => {
    // Reset auth store to avoid cross-test pollution
    vi.clearAllMocks();

    // Mock auth token by default so connections can be established
    vi.stubGlobal('window', { __AUTH_TOKEN__: 'test-token' });

    // Mock createAuthenticatedSSEAsync to return a MockEventSource
    vi.mocked(createAuthenticatedSSEAsync).mockImplementation(async (url, _token) => {
      // Simulate async connection delay
      await new Promise(resolve => setTimeout(resolve, 5));
      const es = new MockEventSource(url, { autoConnect: true });
      _mockEventSourceInstance = es;
      return es as unknown as EventSource;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    _mockEventSourceInstance = null;
  });

  describe('useAlertsSSE', () => {
    it('should not connect when enabled is false', async () => {
      const onConnect = vi.fn();
      const { result } = renderHook(() => useAlertsSSE({ enabled: false, onConnect }));

      // Wait a bit to ensure no connection was attempted
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
      });

      expect(result.current.connected).toBe(false);
      expect(onConnect).not.toHaveBeenCalled();
      expect(createAuthenticatedSSEAsync).not.toHaveBeenCalled();
    });

    it('should return control methods', () => {
      const { result } = renderHook(() => useAlertsSSE({ enabled: false }));

      expect(result.current.connect).toBeInstanceOf(Function);
      expect(result.current.disconnect).toBeInstanceOf(Function);
      expect(result.current.reconnect).toBeInstanceOf(Function);
    });

    it('should call onConnect callback when connection establishes', async () => {
      const onConnect = vi.fn();

      renderHook(() => useAlertsSSE({ enabled: true, onConnect }));

      await act(async () => {
        await vi.waitFor(() => {
          expect(onConnect).toHaveBeenCalled();
        }, { timeout: 3000 });
      });
    });

    it('should call onDisconnect callback when connection closes', async () => {
      const onDisconnect = vi.fn();
      const onConnect = vi.fn();
      const { result } = renderHook(() => useAlertsSSE({ enabled: true, onConnect, onDisconnect }));

      // Wait for connection first
      await act(async () => {
        await vi.waitFor(() => {
          expect(onConnect).toHaveBeenCalled();
        });
      });

      // Disconnect
      act(() => {
        result.current.disconnect();
      });

      expect(onDisconnect).toHaveBeenCalled();
    });

    it('should call onError when connection fails due to no auth token', async () => {
      const onError = vi.fn();

      // Override the mock for this test - clear auth token
      vi.stubGlobal('window', {});

      const { unmount } = renderHook(() => useAlertsSSE({ enabled: true, onError }));

      await act(async () => {
        await vi.waitFor(() => {
          // Should fail due to no token - the connect function checks for token
          expect(onError).toHaveBeenCalled();
        }, { timeout: 3000 });
      });

      unmount();
    });

    it('should ignore async connection failures after unmount', async () => {
      let rejectConnection: ((error: Error) => void) | null = null;
      const onError = vi.fn();

      vi.mocked(createAuthenticatedSSEAsync).mockImplementationOnce(() => {
        return new Promise((_resolve, reject) => {
          rejectConnection = reject;
        });
      });

      const { unmount } = renderHook(() => useAlertsSSE({ enabled: true, onError }));

      unmount();

      await act(async () => {
        rejectConnection?.(new Error('delayed connection failure'));
        await Promise.resolve();
      });

      expect(onError).not.toHaveBeenCalled();
    });

    it('should close a late connection result after unmount', async () => {
      let resolveConnection: ((eventSource: EventSource) => void) | null = null;
      const onConnect = vi.fn();
      const lateEventSource = new MockEventSource('/alerts/stream', { autoConnect: false });

      vi.mocked(createAuthenticatedSSEAsync).mockImplementationOnce(() => {
        return new Promise((resolve) => {
          resolveConnection = resolve;
        });
      });

      const { unmount } = renderHook(() => useAlertsSSE({ enabled: true, onConnect }));

      unmount();

      await act(async () => {
        resolveConnection?.(lateEventSource as unknown as EventSource);
        await Promise.resolve();
      });

      expect(lateEventSource.readyState).toBe(MockEventSource.CLOSED);
      expect(onConnect).not.toHaveBeenCalled();
    });
  });

  describe('useProjectAlertsSSE', () => {
    it('should not connect when projectId is undefined', () => {
      const { result } = renderHook(() => useProjectAlertsSSE(undefined));

      expect(result.current.connected).toBe(false);
    });

    it('should connect when projectId is provided', async () => {
      const projectId = 'proj-123';
      renderHook(() => useProjectAlertsSSE(projectId));

      await act(async () => {
        await vi.waitFor(() => {
          expect(createAuthenticatedSSEAsync).toHaveBeenCalled();
        }, { timeout: 3000 });
      });
    });
  });

  describe('useWorkspaceAlertsSSE', () => {
    it('should not connect when workspaceId is undefined', () => {
      const { result } = renderHook(() => useWorkspaceAlertsSSE(undefined));

      expect(result.current.connected).toBe(false);
    });

    it('should connect when workspaceId is provided', async () => {
      const workspaceId = 'ws-123';
      renderHook(() => useWorkspaceAlertsSSE(workspaceId));

      await act(async () => {
        await vi.waitFor(() => {
          expect(createAuthenticatedSSEAsync).toHaveBeenCalled();
        }, { timeout: 3000 });
      });
    });
  });
});
