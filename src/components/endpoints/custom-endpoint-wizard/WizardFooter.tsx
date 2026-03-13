'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { WizardStep, WizardTranslator } from './types';

export function WizardFooter(args: {
  t: WizardTranslator;
  step: WizardStep;
  canProceed: boolean;
  nextDisabledReason?: string;
  credentialsAvailable: boolean;
  isCreating: boolean;
  isValidating: boolean;
  onCancel: () => void;
  onBack: () => void;
  onNext: () => void;
  onCreate: () => void;
}) {
  const {
    t,
    step,
    canProceed,
    nextDisabledReason,
    credentialsAvailable,
    isCreating,
    isValidating,
    onCancel,
    onBack,
    onNext,
    onCreate,
  } = args;

  return (
    <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-subtle px-6 py-4">
      <div>
        {step < 3 && !canProceed && nextDisabledReason ? (
          <p className="text-xs text-error" data-testid="wizard-next-disabled-reason">
            {nextDisabledReason}
          </p>
        ) : null}
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={isCreating || isValidating}
        >
          {t('cancel_button')}
        </Button>
        {step > 1 && (
          <Button
            type="button"
            variant="ghost"
            onClick={onBack}
            disabled={isCreating || isValidating}
          >
            {t('back_button')}
          </Button>
        )}
        {step < 3 ? (
          <Button
            type="button"
            variant="primary"
            onClick={onNext}
            disabled={!canProceed || (step >= 2 && !credentialsAvailable)}
          >
            {t('next_button')}
          </Button>
        ) : (
          <Button
            type="button"
            variant="primary"
            onClick={onCreate}
            disabled={isCreating || !credentialsAvailable}
            data-testid="wizard-create-button"
          >
            {isCreating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              t('create_button')
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
