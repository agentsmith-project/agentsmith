'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';

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
  const t = useTranslations('settings');
  const [viewMode, setViewMode] = React.useState<'form' | 'json'>('form');
  const [jsonText, setJsonText] = React.useState('');
  const [jsonError, setJsonError] = React.useState<string | null>(null);

  const setPathValue = React.useCallback(
    (path: string[], nextValue: unknown) => {
      const next = { ...(value ?? {}) } as Record<string, unknown>;
      let cursor: Record<string, unknown> = next;
      for (let i = 0; i < path.length - 1; i += 1) {
        const key = path[i];
        const prev = cursor[key];
        cursor[key] = typeof prev === 'object' && prev !== null ? { ...(prev as object) } : {};
        cursor = cursor[key] as Record<string, unknown>;
      }
      cursor[path[path.length - 1]] = nextValue;
      onChange(next);
    },
    [onChange, value]
  );

  const getPathValue = React.useCallback(
    (path: string[], fallback: unknown) => {
      let cursor: unknown = value;
      for (const key of path) {
        if (!cursor || typeof cursor !== 'object') return fallback;
        cursor = (cursor as Record<string, unknown>)[key];
      }
      return cursor ?? fallback;
    },
    [value]
  );

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

  if (viewMode === 'form') {
    const contentFilterEnabled = Boolean(getPathValue(['content_filter', 'enabled'], false));
    const piiDetectionEnabled = Boolean(getPathValue(['pii_detection', 'enabled'], false));
    const maxRpm = getPathValue(['rate_limit', 'max_requests_per_minute'], '') as number | string;
    const maxTokens = getPathValue(['model', 'max_tokens_per_request'], '') as number | string;

    return (
      <div className="space-y-6">
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setViewMode('json')}>
            JSON
          </Button>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-medium text-foreground">{t('governance_form.guardrails')}</h3>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={contentFilterEnabled}
              onChange={(e) => setPathValue(['content_filter', 'enabled'], e.target.checked)}
              disabled={disabled}
            />
            {t('governance_form.content_filter')}
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={piiDetectionEnabled}
              onChange={(e) => setPathValue(['pii_detection', 'enabled'], e.target.checked)}
              disabled={disabled}
            />
            {t('governance_form.pii_detection')}
          </label>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-medium text-foreground">{t('governance_form.rate_limit')}</h3>
          <div className="space-y-2">
            <label htmlFor="governance-max-rpm" className="text-sm text-foreground">
              {t('governance_form.max_rpm')}
            </label>
            <Input
              id="governance-max-rpm"
              value={maxRpm}
              onChange={(e) =>
                setPathValue(
                  ['rate_limit', 'max_requests_per_minute'],
                  e.target.value ? parseInt(e.target.value, 10) : undefined
                )
              }
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="governance-max-tokens" className="text-sm text-foreground">
              {t('governance_form.max_tokens_per_request')}
            </label>
            <Input
              id="governance-max-tokens"
              value={maxTokens}
              onChange={(e) =>
                setPathValue(
                  ['model', 'max_tokens_per_request'],
                  e.target.value ? parseInt(e.target.value, 10) : undefined
                )
              }
              disabled={disabled}
            />
          </div>
        </div>
      </div>
    );
  }

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
