'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { RotateCw, Check } from 'lucide-react';
import { formatBytes } from '@/lib/utils/formatters';
import type { QuotaOverride } from '@/lib/api/types';

export interface QuotaOverridesEditorProps {
  defaultQuotas: QuotaOverride;
  initialOverrides?: QuotaOverride;
  onSave: (overrides: QuotaOverride) => void;
  onCancel: () => void;
  /** When true, hide footer buttons; use with onOverridesChange for embedded forms */
  embedded?: boolean;
  /** Called when overrides change (for embedded use in parent forms) */
  onOverridesChange?: (overrides: QuotaOverride) => void;
}

interface QuotaField {
  key: string;
  label: string;
  value?: number;
  defaultValue?: number;
  unit?: string;
  format?: (value: number) => string;
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
  const [overrides, setOverrides] = React.useState<QuotaOverride>(initialOverrides || {});
  const [hasChanges, setHasChanges] = React.useState(false);

  React.useEffect(() => {
    onOverridesChange?.(overrides);
  }, [overrides, onOverridesChange]);

  // Calculate changes
  React.useEffect(() => {
    const hasAnyChanges = JSON.stringify(overrides) !== JSON.stringify(initialOverrides || {});
    setHasChanges(hasAnyChanges);
  }, [overrides, initialOverrides]);

  const handleOverrideChange = React.useCallback((
    path: string[],
    value: number | undefined
  ) => {
    setOverrides((prev) => {
      const next = { ...prev };
      let current: Record<string, unknown> = next;
      
      for (let i = 0; i < path.length - 1; i++) {
        if (!current[path[i]]) {
          current[path[i]] = {};
        }
        current = current[path[i]] as Record<string, unknown>;
      }
      
      if (value === undefined) {
        delete current[path[path.length - 1]];
      } else {
        current[path[path.length - 1]] = value;
      }
      
      return next;
    });
  }, []);

  const handleResetAll = React.useCallback(() => {
    setOverrides({});
  }, []);

  const handleSave = React.useCallback(() => {
    onSave(overrides);
  }, [overrides, onSave]);

  // Build quota fields from structure
  const quotaFields: QuotaField[] = React.useMemo(() => {
    const fields: QuotaField[] = [];
    
    // UserData Storage
    if (defaultQuotas.userdata?.storage) {
      const storage = defaultQuotas.userdata.storage;
      if (storage.bytes_per_end_user !== undefined) {
        fields.push({
          key: 'userdata.storage.bytes_per_end_user',
          label: 'Bytes per end user',
          value: overrides.userdata?.storage?.bytes_per_end_user,
          defaultValue: storage.bytes_per_end_user,
          format: formatBytes,
        });
      }
      if (storage.objects_per_end_user !== undefined) {
        fields.push({
          key: 'userdata.storage.objects_per_end_user',
          label: 'Objects per end user',
          value: overrides.userdata?.storage?.objects_per_end_user,
          defaultValue: storage.objects_per_end_user,
        });
      }
      // max_object_bytes excluded from member override whitelist
    }

    // UserData DocDB
    if (defaultQuotas.userdata?.docdb) {
      const docdb = defaultQuotas.userdata.docdb;
      if (docdb.max_collections_per_scope !== undefined) {
        fields.push({
          key: 'userdata.docdb.max_collections_per_scope',
          label: 'Max collections per scope',
          value: overrides.userdata?.docdb?.max_collections_per_scope,
          defaultValue: docdb.max_collections_per_scope,
        });
      }
      if (docdb.max_document_bytes !== undefined) {
        fields.push({
          key: 'userdata.docdb.max_document_bytes',
          label: 'Max document bytes',
          value: overrides.userdata?.docdb?.max_document_bytes,
          defaultValue: docdb.max_document_bytes,
          format: formatBytes,
        });
      }
      if (docdb.query_timeout_ms !== undefined) {
        fields.push({
          key: 'userdata.docdb.query_timeout_ms',
          label: 'Query timeout (ms)',
          value: overrides.userdata?.docdb?.query_timeout_ms,
          defaultValue: docdb.query_timeout_ms,
          unit: 'ms',
        });
      }
      if (docdb.page_size_max !== undefined) {
        fields.push({
          key: 'userdata.docdb.page_size_max',
          label: 'Page size max',
          value: overrides.userdata?.docdb?.page_size_max,
          defaultValue: docdb.page_size_max,
        });
      }
    }

    // UserData VectorDB
    if (defaultQuotas.userdata?.vectordb) {
      const vectordb = defaultQuotas.userdata.vectordb;
      if (vectordb.max_indexes_per_scope !== undefined) {
        fields.push({
          key: 'userdata.vectordb.max_indexes_per_scope',
          label: 'Max indexes per scope',
          value: overrides.userdata?.vectordb?.max_indexes_per_scope,
          defaultValue: vectordb.max_indexes_per_scope,
        });
      }
      if (vectordb.top_k_max !== undefined) {
        fields.push({
          key: 'userdata.vectordb.top_k_max',
          label: 'Top K max',
          value: overrides.userdata?.vectordb?.top_k_max,
          defaultValue: vectordb.top_k_max,
        });
      }
      if (vectordb.upsert_records_max !== undefined) {
        fields.push({
          key: 'userdata.vectordb.upsert_records_max',
          label: 'Upsert records max',
          value: overrides.userdata?.vectordb?.upsert_records_max,
          defaultValue: vectordb.upsert_records_max,
        });
      }
    }

    // Endpoints
    if (defaultQuotas.endpoint) {
      if (defaultQuotas.endpoint.requests_per_day_per_end_user !== undefined) {
        fields.push({
          key: 'endpoint.requests_per_day_per_end_user',
          label: 'Requests per day per end user',
          value: overrides.endpoint?.requests_per_day_per_end_user,
          defaultValue: defaultQuotas.endpoint.requests_per_day_per_end_user,
        });
      }
      if (defaultQuotas.endpoint.requests_per_min_per_end_user !== undefined) {
        fields.push({
          key: 'endpoint.requests_per_min_per_end_user',
          label: 'Requests per min per end user',
          value: overrides.endpoint?.requests_per_min_per_end_user,
          defaultValue: defaultQuotas.endpoint.requests_per_min_per_end_user,
        });
      }
    }

    return fields;
  }, [defaultQuotas, overrides]);

  const isOverridden = React.useCallback((field: QuotaField) => {
    return field.value !== undefined;
  }, []);

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
        {/* UserData Storage */}
        {quotaFields.filter(f => f.key.startsWith('userdata.storage')).length > 0 && (
          <div className="border border-border rounded-md p-4 space-y-4">
            <h4 className="text-sm font-medium text-foreground">UserData Storage</h4>
            <div className="space-y-3">
              {quotaFields
                .filter(f => f.key.startsWith('userdata.storage'))
                .map((field) => (
                  <QuotaFieldRow
                    key={field.key}
                    field={field}
                    isOverridden={isOverridden(field)}
                    onUseDefault={() => handleOverrideChange(field.key.split('.'), undefined)}
                    onOverride={(value) => handleOverrideChange(field.key.split('.'), value)}
                  />
                ))}
            </div>
          </div>
        )}

        {/* UserData DocDB */}
        {quotaFields.filter(f => f.key.startsWith('userdata.docdb')).length > 0 && (
          <div className="border border-border rounded-md p-4 space-y-4">
            <h4 className="text-sm font-medium text-foreground">UserData DocDB</h4>
            <div className="space-y-3">
              {quotaFields
                .filter(f => f.key.startsWith('userdata.docdb'))
                .map((field) => (
                  <QuotaFieldRow
                    key={field.key}
                    field={field}
                    isOverridden={isOverridden(field)}
                    onUseDefault={() => handleOverrideChange(field.key.split('.'), undefined)}
                    onOverride={(value) => handleOverrideChange(field.key.split('.'), value)}
                  />
                ))}
            </div>
          </div>
        )}

        {/* UserData VectorDB */}
        {quotaFields.filter(f => f.key.startsWith('userdata.vectordb')).length > 0 && (
          <div className="border border-border rounded-md p-4 space-y-4">
            <h4 className="text-sm font-medium text-foreground">UserData VectorDB</h4>
            <div className="space-y-3">
              {quotaFields
                .filter(f => f.key.startsWith('userdata.vectordb'))
                .map((field) => (
                  <QuotaFieldRow
                    key={field.key}
                    field={field}
                    isOverridden={isOverridden(field)}
                    onUseDefault={() => handleOverrideChange(field.key.split('.'), undefined)}
                    onOverride={(value) => handleOverrideChange(field.key.split('.'), value)}
                  />
                ))}
            </div>
          </div>
        )}

        {/* Endpoints */}
        {quotaFields.filter(f => f.key.startsWith('endpoint')).length > 0 && (
          <div className="border border-border rounded-md p-4 space-y-4">
            <h4 className="text-sm font-medium text-foreground">Endpoint</h4>
            <div className="space-y-3">
              {quotaFields
                .filter(f => f.key.startsWith('endpoint'))
                .map((field) => (
                  <QuotaFieldRow
                    key={field.key}
                    field={field}
                    isOverridden={isOverridden(field)}
                    onUseDefault={() => handleOverrideChange(field.key.split('.'), undefined)}
                    onOverride={(value) => handleOverrideChange(field.key.split('.'), value)}
                  />
                ))}
            </div>
          </div>
        )}
      </div>

      {!embedded && (
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
          <Button variant="ghost" onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={!hasChanges}
          >
            {t('save_changes')}
          </Button>
        </div>
      )}
    </div>
  );
}

interface QuotaFieldRowProps {
  field: QuotaField;
  isOverridden: boolean;
  onUseDefault: () => void;
  onOverride: (value: number) => void;
}

function QuotaFieldRow({
  field,
  isOverridden,
  onUseDefault,
  onOverride,
}: QuotaFieldRowProps) {
  const t = useTranslations('members.quota');
  const [overrideValue, setOverrideValue] = React.useState<string>(
    field.value?.toString() || ''
  );

  React.useEffect(() => {
    if (field.value !== undefined) {
      setOverrideValue(field.value.toString());
    } else {
      setOverrideValue('');
    }
  }, [field.value]);

  const displayValue = field.value !== undefined ? field.value : field.defaultValue;
  const displayText = field.format
    ? field.format(displayValue || 0)
    : `${displayValue?.toLocaleString()}${field.unit ? ` ${field.unit}` : ''}`;

  const handleOverrideChange = (value: string) => {
    setOverrideValue(value);
    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue > 0) {
      onOverride(numValue);
    }
  };

  const handleUseDefault = () => {
    setOverrideValue('');
    onUseDefault();
  };

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1">
        <label className="text-sm text-foreground">{field.label}</label>
        <div className="flex items-center gap-2 mt-1">
          {isOverridden ? (
            <Badge variant="default" className="text-xs">
              Override: {field.format ? formatBytes(field.value || 0) : `${field.value?.toLocaleString()}${field.unit ? ` ${field.unit}` : ''}`}
            </Badge>
          ) : (
            <span className="text-xs text-tertiary">
              Default: {displayText}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {isOverridden ? (
          <>
            <Input
              type="number"
              value={overrideValue}
              onChange={(e) => handleOverrideChange(e.target.value)}
              className="w-32"
              min={1}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleUseDefault}
              className="gap-1"
            >
              <Check className="h-3 w-3" />
              {t('use_default')}
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setOverrideValue(field.defaultValue?.toString() || '');
              onOverride(field.defaultValue || 0);
            }}
          >
            {t('override')}
          </Button>
        )}
      </div>
    </div>
  );
}
