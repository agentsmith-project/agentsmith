/**
 * Alert Store Unit Tests
 *
 * Tests for the Zustand alert store with localStorage persistence.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAlertStore } from '../alertStore';
import type { Alert } from '@/lib/types/alerts';

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock('@/components/ui/toast', () => ({
  toast: toastMock,
}));

// Proper localStorage mock (kept for completeness, but not used for zustand)
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => {
      return Object.keys(store)[index] || null;
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock zustand persist to bypass localStorage in tests
// The persist middleware is replaced with a pass-through that returns the config directly
vi.mock('zustand/middleware', () => ({
  persist: (stateCreator: any) => stateCreator, // Bypass persist, return store creator as-is
  createJSONStorage: () => undefined,
}));

describe('alertStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear localStorage before each test
    localStorageMock.clear();
    // Reset the store state using setState (triggers updates)
    useAlertStore.setState({
      alerts: [],
      preferences: {
        in_app_enabled: true,
        severity_threshold: 'warning',
        alert_types: [
          'quota.exceeded',
          'rate_limit.exceeded',
          'policy.allow_list.denied',
          'endpoint.error',
        ],
      },
      unreadCount: 0,
    });
  });

  describe('addAlert', () => {
    it('should add a new alert with generated id and timestamp', () => {
      const { result } = renderHook(() => useAlertStore());
      const alertData: Omit<Alert, 'id' | 'created_at' | 'status'> = {
        workspace_id: 'ws_1',
        project_id: 'proj_1',
        type: 'quota.exceeded',
        severity: 'error',
        title: 'Limit Exceeded',
        message: 'You have exceeded your token limit',
        resource_type: 'endpoint',
        resource_id: 'ep_1',
        resource_name: 'gpt-4',
        metadata: {
          quota_used: 100000,
          quota_limit: 100000,
        },
      };

      act(() => {
        result.current.addAlert(alertData);
      });

      const alerts = result.current.alerts;
      expect(alerts).toHaveLength(1);
      expect(alerts[0].id).toMatch(/^alert_\d+_\w+$/);
      expect(alerts[0].status).toBe('unread');
      expect(alerts[0].created_at).toBeDefined();
    });

    it('should increment unread count for new alerts', () => {
      const { result } = renderHook(() => useAlertStore());

      act(() => {
        result.current.addAlert({
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          type: 'quota.exceeded',
          severity: 'error',
          title: 'Alert 1',
          message: 'Message 1',
          metadata: {},
        });
      });

      expect(result.current.unreadCount).toBe(1);

      act(() => {
        result.current.addAlert({
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          type: 'endpoint.error',
          severity: 'warning',
          title: 'Alert 2',
          message: 'Message 2',
          metadata: {},
        });
      });

      expect(result.current.unreadCount).toBe(2);
    });

    it('should filter alerts below severity threshold', () => {
      const { result } = renderHook(() => useAlertStore());

      // Set threshold to error (only error and critical should pass)
      act(() => {
        result.current.updatePreferences({ severity_threshold: 'error' });
      });

      act(() => {
        result.current.addAlert({
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          type: 'quota.exceeded',
          severity: 'warning', // Below threshold
          title: 'Warning Alert',
          message: 'Should be filtered',
          metadata: {},
        });
      });

      expect(result.current.alerts).toHaveLength(0);
      expect(result.current.unreadCount).toBe(0);
    });

    it('should filter alerts not in enabled alert types', () => {
      const { result } = renderHook(() => useAlertStore());

      // Remove quota.exceeded from enabled types (limit semantic)
      act(() => {
        result.current.updatePreferences({
          alert_types: ['rate_limit.exceeded', 'policy.allow_list.denied'],
        });
      });

      act(() => {
        result.current.addAlert({
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          type: 'quota.exceeded', // Not in enabled types
          severity: 'error',
          title: 'Limit Alert',
          message: 'Should be filtered',
          metadata: {},
        });
      });

      expect(result.current.alerts).toHaveLength(0);
    });

    it('shows toast for high severity alerts', () => {
      const { result } = renderHook(() => useAlertStore());

      act(() => {
        result.current.addAlert({
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          type: 'quota.exceeded',
          severity: 'error',
          title: 'Critical limit alert',
          message: 'Over limit',
          metadata: {},
        });
      });

      expect(toastMock.error).toHaveBeenCalledWith('Critical limit alert');
    });

    it('does not show toast for warning alerts', () => {
      const { result } = renderHook(() => useAlertStore());

      act(() => {
        result.current.addAlert({
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          type: 'quota.warning',
          severity: 'warning',
          title: 'Warning',
          message: 'Approaching limit',
          metadata: {},
        });
      });

      expect(toastMock.error).not.toHaveBeenCalled();
    });
  });

  describe('markAsRead', () => {
    it('should mark an alert as read and update unread count', () => {
      const { result } = renderHook(() => useAlertStore());

      // Add an alert first
      act(() => {
        result.current.addAlert({
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          type: 'quota.exceeded',
          severity: 'error',
          title: 'Test Alert',
          message: 'Test message',
          metadata: {},
        });
      });

      const firstAlertId = result.current.alerts[0].id;
      expect(result.current.unreadCount).toBe(1);

      // Mark as read
      act(() => {
        result.current.markAsRead(firstAlertId);
      });

      expect(result.current.alerts[0].status).toBe('read');
      expect(result.current.alerts[0].read_at).toBeDefined();
      expect(result.current.unreadCount).toBe(0);
    });

    it('should only mark matching alerts as read', () => {
      const { result } = renderHook(() => useAlertStore());

      // Add two alerts
      act(() => {
        result.current.addAlert({
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          type: 'quota.exceeded',
          severity: 'error',
          title: 'Alert 1',
          message: 'Message 1',
          metadata: {},
        });
        result.current.addAlert({
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          type: 'endpoint.error',
          severity: 'warning',
          title: 'Alert 2',
          message: 'Message 2',
          metadata: {},
        });
      });

      const secondAlertId = result.current.alerts[1].id;
      expect(result.current.unreadCount).toBe(2);

      // Mark only the second one as read
      act(() => {
        result.current.markAsRead(secondAlertId);
      });

      expect(result.current.alerts[0].status).toBe('unread');
      expect(result.current.alerts[1].status).toBe('read');
      expect(result.current.unreadCount).toBe(1);
    });
  });

  describe('markMultipleAsRead', () => {
    it('should mark multiple alerts as read', () => {
      const { result } = renderHook(() => useAlertStore());

      // Add three alerts
      act(() => {
        for (let i = 0; i < 3; i++) {
          result.current.addAlert({
            workspace_id: 'ws_1',
            project_id: 'proj_1',
            type: 'quota.exceeded',
            severity: 'error',
            title: `Alert ${i}`,
            message: `Message ${i}`,
            metadata: {},
          });
        }
      });

      expect(result.current.unreadCount).toBe(3);

      const alertIds = result.current.alerts.slice(0, 2).map((a) => a.id);
      act(() => {
        result.current.markMultipleAsRead(alertIds);
      });

      expect(result.current.unreadCount).toBe(1);
      expect(result.current.alerts[0].status).toBe('read');
      expect(result.current.alerts[1].status).toBe('read');
      expect(result.current.alerts[2].status).toBe('unread');
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all alerts as read', () => {
      const { result } = renderHook(() => useAlertStore());

      // Add multiple alerts
      act(() => {
        for (let i = 0; i < 5; i++) {
          result.current.addAlert({
            workspace_id: 'ws_1',
            project_id: 'proj_1',
            type: 'quota.exceeded',
            severity: 'error',
            title: `Alert ${i}`,
            message: `Message ${i}`,
            metadata: {},
          });
        }
      });

      expect(result.current.unreadCount).toBe(5);

      act(() => {
        result.current.markAllAsRead();
      });

      expect(result.current.unreadCount).toBe(0);
      result.current.alerts.forEach((alert) => {
        expect(alert.status).toBe('read');
      });
    });

    it('should handle already-read alerts gracefully', () => {
      const { result } = renderHook(() => useAlertStore());

      act(() => {
        result.current.addAlert({
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          type: 'quota.exceeded',
          severity: 'error',
          title: 'Alert 1',
          message: 'Message 1',
          metadata: {},
        });
      });

      act(() => {
        result.current.markAllAsRead();
      });

      expect(result.current.unreadCount).toBe(0);

      // Calling again should not cause issues
      act(() => {
        result.current.markAllAsRead();
      });

      expect(result.current.unreadCount).toBe(0);
    });
  });

  describe('dismissAlert', () => {
    it('should mark an alert as dismissed', () => {
      const { result } = renderHook(() => useAlertStore());

      act(() => {
        result.current.addAlert({
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          type: 'quota.exceeded',
          severity: 'error',
          title: 'Alert 1',
          message: 'Message 1',
          metadata: {},
        });
      });

      const alertId = result.current.alerts[0].id;
      expect(result.current.unreadCount).toBe(1);

      act(() => {
        result.current.dismissAlert(alertId);
      });

      expect(result.current.alerts[0].status).toBe('dismissed');
      expect(result.current.alerts[0].dismissed_at).toBeDefined();
      // Dismissed alerts should not count as unread
      expect(result.current.unreadCount).toBe(0);
    });
  });

  describe('dismissMultiple', () => {
    it('should dismiss multiple alerts at once', () => {
      const { result } = renderHook(() => useAlertStore());

      // Add three alerts
      act(() => {
        for (let i = 0; i < 3; i++) {
          result.current.addAlert({
            workspace_id: 'ws_1',
            project_id: 'proj_1',
            type: 'quota.exceeded',
            severity: 'error',
            title: `Alert ${i}`,
            message: `Message ${i}`,
            metadata: {},
          });
        }
      });

      expect(result.current.unreadCount).toBe(3);

      const alertIds = result.current.alerts.map((a) => a.id);
      act(() => {
        result.current.dismissMultiple(alertIds);
      });

      expect(result.current.unreadCount).toBe(0);
      result.current.alerts.forEach((alert) => {
        expect(alert.status).toBe('dismissed');
      });
    });
  });

  describe('clearDismissed', () => {
    it('should remove all dismissed alerts', () => {
      const { result } = renderHook(() => useAlertStore());

      // Add and dismiss some alerts
      act(() => {
        result.current.addAlert({
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          type: 'quota.exceeded',
          severity: 'error',
          title: 'Alert 1',
          message: 'Message 1',
          metadata: {},
        });
        result.current.addAlert({
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          type: 'endpoint.error',
          severity: 'warning',
          title: 'Alert 2',
          message: 'Message 2',
          metadata: {},
        });
      });

      const alertId = result.current.alerts[0].id;
      act(() => {
        result.current.dismissAlert(alertId);
      });

      expect(result.current.alerts).toHaveLength(2);

      act(() => {
        result.current.clearDismissed();
      });

      expect(result.current.alerts).toHaveLength(1);
      expect(result.current.alerts[0].status).toBe('unread');
    });

    it('should only remove dismissed alerts before the cutoff date', () => {
      const { result } = renderHook(() => useAlertStore());

      // Add two alerts
      act(() => {
        result.current.addAlert({
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          type: 'quota.exceeded',
          severity: 'error',
          title: 'Alert 1',
          message: 'Message 1',
          metadata: {},
        });
        result.current.addAlert({
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          type: 'endpoint.error',
          severity: 'warning',
          title: 'Alert 2',
          message: 'Message 2',
          metadata: {},
        });
      });

      // Get alert IDs after they're added
      const alert1Id = result.current.alerts[0].id;
      const alert2Id = result.current.alerts[1].id;

      // Dismiss both alerts
      act(() => {
        result.current.dismissAlert(alert1Id);
        result.current.dismissAlert(alert2Id);
      });

      expect(result.current.alerts).toHaveLength(2);

      // Manually set one alert to have an old dismissed_at date
      act(() => {
        useAlertStore.setState((state) => ({
          alerts: state.alerts.map((a) =>
            a.id === alert1Id
              ? { ...a, dismissed_at: '2025-01-01T00:00:00.000Z' }
              : a
          ),
        }));
      });

      // Clear dismissed alerts before 2026-01-01
      act(() => {
        result.current.clearDismissed('2026-01-01');
      });

      // Only the recent dismissed alert should remain
      const storeState = useAlertStore.getState();
      expect(storeState.alerts).toHaveLength(1);
      expect(storeState.alerts[0].id).toBe(alert2Id);
    });
  });

  describe('updatePreferences', () => {
    it('should update preferences', () => {
      const { result } = renderHook(() => useAlertStore());

      act(() => {
        result.current.updatePreferences({
          severity_threshold: 'error',
        });
      });

      expect(result.current.preferences.severity_threshold).toBe('error');
    });

    it('should merge preferences with existing ones', () => {
      const { result } = renderHook(() => useAlertStore());

      const originalTypes = result.current.preferences.alert_types;

      act(() => {
        result.current.updatePreferences({
          severity_threshold: 'critical',
        });
      });

      expect(result.current.preferences.severity_threshold).toBe('critical');
      expect(result.current.preferences.alert_types).toEqual(originalTypes);
    });
  });

  describe('preferences filtering', () => {
    it('should respect severity_threshold when adding alerts', () => {
      const { result } = renderHook(() => useAlertStore());

      // Set threshold to critical
      act(() => {
        result.current.updatePreferences({ severity_threshold: 'critical' });
      });

      // Add error alert (below threshold)
      act(() => {
        result.current.addAlert({
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          type: 'quota.exceeded',
          severity: 'error',
          title: 'Error Alert',
          message: 'Should be filtered',
          metadata: {},
        });
      });

      expect(result.current.alerts).toHaveLength(0);

      // Add critical alert (at threshold)
      act(() => {
        result.current.addAlert({
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          type: 'endpoint.error',
          severity: 'critical',
          title: 'Critical Alert',
          message: 'Should pass',
          metadata: {},
        });
      });

      expect(result.current.alerts).toHaveLength(1);
    });

    it('should respect alert_types when adding alerts', () => {
      const { result } = renderHook(() => useAlertStore());

      // Only enable quota.exceeded (limit-exceeded semantic)
      act(() => {
        result.current.updatePreferences({
          alert_types: ['quota.exceeded'],
        });
      });

      // Add endpoint.error alert (not in enabled types)
      act(() => {
        result.current.addAlert({
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          type: 'endpoint.error',
          severity: 'error',
          title: 'Endpoint Alert',
          message: 'Should be filtered',
          metadata: {},
        });
      });

      expect(result.current.alerts).toHaveLength(0);

      // Add quota.exceeded alert (in enabled types, limit semantic)
      act(() => {
        result.current.addAlert({
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          type: 'quota.exceeded',
          severity: 'error',
          title: 'Limit Alert',
          message: 'Should pass',
          metadata: {},
        });
      });

      expect(result.current.alerts).toHaveLength(1);
    });
  });
});
