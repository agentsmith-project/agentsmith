'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AdvancedMode } from './PermissionsEditor/AdvancedMode';

export interface CreateTemplateDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { name: string; description?: string; permissions: string[] }) => Promise<void>;
}

export function CreateTemplateDrawer({
  open,
  onOpenChange,
  onSubmit,
}: CreateTemplateDrawerProps) {
  const t = useTranslations('members.templates');
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [selectedPermissions, setSelectedPermissions] = React.useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = React.useState(false);
  const [nameError, setNameError] = React.useState<string | null>(null);

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
      setName('');
      setDescription('');
      setSelectedPermissions(new Set());
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }, [name, description, selectedPermissions, onSubmit, onOpenChange, t]);

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next) {
        setNameError(null);
      }
      onOpenChange(next);
    },
    [onOpenChange]
  );

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right-wide"
        className="flex flex-col p-0 gap-0 h-full overflow-hidden sm:w-[640px]"
      >
        <SheetHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-subtle">
          <SheetTitle className="text-base font-semibold text-foreground">
            {t('create_template')}
          </SheetTitle>
          <SheetDescription className="mt-1">{t('empty_custom_description')}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="template-name">{t('template_name')}</Label>
            <Input
              id="template-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(null);
              }}
              placeholder={t('template_name')}
              className={nameError ? 'border-destructive' : ''}
            />
            {nameError && (
              <p className="text-sm text-destructive">{nameError}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="template-description">{t('template_description')}</Label>
            <Input
              id="template-description"
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
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={submitting}>
            {t('cancel')}
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? t('creating') : t('create_template')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
