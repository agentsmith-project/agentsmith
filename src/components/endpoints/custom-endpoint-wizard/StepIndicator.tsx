'use client';

import * as React from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { WizardStep } from './types';

export function StepIndicator({ step }: { step: WizardStep }) {
  return (
    <div className="flex items-center justify-center gap-2">
      <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
        step >= 1 ? 'bg-accent text-white' : 'bg-surface-low text-tertiary'
      }`}>
        {step > 1 ? <CheckCircle2 className="h-4 w-4" /> : '1'}
      </div>
      <div className={`h-0.5 w-12 ${step >= 2 ? 'bg-accent' : 'bg-surface-low'}`} />
      <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
        step >= 2 ? 'bg-accent text-white' : 'bg-surface-low text-tertiary'
      }`}>
        {step > 2 ? <CheckCircle2 className="h-4 w-4" /> : '2'}
      </div>
      <div className={`h-0.5 w-12 ${step >= 3 ? 'bg-accent' : 'bg-surface-low'}`} />
      <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
        step >= 3 ? 'bg-accent text-white' : 'bg-surface-low text-tertiary'
      }`}>
        3
      </div>
    </div>
  );
}
