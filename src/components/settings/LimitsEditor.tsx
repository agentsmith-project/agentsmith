'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useTranslations } from 'next-intl';

export interface LimitsJson {
  userdata?: {
    storage?: { max_total_bytes?: number };
    docdb?: { max_total_collections?: number };
    vectordb?: { max_total_indexes?: number };
  };
  endpoint?: {
    tokens_per_day?: number;
    tokens_per_min?: number;
    requests_per_day?: number;
    requests_per_min?: number;
    timeout_ms?: number;
    max_concurrent?: number;
  };
}

export interface LimitsEditorProps {
  value: LimitsJson;
  onChange: (value: LimitsJson) => void;
  disabled?: boolean;
}

function setNested(obj: Record<string, unknown>, path: string[], val: unknown): void {
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    if (!(k in cur) || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[path[path.length - 1]] = val;
}

export function LimitsEditor({ value, onChange, disabled }: LimitsEditorProps) {
  const settingsT = useTranslations('settings');
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

  const handleFormChange = (path: string[], newVal: number | '') => {
    const next = JSON.parse(JSON.stringify(value || {})) as Record<string, unknown>;
    const numVal = newVal === '' ? undefined : newVal;
    setNested(next, path, numVal);
    onChange(next as LimitsJson);
  };

  const handleJsonApply = () => {
    try {
      const parsed = JSON.parse(jsonText) as LimitsJson;
      onChange(parsed);
      setJsonError(null);
      setViewMode('form');
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  };

  const userdata = value?.userdata ?? {};
  const storage = userdata.storage ?? {};
  const docdb = userdata.docdb ?? {};
  const vectordb = userdata.vectordb ?? {};
  const endpoint = value?.endpoint ?? {};

  const num = (v: number | undefined): string => (v != null ? String(v) : '');
  const toNum = (s: string): number | '' => {
    const n = parseInt(s, 10);
    return s === '' ? '' : isNaN(n) ? '' : n;
  };

  if (viewMode === 'json') {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <Button variant="ghost" size="sm" onClick={() => setViewMode('form')}>
            Form
          </Button>
          <Button variant="default" size="sm" onClick={handleJsonApply} disabled={!!jsonError}>
            Apply JSON
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
        <h3 className="text-sm font-medium text-primary">{settingsT('limits_userdata_total')}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label title="userdata.storage.max_total_bytes">Max total storage (bytes)</Label>
            <Input
              type="number"
              min={0}
              value={num(storage.max_total_bytes)}
              onChange={(e) =>
                handleFormChange(['userdata', 'storage', 'max_total_bytes'], toNum(e.target.value))
              }
              placeholder="Unset = no limit"
              disabled={disabled}
            />
          </div>
          <div>
            <Label title="userdata.docdb.max_total_collections">Max total collections</Label>
            <Input
              type="number"
              min={0}
              value={num(docdb.max_total_collections)}
              onChange={(e) =>
                handleFormChange(['userdata', 'docdb', 'max_total_collections'], toNum(e.target.value))
              }
              placeholder="Unset = no limit"
              disabled={disabled}
            />
          </div>
          <div>
            <Label title="userdata.vectordb.max_total_indexes">Max total indexes</Label>
            <Input
              type="number"
              min={0}
              value={num(vectordb.max_total_indexes)}
              onChange={(e) =>
                handleFormChange(['userdata', 'vectordb', 'max_total_indexes'], toNum(e.target.value))
              }
              placeholder="Unset = no limit"
              disabled={disabled}
            />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-medium text-primary">{settingsT('limits_endpoint_default')}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label title="endpoint.tokens_per_day">Tokens per day</Label>
            <Input
              type="number"
              min={0}
              value={num(endpoint.tokens_per_day)}
              onChange={(e) => handleFormChange(['endpoint', 'tokens_per_day'], toNum(e.target.value))}
              placeholder="Unset = no limit"
              disabled={disabled}
            />
          </div>
          <div>
            <Label title="endpoint.tokens_per_min">Tokens per min</Label>
            <Input
              type="number"
              min={0}
              value={num(endpoint.tokens_per_min)}
              onChange={(e) => handleFormChange(['endpoint', 'tokens_per_min'], toNum(e.target.value))}
              placeholder="Unset = no limit"
              disabled={disabled}
            />
          </div>
          <div>
            <Label title="endpoint.requests_per_day">Requests per day</Label>
            <Input
              type="number"
              min={0}
              value={num(endpoint.requests_per_day)}
              onChange={(e) => handleFormChange(['endpoint', 'requests_per_day'], toNum(e.target.value))}
              placeholder="Unset = no limit"
              disabled={disabled}
            />
          </div>
          <div>
            <Label title="endpoint.requests_per_min">Requests per min</Label>
            <Input
              type="number"
              min={0}
              value={num(endpoint.requests_per_min)}
              onChange={(e) => handleFormChange(['endpoint', 'requests_per_min'], toNum(e.target.value))}
              placeholder="Unset = no limit"
              disabled={disabled}
            />
          </div>
          <div>
            <Label title="endpoint.timeout_ms">Timeout (ms)</Label>
            <Input
              type="number"
              min={0}
              value={num(endpoint.timeout_ms)}
              onChange={(e) => handleFormChange(['endpoint', 'timeout_ms'], toNum(e.target.value))}
              placeholder="60000"
              disabled={disabled}
            />
          </div>
          <div>
            <Label title="endpoint.max_concurrent">Max concurrent</Label>
            <Input
              type="number"
              min={0}
              value={num(endpoint.max_concurrent)}
              onChange={(e) => handleFormChange(['endpoint', 'max_concurrent'], toNum(e.target.value))}
              placeholder="Unset = no limit"
              disabled={disabled}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
