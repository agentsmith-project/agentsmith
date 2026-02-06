import React from 'react';

type PageStateProps = {
  state: 'loading' | 'empty' | 'error' | 'success';
  children?: React.ReactNode;
};

export function PageState({ state, children }: PageStateProps) {
  return (
    <div data-testid={`page-state__${state}`} className="h-full">
      {children}
    </div>
  );
}
