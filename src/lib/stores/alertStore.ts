/**
 * Alert Store (Zustand)
 *
 * Client-side alert storage with localStorage persistence.
 * Uses shared types from src/lib/types/alerts.ts
 *
 * @module lib/stores/alertStore
 */

'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { toast } from '@/components/ui/toast';
import type {
  Alert,
  AlertPreferences,
  AlertSeverity,
  InAppAlertType,
} from '@/lib/types/alerts';

// Default preferences aligned with Epic C2 design
const defaultPreferences: AlertPreferences = {
  in_app_enabled: true,
  severity_threshold: 'warning',
  alert_types: [
    'quota.exceeded',
    'quota.warning',
    'rate_limit.exceeded',
    'policy.allow_list.denied',
    'endpoint.error',
  ] as InAppAlertType[],
};

const ALERT_STORE_KEY = 'agentsmith-alert-storage';
const LEGACY_ALERT_STORE_KEY = 'agentmith-alert-storage';

interface AlertStore {
  // State
  alerts: Alert[];
  preferences: AlertPreferences;

  // Computed
  unreadCount: number;

  // Actions
  addAlert: (alert: Omit<Alert, 'id' | 'created_at' | 'status'>) => void;
  markAsRead: (alertId: string) => void;
  markMultipleAsRead: (alertIds: string[]) => void;
  markAllAsRead: () => void;
  dismissAlert: (alertId: string) => void;
  dismissMultiple: (alertIds: string[]) => void;
  clearDismissed: (beforeDate?: string) => void;
  updatePreferences: (prefs: Partial<AlertPreferences>) => void;

  // Storage
  _loadFromStorage: () => void;
  _saveToStorage: () => void;
}

export const useAlertStore = create<AlertStore>()(
  persist(
    (set, get) => ({
      // Initial state
      alerts: [],
      preferences: defaultPreferences,

      // Computed property (updated via setters)
      get unreadCount(): number {
        return get().alerts.filter((a) => a.status === 'unread').length;
      },

      // Add new alert
      addAlert: (alertData) => {
        const alert: Alert = {
          ...alertData,
          id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
          created_at: new Date().toISOString(),
          status: 'unread',
        };

        set((state) => {
          // Check alert type preferences
          if (!state.preferences.alert_types.includes(alert.type as InAppAlertType)) {
            return state;
          }

          // Check severity threshold
          const severityOrder: AlertSeverity[] = ['info', 'warning', 'error', 'critical'];
          const thresholdIndex = severityOrder.indexOf(state.preferences.severity_threshold);
          const alertIndex = severityOrder.indexOf(alert.severity);
          if (alertIndex < thresholdIndex) {
            return state;
          }

          const newAlerts = [alert, ...state.alerts];
          const unreadCount = newAlerts.filter((a) => a.status === 'unread').length;

          if (alert.severity === 'error' || alert.severity === 'critical') {
            toast.error(alert.title);
          }

          return {
            alerts: newAlerts,
            unreadCount,
          };
        });
      },

      // Mark single alert as read
      markAsRead: (alertId) => {
        set((state) => {
          const alerts = state.alerts.map((a) =>
            a.id === alertId && a.status === 'unread'
              ? { ...a, status: 'read' as const, read_at: new Date().toISOString() }
              : a
          );
          const unreadCount = alerts.filter((a) => a.status === 'unread').length;
          return { alerts, unreadCount };
        });
      },

      // Mark multiple alerts as read
      markMultipleAsRead: (alertIds) => {
        const now = new Date().toISOString();
        set((state) => {
          const alerts = state.alerts.map((a) =>
            alertIds.includes(a.id) && a.status === 'unread'
              ? { ...a, status: 'read' as const, read_at: now }
              : a
          );
          const unreadCount = alerts.filter((a) => a.status === 'unread').length;
          return { alerts, unreadCount };
        });
      },

      // Mark all as read
      markAllAsRead: () => {
        const now = new Date().toISOString();
        set((state) => {
          const alerts = state.alerts.map((a) => {
            if (a.status === 'unread') {
              return { ...a, status: 'read' as const, read_at: now };
            }
            return a;
          });
          return { alerts, unreadCount: 0 };
        });
      },

      // Dismiss single alert
      dismissAlert: (alertId) => {
        set((state) => {
          const alerts = state.alerts.map((a) =>
            a.id === alertId ? { ...a, status: 'dismissed' as const, dismissed_at: new Date().toISOString() } : a
          );
          const unreadCount = alerts.filter((a) => a.status === 'unread').length;
          return { alerts, unreadCount };
        });
      },

      // Dismiss multiple alerts
      dismissMultiple: (alertIds) => {
        const now = new Date().toISOString();
        set((state) => {
          const alerts = state.alerts.map((a) =>
            alertIds.includes(a.id)
              ? { ...a, status: 'dismissed' as const, dismissed_at: now }
              : a
          );
          const unreadCount = alerts.filter((a) => a.status === 'unread').length;
          return { alerts, unreadCount };
        });
      },

      // Clear dismissed alerts before a date
      clearDismissed: (beforeDate) => {
        const cutoff = beforeDate ? new Date(beforeDate).toISOString() : new Date().toISOString();
        set((state) => {
          const alerts = state.alerts.filter((a) => {
            if (a.status !== 'dismissed') return true;
            // Keep dismissed alerts if they're newer than cutoff
            return a.dismissed_at && a.dismissed_at > cutoff;
          });
          return { alerts, unreadCount: state.unreadCount };
        });
      },

      // Update preferences
      updatePreferences: (prefs) => {
        set((state) => ({
          preferences: { ...state.preferences, ...prefs },
        }));
      },

      // Storage sync (manual for debugging)
      _loadFromStorage: () => {
        // Handled by zustand persist middleware automatically
        const stored = localStorage.getItem(ALERT_STORE_KEY) ?? localStorage.getItem(LEGACY_ALERT_STORE_KEY);
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            set({ ...parsed.state });
          } catch (e) {
            console.error('Failed to load alert store:', e);
          }
        }
      },

      _saveToStorage: () => {
        // Handled by zustand persist middleware automatically
        // Explicit save for immediate persistence if needed
      },
    }),
    {
      name: ALERT_STORE_KEY,
      storage: createJSONStorage(() => ({
        getItem: (name) => localStorage.getItem(name) ?? localStorage.getItem(LEGACY_ALERT_STORE_KEY),
        setItem: (name, value) => localStorage.setItem(name, value),
        removeItem: (name) => {
          localStorage.removeItem(name);
          if (name === ALERT_STORE_KEY) {
            localStorage.removeItem(LEGACY_ALERT_STORE_KEY);
          }
        },
      })),
      partialize: (state) => ({
        alerts: state.alerts,
        preferences: state.preferences,
      }),
    }
  )
);
