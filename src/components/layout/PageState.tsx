import React from 'react';

type PageStateProps = {
  state: 'loading' | 'empty' | 'error' | 'success';
};

export function PageState({ state }: PageStateProps) {
  return <div data-testid={`page-state__${state}`} />;
}
