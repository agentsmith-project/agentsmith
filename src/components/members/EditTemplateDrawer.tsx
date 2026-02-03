'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AdvancedMode } from './PermissionsEditor/AdvancedMode';
import type { PermissionTemplate } from '@/lib/api/types';

export interface EditTemplateDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: PermissionTemplate;
  onSubmit: (data: { name: string; description?: string; permissions: string[] }) => Promise<void>;
}

export function EditTemplateDrawer({
  open,
  onOpenChange,
  template,
  onSubmit,
}: EditTemplateDrawerProps) {
  const t = useTranslations('members.templates');
  const [name, setName] = React.useState(template.name);
  const [description, setDescription] = React.useState(template.description ?? '');
  const [selectedPermissions, setSelectedPermissions] = React.useState<Set<string>>(
    () => new Set(template.permissions)
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [nameError, setNameError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setName(template.name);
      setDescription(template.description ?? '');
      setSelectedPermissions(new Set(template.permissions));
      setNameError(null);
    }
  }, [open, template]);

  const handlePermissionToggle = React.useCallback((permission: string, checked: boolean) => {
    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(permission);
      } else {
        next.delete(permission);
      }
      return next;
    });
  }, []);

  const handleSubmit = React.useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError(t('name_required'));
      return;
    }
    setNameError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        name: trimmedName,
        description: description.trim() || undefined,
        permissions: Array.from(selectedPermissions),
      });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }, [name, description, selectedPermissions, onSubmit, onOpenChange, t]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right-wide"
        className="flex flex-col p-0 gap-0 h-full overflow-hidden sm:w-[640px]"
      >
        <SheetHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-subtle">
          <SheetTitle className="text-base font-semibold text-foreground">
            {t('edit')} - {template.name}
          </SheetTitle>
          {template.description && (
            <p className="text-sm text-tertiary mt-1">{template.description}</p>
          )}
        </SheetHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-template-name">{t('template_name')}</Label>
            <Input
              id="edit-template-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(null);
              }}
              placeholder={t('template_name')}
              className={nameError ? 'border-destructive' : ''}
            />
            {nameError && <p className="text-sm text-destructive">{nameError}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-template-description">{t('template_description')}</Label>
            <Input
              id="edit-template-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('template_description')}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('permissions_list')}</Label>
            <AdvancedMode
              selectedPermissions={selectedPermissions}
              onPermissionToggle={handlePermissionToggle}
              initialTemplate={undefined}
            />
          </div>
        </div>

        <div className="flex-shrink-0 px-6 py-4 border-t border-border flex justify-end gap-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('cancel')}
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? t('updating') : t('edit')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
