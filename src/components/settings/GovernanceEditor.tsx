'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export type GovernanceJson = Record<string, unknown>;

export interface GovernanceEditorProps {
  value: GovernanceJson;
  onChange: (value: GovernanceJson) => void;
  disabled?: boolean;
  onSaveConfirm?: () => void;
}

export function GovernanceEditor({
  value,
  onChange,
  disabled,
}: GovernanceEditorProps) {
  const [viewMode, setViewMode] = React.useState<'form' | 'json'>('json');
  const [jsonText, setJsonText] = React.useState('');
  const [jsonError, setJsonError] = React.useState<string | null>(null);

  const syncToJson = React.useCallback(() => {
    setJsonText(JSON.stringify(value || {}, null, 2));
    setJsonError(null);
  }, [value]);

  React.useEffect(() => {
    if (viewMode === 'json') syncToJson();
  }, [viewMode, syncToJson]);

  const handleJsonApply = () => {
    try {
      const parsed = JSON.parse(jsonText) as GovernanceJson;
      onChange(parsed);
      setJsonError(null);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  };

  if (viewMode === 'json') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-tertiary">
          Governance controls quotas, rate limits, and guardrails. Changes require confirmation.
        </p>
        <div className="flex justify-between items-center">
          <Button variant="ghost" size="sm" onClick={() => setViewMode('form')}>
            Form
          </Button>
          <Button variant="default" size="sm" onClick={handleJsonApply} disabled={!!jsonError}>
            Validate JSON
          </Button>
        </div>
        <Textarea
          value={jsonText}
          onChange={(e) => {
            setJsonText(e.target.value);
            try {
              JSON.parse(e.target.value);
              setJsonError(null);
            } catch {
              setJsonError('Invalid JSON');
            }
          }}
          rows={20}
          className="font-mono text-sm"
          disabled={disabled}
        />
        {jsonError && <p className="text-sm text-error">{jsonError}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => setViewMode('json')}>
          JSON
        </Button>
      </div>
      <p className="text-sm text-tertiary">
        Use the JSON view to edit governance. Form view coming soon.
      </p>
    </div>
  );
}
