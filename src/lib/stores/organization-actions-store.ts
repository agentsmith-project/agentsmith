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

export interface OrganizationActionServerRecord {
  action_id: string;
  status: OrganizationActionStatus;
  updated_at: string;
  history: Array<{
    id: string;
    action_id: string;
    status: OrganizationActionStatus;
    actor_user_id: string;
    actor_name: string;
    note?: string;
    at: string;
  }>;
}

interface OrganizationActionsState {
  records: Record<string, OrganizationActionRecord>;
  hydrateQueue: (actionIds: string[]) => void;
  hydrateFromServer: (records: OrganizationActionServerRecord[]) => void;
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
          let changed = false;
          for (const actionId of actionIds) {
            if (!next[actionId]) {
              next[actionId] = createInitialRecord();
              changed = true;
            }
          }
          if (!changed) {
            return state;
          }
          return { records: next };
        });
      },
      hydrateFromServer: (records) => {
        if (records.length === 0) {
          return;
        }
        set((state) => {
          const next = { ...state.records };
          for (const record of records) {
            next[record.action_id] = {
              status: record.status,
              updatedAt: record.updated_at,
              history: record.history.map((event) => ({
                id: event.id,
                actionId: event.action_id,
                status: event.status,
                actorId: event.actor_user_id,
                actorName: event.actor_name,
                note: event.note,
                at: event.at,
              })),
            };
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
