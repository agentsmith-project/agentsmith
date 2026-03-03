'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, RotateCw } from 'lucide-react';
import type { QuotaOverride } from '@/lib/api/types';

export interface QuotaOverridesEditorProps {
  defaultQuotas: QuotaOverride;
  initialOverrides?: QuotaOverride;
  onSave: (overrides: QuotaOverride) => void;
  onCancel: () => void;
  embedded?: boolean;
  onOverridesChange?: (overrides: QuotaOverride) => void;
}

type QuotaPath =
  | ['endpoint', 'daily_token_limit'];

interface QuotaFieldDefinition {
  id: string;
  section: 'endpoint';
  path: QuotaPath;
  labelKey: string;
  format?: (value: number) => string;
  unitKey?: string;
}

interface QuotaFieldViewModel extends QuotaFieldDefinition {
  value?: number;
  defaultValue?: number;
}

const QUOTA_FIELD_DEFINITIONS: QuotaFieldDefinition[] = [
  {
    id: 'endpoint.daily_token_limit',
    section: 'endpoint',
    path: ['endpoint', 'daily_token_limit'],
    labelKey: 'fields.endpoint_daily_token_limit',
    unitKey: 'units.tokens_per_day',
  },
];

const QUOTA_SECTIONS: Array<{
  id: 'endpoint';
  titleKey: string;
  descriptionKey: string;
}> = [
  {
    id: 'endpoint',
    titleKey: 'sections.endpoint_title',
    descriptionKey: 'sections.endpoint_description',
  },
];

function getValueAtPath(data: QuotaOverride, [scope, key]: QuotaPath): number | undefined {
  if (scope === 'endpoint' && key === 'daily_token_limit') {
    return data.endpoint?.daily_token_limit;
  }
  return undefined;
}

function setValueAtPath(
  previous: QuotaOverride,
  [scope, key]: QuotaPath,
  value: number | undefined
): QuotaOverride {
  const next: QuotaOverride = { ...previous };
  if (scope === 'endpoint') {
    const scoped = { ...(next.endpoint ?? {}) };
    if (key === 'daily_token_limit') {
      if (value === undefined) {
        delete scoped.daily_token_limit;
      } else {
        scoped.daily_token_limit = value;
      }
    }
    if (Object.keys(scoped).length === 0) {
      delete next.endpoint;
    } else {
      next.endpoint = scoped;
    }
    return next;
  }
  return next;
}

export function QuotaOverridesEditor({
  defaultQuotas,
  initialOverrides,
  onSave,
  onCancel,
  embedded,
  onOverridesChange,
}: QuotaOverridesEditorProps) {
  const t = useTranslations('members.quota');
  const [overrides, setOverrides] = React.useState<QuotaOverride>(initialOverrides ?? {});
  const [hasChanges, setHasChanges] = React.useState(false);

  const initialOverridesJson = JSON.stringify(initialOverrides ?? {});
  React.useEffect(() => {
    setOverrides(initialOverrides ?? {});
    setHasChanges(false);
  }, [initialOverridesJson]); // eslint-disable-line react-hooks/exhaustive-deps

  const onOverridesChangeRef = React.useRef(onOverridesChange);
  onOverridesChangeRef.current = onOverridesChange;
  React.useEffect(() => {
    onOverridesChangeRef.current?.(overrides);
  }, [overrides]);

  React.useEffect(() => {
    setHasChanges(JSON.stringify(overrides) !== initialOverridesJson);
  }, [overrides, initialOverridesJson]);

  const handleOverrideChange = React.useCallback((path: QuotaPath, value: number | undefined) => {
    setOverrides((prev) => setValueAtPath(prev, path, value));
  }, []);

  const handleResetAll = React.useCallback(() => {
    setOverrides({});
  }, []);

  const handleSave = React.useCallback(() => {
    onSave(overrides);
  }, [overrides, onSave]);

  const quotaFields = React.useMemo<QuotaFieldViewModel[]>(() => {
    return QUOTA_FIELD_DEFINITIONS.map((definition) => ({
      ...definition,
      defaultValue: getValueAtPath(defaultQuotas, definition.path),
      value: getValueAtPath(overrides, definition.path),
    }));
  }, [defaultQuotas, overrides]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-tertiary">{t('description')}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleResetAll}
          className="gap-2"
          disabled={!hasChanges}
        >
          <RotateCw className="h-4 w-4" />
          {t('reset_all')}
        </Button>
      </div>

      <div className="space-y-6">
        {QUOTA_SECTIONS.map((section) => {
          const sectionFields = quotaFields.filter((field) => field.section === section.id);
          const visibleFields = sectionFields.filter(
            (field) => field.defaultValue !== undefined || field.value !== undefined
          );
          if (visibleFields.length === 0) return null;
          return (
            <div key={section.id} className="border border-border rounded-md p-4 space-y-4">
              <div className="space-y-1">
                <h4 className="text-sm font-medium text-foreground">{t(section.titleKey)}</h4>
                <p className="text-xs text-tertiary">{t(section.descriptionKey)}</p>
              </div>
              <div className="space-y-3">
                {visibleFields.map((field) => (
                  <QuotaFieldRow
                    key={field.id}
                    field={field}
                    label={t(field.labelKey)}
                    unit={field.unitKey ? t(field.unitKey) : undefined}
                    onUseDefault={() => handleOverrideChange(field.path, undefined)}
                    onOverride={(value) => handleOverrideChange(field.path, value)}
                    useDefaultLabel={t('use_default')}
                    overrideLabel={t('override')}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {!embedded ? (
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
          <Button variant="ghost" onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={!hasChanges}>
            {t('save_changes')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

interface QuotaFieldRowProps {
  field: QuotaFieldViewModel;
  label: string;
  unit?: string;
  onUseDefault: () => void;
  onOverride: (value: number) => void;
  useDefaultLabel: string;
  overrideLabel: string;
}

function QuotaFieldRow({
  field,
  label,
  unit,
  onUseDefault,
  onOverride,
  useDefaultLabel,
  overrideLabel,
}: QuotaFieldRowProps) {
  const [overrideValue, setOverrideValue] = React.useState<string>(field.value?.toString() ?? '');
  const isOverridden = field.value !== undefined;

  React.useEffect(() => {
    setOverrideValue(field.value?.toString() ?? '');
  }, [field.value]);

  const displayValue = field.value ?? field.defaultValue;
  const displayText = displayValue === undefined
    ? '--'
    : field.format
      ? field.format(displayValue)
      : `${displayValue.toLocaleString()}${unit ? ` ${unit}` : ''}`;

  const handleInputChange = (raw: string) => {
    setOverrideValue(raw);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    onOverride(Math.floor(parsed));
  };

  const handleUseDefault = () => {
    setOverrideValue('');
    onUseDefault();
  };

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1">
        <label className="text-sm text-foreground">{label}</label>
        <div className="mt-1">
          {isOverridden ? (
            <Badge variant="default" className="text-xs">
              Override: {displayText}
            </Badge>
          ) : (
            <span className="text-xs text-tertiary">Default: {displayText}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {isOverridden ? (
          <>
            <Input
              type="number"
              value={overrideValue}
              onChange={(event) => handleInputChange(event.target.value)}
              className="w-36"
              min={1}
            />
            <Button variant="outline" size="sm" onClick={handleUseDefault} className="gap-1">
              <Check className="h-3 w-3" />
              {useDefaultLabel}
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const fallbackValue = field.defaultValue ?? 1;
              setOverrideValue(String(fallbackValue));
              onOverride(fallbackValue);
            }}
          >
            {overrideLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
