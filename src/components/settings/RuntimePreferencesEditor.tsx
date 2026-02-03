'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export interface RuntimePreferences {
  locale?: { language?: string; timezone?: string };
  ai_behavior?: { tone?: string; verbosity?: string };
  shared_context?: {
    organization_name?: string;
    ai_identity?: string;
    custom_prompts?: Record<string, string>;
  };
  extensions?: Record<string, unknown>;
}

const LANGUAGES = ['zh-CN', 'en-US', 'ja-JP', 'ko-KR'];
const TIMEZONES = ['Asia/Shanghai', 'UTC', 'America/New_York', 'Europe/London'];
const TONES = ['professional', 'casual', 'friendly', 'formal', 'technical'];
const VERBOSITIES = ['concise', 'balanced', 'detailed'];

export interface RuntimePreferencesEditorProps {
  value: RuntimePreferences;
  onChange: (value: RuntimePreferences) => void;
  disabled?: boolean;
}

export function RuntimePreferencesEditor({
  value,
  onChange,
  disabled,
}: RuntimePreferencesEditorProps) {
  const [viewMode, setViewMode] = React.useState<'form' | 'json'>('form');
  const [jsonText, setJsonText] = React.useState('');
  const [jsonError, setJsonError] = React.useState<string | null>(null);

  const syncToJson = React.useCallback(() => {
    setJsonText(JSON.stringify(value || {}, null, 2));
    setJsonError(null);
  }, [value]);

  React.useEffect(() => {
    if (viewMode === 'json') syncToJson();
  }, [viewMode, syncToJson]);

  const handleFormChange = (path: string[], newVal: unknown) => {
    const next = JSON.parse(JSON.stringify(value || {}));
    let cur: Record<string, unknown> = next;
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i];
      if (!(k in cur) || typeof cur[k] !== 'object') cur[k] = {};
      cur = cur[k] as Record<string, unknown>;
    }
    cur[path[path.length - 1]] = newVal;
    onChange(next as RuntimePreferences);
  };

  const handleJsonApply = () => {
    try {
      const parsed = JSON.parse(jsonText) as RuntimePreferences;
      onChange(parsed);
      setJsonError(null);
      setViewMode('form');
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  };

  const locale = value?.locale ?? {};
  const aiBehavior = value?.ai_behavior ?? {};
  const sharedContext = value?.shared_context ?? {};

  if (viewMode === 'json') {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setViewMode('form')}>
              Form
            </Button>
            <Button variant="default" size="sm" onClick={handleJsonApply} disabled={!!jsonError}>
              Apply JSON
            </Button>
          </div>
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
          rows={16}
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

      <div className="space-y-4">
        <h3 className="text-sm font-medium text-primary">Locale</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label title="locale.language">Language</Label>
            <Select
              value={locale.language ?? 'en-US'}
              onValueChange={(v) => handleFormChange(['locale', 'language'], v)}
              disabled={disabled}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label title="locale.timezone">Timezone</Label>
            <Select
              value={locale.timezone ?? 'UTC'}
              onValueChange={(v) => handleFormChange(['locale', 'timezone'], v)}
              disabled={disabled}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-medium text-primary">AI Behavior</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label title="ai_behavior.tone">Tone</Label>
            <Select
              value={aiBehavior.tone ?? 'professional'}
              onValueChange={(v) => handleFormChange(['ai_behavior', 'tone'], v)}
              disabled={disabled}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TONES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label title="ai_behavior.verbosity">Verbosity</Label>
            <Select
              value={aiBehavior.verbosity ?? 'balanced'}
              onValueChange={(v) => handleFormChange(['ai_behavior', 'verbosity'], v)}
              disabled={disabled}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VERBOSITIES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-medium text-primary">Shared Context</h3>
        <div className="space-y-4">
          <div>
            <Label title="shared_context.organization_name">Organization Name</Label>
            <Input
              value={sharedContext.organization_name ?? ''}
              onChange={(e) =>
                handleFormChange(['shared_context', 'organization_name'], e.target.value)
              }
              placeholder="Acme Corp"
              disabled={disabled}
            />
          </div>
          <div>
            <Label title="shared_context.ai_identity">AI Identity</Label>
            <Textarea
              value={sharedContext.ai_identity ?? ''}
              onChange={(e) =>
                handleFormChange(['shared_context', 'ai_identity'], e.target.value)
              }
              placeholder="You are a helpful assistant..."
              rows={3}
              disabled={disabled}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
