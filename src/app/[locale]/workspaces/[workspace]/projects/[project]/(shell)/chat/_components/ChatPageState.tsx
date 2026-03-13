'use client';

import type { ReactNode } from 'react';

import { PageState } from '@/components/layout/PageState';

interface ChatPageStateProps {
  state: 'loading' | 'error';
  children: ReactNode;
}

export function ChatPageState({ state, children }: ChatPageStateProps) {
  return <PageState state={state}>{children}</PageState>;
}

export function ChatPageLoadingState({ message: _message }: { message: string }) {
  return (
    <ChatPageState state="loading">
      <div className="flex h-full items-center justify-center">
        <div className="text-tertiary">{_message}</div>
      </div>
    </ChatPageState>
  );
}

export function ChatPageValidationErrorState(args: {
  title: string;
  description: string;
}) {
  const { title, description } = args;

  return (
    <ChatPageState state="error">
      <div className="max-w-md space-y-2 text-center">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-tertiary">{description}</p>
      </div>
    </ChatPageState>
  );
}

export function ChatPagePermissionErrorState(args: {
  title: string;
  description: string;
}) {
  const { title, description } = args;

  return (
    <ChatPageState state="error">
      <div className="max-w-md space-y-2 text-center">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-tertiary">{description}</p>
      </div>
    </ChatPageState>
  );
}
