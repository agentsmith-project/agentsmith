'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type OrganizationActionStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

export interface OrganizationActionAuditEvent {
  id: string;
  actionId: string;
  status: OrganizationActionStatus;
  actorId: string;
  actorName: string;
  note?: string;
  at: string;
}

export interface OrganizationActionRecord {
  status: OrganizationActionStatus;
  updatedAt: string;
  history: OrganizationActionAuditEvent[];
}

interface OrganizationActionsState {
  records: Record<string, OrganizationActionRecord>;
  hydrateQueue: (actionIds: string[]) => void;
  setActionStatus: (args: {
    actionId: string;
    status: OrganizationActionStatus;
    actorId: string;
    actorName: string;
    note?: string;
  }) => void;
  _resetForTests?: () => void;
}

function createInitialRecord(): OrganizationActionRecord {
  return {
    status: 'pending',
    updatedAt: new Date().toISOString(),
    history: [],
  };
}

export const useOrganizationActionsStore = create<OrganizationActionsState>()(
  persist(
    (set) => ({
      records: {},
      hydrateQueue: (actionIds) => {
        if (actionIds.length === 0) {
          return;
        }
        set((state) => {
          const next = { ...state.records };
          for (const actionId of actionIds) {
            if (!next[actionId]) {
              next[actionId] = createInitialRecord();
            }
          }
          return { records: next };
        });
      },
      setActionStatus: ({ actionId, status, actorId, actorName, note }) => {
        set((state) => {
          const current = state.records[actionId] ?? createInitialRecord();
          const event: OrganizationActionAuditEvent = {
            id: `org_action_audit_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
            actionId,
            status,
            actorId,
            actorName,
            note,
            at: new Date().toISOString(),
          };
          return {
            records: {
              ...state.records,
              [actionId]: {
                status,
                updatedAt: event.at,
                history: [...current.history, event].slice(-20),
              },
            },
          };
        });
      },
      _resetForTests: () => {
        set({ records: {} });
      },
    }),
    {
      name: 'agentsmith-org-actions',
      storage: createJSONStorage(() => {
        if (typeof window === 'undefined') {
          return {
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
          };
        }
        const storage = window.localStorage;
        if (
          !storage
          || typeof storage.getItem !== 'function'
          || typeof storage.setItem !== 'function'
          || typeof storage.removeItem !== 'function'
        ) {
          return {
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
          };
        }
        return storage;
      }),
      partialize: (state) => ({
        records: state.records,
      }),
    },
  ),
);
