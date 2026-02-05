import React from 'react';

type RealtimeProviderProps = {
  mode?: 'real' | 'mock' | 'disabled';
  children: React.ReactNode;
};

export function RealtimeProvider({ children }: RealtimeProviderProps) {
  return <>{children}</>;
}
