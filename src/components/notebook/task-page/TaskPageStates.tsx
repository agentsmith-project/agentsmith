'use client';

import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TaskPageLoadingStateProps {
  text: string;
}

export function TaskPageLoadingState({ text }: TaskPageLoadingStateProps) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="surface-elevated flex w-full max-w-lg flex-col items-center gap-4 rounded-lg border border-border/70 px-6 py-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-md border border-subtle bg-accent/10 text-accent">
          <LoaderCircle className="h-5 w-5 animate-spin" />
        </div>
        <div className="space-y-2">
          <h2 className="type-section-heading text-foreground">{text}</h2>
        </div>
      </div>
    </div>
  );
}

interface TaskPageRecoveryAction {
  label: string;
  onClick: () => void;
  testId: string;
  variant?: 'primary' | 'outline';
}

interface TaskPageNotFoundStateProps {
  backLabel: string;
  description: string;
  title: string;
  onBack: () => void;
  actions?: TaskPageRecoveryAction[];
}

export function TaskPageNotFoundState({
  backLabel,
  description,
  title,
  onBack,
  actions = [],
}: TaskPageNotFoundStateProps) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="surface-elevated flex w-full max-w-lg flex-col gap-5 rounded-lg border border-border/70 px-6 py-8 text-center">
        <div className="space-y-3">
          <h2 className="type-section-heading text-foreground">{title}</h2>
          <p className="type-body-ui text-secondary">{description}</p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Button type="button" variant="primary" onClick={onBack} data-testid="notebook-task__open-list">
            {backLabel}
          </Button>
          {actions.map((action) => (
            <Button
              key={action.testId}
              type="button"
              variant={action.variant ?? 'outline'}
              onClick={action.onClick}
              data-testid={action.testId}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
