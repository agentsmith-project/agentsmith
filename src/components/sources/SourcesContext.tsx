/**
 * Sources Page Context
 *
 * Shared context for SourcesPage compound components.
 */

'use client';

import * as React from 'react';
import type { UseSourcesListReturn } from '@/lib/hooks/use-sources-list';

export type SourcesContextValue = UseSourcesListReturn;

const SourcesContext = React.createContext<SourcesContextValue | null>(null);

export interface SourcesProviderProps {
  children: React.ReactNode;
  value: SourcesContextValue;
}

export function SourcesProvider({ children, value }: SourcesProviderProps) {
  return (
    <SourcesContext.Provider value={value}>
      {children}
    </SourcesContext.Provider>
  );
}

export function useSourcesContext() {
  const context = React.useContext(SourcesContext);
  if (!context) {
    throw new Error('useSourcesContext must be used within SourcesProvider');
  }
  return context;
}
