/**
 * Members Page Context
 *
 * Shared context for MembersPage compound components.
 */

'use client';

import * as React from 'react';
import type { UseMembersListReturn } from '@/lib/hooks/use-members-list';

export type MembersContextValue = UseMembersListReturn;

const MembersContext = React.createContext<MembersContextValue | null>(null);

export interface MembersProviderProps {
  children: React.ReactNode;
  value: MembersContextValue;
}

export function MembersProvider({ children, value }: MembersProviderProps) {
  return (
    <MembersContext.Provider value={value}>
      {children}
    </MembersContext.Provider>
  );
}

export function useMembersContext() {
  const context = React.useContext(MembersContext);
  if (!context) {
    throw new Error('useMembersContext must be used within MembersProvider');
  }
  return context;
}
