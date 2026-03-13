'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';

import { ExecutionPreferencesEditor, type ExecutionPreferences } from '@/components/settings/ExecutionPreferencesEditor';

interface EditExecutionPreferencesSectionProps {
  executionPreferences: ExecutionPreferences;
  open: boolean;
  pending: boolean;
  onChange: (value: ExecutionPreferences) => void;
  onOpenChange: (open: boolean) => void;
}

export function EditExecutionPreferencesSection({
  executionPreferences,
  open,
  pending,
  onChange,
  onOpenChange,
}: EditExecutionPreferencesSectionProps) {
  return (
    <div className="border border-subtle rounded-sm">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-hover"
      >
        {open ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
        Execution Preferences
      </button>
      {open ? (
        <div className="p-4 border-t border-subtle">
          <ExecutionPreferencesEditor
            value={executionPreferences}
            onChange={onChange}
            disabled={pending}
          />
        </div>
      ) : null}
    </div>
  );
}
