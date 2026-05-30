'use client';

import { Plus, Trash2 } from 'lucide-react';

import type { UserExternalConnectionFieldInput } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface ConnectionFormFieldsProps {
  createEmptyField: () => UserExternalConnectionFieldInput;
  customDomain: string;
  displayName: string;
  editing: boolean;
  fields: UserExternalConnectionFieldInput[];
  note: string;
  t: (key: string) => string;
  onCustomDomainChange: (value: string) => void;
  onDisplayNameChange: (value: string) => void;
  onFieldsChange: (value: UserExternalConnectionFieldInput[]) => void;
  onNoteChange: (value: string) => void;
}

export function ConnectionFormFields({
  createEmptyField,
  customDomain,
  displayName,
  editing,
  fields,
  note,
  t,
  onCustomDomainChange,
  onDisplayNameChange,
  onFieldsChange,
  onNoteChange,
}: ConnectionFormFieldsProps) {
  return (
    <div className="space-y-4 py-4">
      <div className="rounded-md border border-border/70 bg-surface-high p-4">
        <div className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-secondary">
          {t('section_connection_title')}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">{t('custom_domain_label')}</label>
            <Input
              aria-label={t('custom_domain_label')}
              value={customDomain}
              onChange={(event) => onCustomDomainChange(event.target.value)}
              placeholder={t('custom_domain_placeholder')}
              data-testid="third-party-accounts__custom-domain"
              className="bg-background"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">{t('display_name_label')}</label>
            <Input
              aria-label={t('display_name_label')}
              value={displayName}
              onChange={(event) => onDisplayNameChange(event.target.value)}
              placeholder={t('display_name_placeholder')}
              data-testid="third-party-accounts__display-name"
              className="bg-background"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">{t('note_label')}</label>
            <Textarea
              aria-label={t('note_label')}
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
              rows={2}
              placeholder={t('note_placeholder')}
              data-testid="third-party-accounts__note"
              className="bg-background"
            />
          </div>
        </div>
      </div>

      <div className="rounded-md border border-border/70 bg-surface-high p-4">
        <div className="mb-3 flex items-center justify-between">
          <label className="text-sm font-medium">{t('fields_label')}</label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onFieldsChange([...fields, createEmptyField()])}
            data-testid="third-party-accounts__add-field"
          >
            <Plus className="w-4 h-4" />
            {t('add_field')}
          </Button>
        </div>
        <div className="space-y-3">
          {fields.map((field, index) => (
            <div
              key={index}
              className="space-y-3 rounded-md border border-subtle bg-background p-3"
              data-testid={`third-party-accounts__field-row-${index}`}
            >
              <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                <Input
                  value={field.key}
                  onChange={(event) => onFieldsChange(fields.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item))}
                  placeholder={t('field_key_placeholder')}
                  data-testid={`third-party-accounts__field-key-${index}`}
                />
                <Input
                  value={field.value}
                  onChange={(event) => onFieldsChange(fields.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))}
                  placeholder={editing && field.secret ? t('secret_keep_existing_hint') : t('field_value_placeholder')}
                  data-testid={`third-party-accounts__field-value-${index}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-error hover:text-error"
                  onClick={() => onFieldsChange(fields.length > 1 ? fields.filter((_, itemIndex) => itemIndex !== index) : [createEmptyField()])}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <Input
                  value={field.description ?? ''}
                  onChange={(event) => onFieldsChange(fields.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))}
                  placeholder={t('field_description_placeholder')}
                  data-testid={`third-party-accounts__field-description-${index}`}
                />
                <label className="inline-flex items-center gap-2 text-sm text-tertiary">
                  <input
                    type="checkbox"
                    checked={field.secret !== false}
                    onChange={(event) => onFieldsChange(fields.map((item, itemIndex) => itemIndex === index ? { ...item, secret: event.target.checked } : item))}
                    data-testid={`third-party-accounts__field-secret-${index}`}
                  />
                  {t('field_secret_label')}
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
