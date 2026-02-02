'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ROLE_TEMPLATES } from '@/lib/constants/permissions';
import { Check } from 'lucide-react';

export interface TemplateModeProps {
  selectedTemplate: 'owner' | 'admin' | 'developer' | 'user' | null;
  onTemplateChange: (template: 'owner' | 'admin' | 'developer' | 'user' | null) => void;
  currentPermissions: string[];
}

export function TemplateMode({
  selectedTemplate,
  onTemplateChange,
  currentPermissions,
}: TemplateModeProps) {
  const t = useTranslations('members.permissions');
  const templatePermissions = React.useMemo(() => {
    if (!selectedTemplate) return [];
    return ROLE_TEMPLATES[selectedTemplate];
  }, [selectedTemplate]);

  const isCustom = React.useMemo(() => {
    if (!selectedTemplate) return true;
    const templatePerms = new Set(templatePermissions);
    const currentPerms = new Set(currentPermissions);
    if (templatePerms.size !== currentPerms.size) return true;
    for (const perm of templatePerms) {
      if (!currentPerms.has(perm)) return true;
    }
    return false;
  }, [selectedTemplate, templatePermissions, currentPermissions]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">{t('select_template')}</label>
        <Select
          value={selectedTemplate || 'custom'}
          onValueChange={(value) => {
            if (value === 'custom') {
              onTemplateChange(null);
            } else {
              onTemplateChange(value as 'owner' | 'admin' | 'developer' | 'user');
            }
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder={t('select_template')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="owner">{t('template.owner')}</SelectItem>
            <SelectItem value="admin">{t('template.admin')}</SelectItem>
            <SelectItem value="developer">{t('template.developer')}</SelectItem>
            <SelectItem value="user">{t('template.user')}</SelectItem>
            <SelectItem value="custom">{t('template.custom')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {selectedTemplate && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-tertiary">
              {t(`template.${selectedTemplate}`)} {t('template_mode')}
            </span>
            {isCustom && (
              <Badge variant="outline" className="text-xs">
                {t('customized')}
              </Badge>
            )}
          </div>

          <div className="rounded-md border border-border bg-surface-high p-4 space-y-2 max-h-[400px] overflow-y-auto">
            <p className="text-xs text-tertiary mb-3">
              This template includes the following permissions:
            </p>
            <div className="space-y-1">
              {templatePermissions.map((permission) => {
                const isIncluded = currentPermissions.includes(permission);
                return (
                  <div
                    key={permission}
                    className="flex items-center gap-2 text-sm"
                  >
                    {isIncluded ? (
                      <Check className="h-4 w-4 text-success shrink-0" />
                    ) : (
                      <div className="h-4 w-4 shrink-0" />
                    )}
                    <code className="text-xs font-mono text-primary">{permission}</code>
                  </div>
                );
              })}
            </div>
          </div>

          {selectedTemplate && (
            <p className="text-xs text-tertiary">
              {t(`template_description.${selectedTemplate}`)}
            </p>
          )}
        </div>
      )}

      {!selectedTemplate && (
        <div className="rounded-md border border-border bg-surface-high p-4">
          <p className="text-sm text-tertiary">
            {t('custom_mode')}
          </p>
        </div>
      )}
    </div>
  );
}
