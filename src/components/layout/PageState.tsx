import React from 'react';

type PageStateProps = {
  state: 'loading' | 'empty' | 'error' | 'success';
  children?: React.ReactNode;
  loading?: React.ReactNode;
  empty?: React.ReactNode;
  error?: React.ReactNode;
};

const centered = 'h-full flex items-center justify-center px-6 py-10';

export function PageState({ state, children, loading, empty, error }: PageStateProps) {
  if (state === 'success') {
    return (
      <div data-testid="page-state__success" className="h-full">
        {children}
      </div>
    );
  }

  const content =
    state === 'loading'
      ? loading ?? children
      : state === 'empty'
        ? empty ?? children
        : error ?? children;
  return (
    <div data-testid={`page-state__${state}`} className={centered}>
      {content}
    </div>
  );
}
