'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { TemplateMode } from './TemplateMode';
import { AdvancedMode } from './AdvancedMode';
import { ChangesPreview } from './ChangesPreview';
import { ROLE_TEMPLATES, HIGH_RISK_PERMISSIONS } from '@/lib/constants/permissions';

export interface PermissionsEditorProps {
  initialPermissions: string[];
  onSave: (permissions: string[], mode: 'template' | 'custom', template?: string) => void;
  onCancel: () => void;
}

export function PermissionsEditor({
  initialPermissions,
  onSave,
  onCancel,
}: PermissionsEditorProps) {
  const t = useTranslations('members.permissions');
  const [mode, setMode] = React.useState<'template' | 'advanced'>('template');
  const [selectedTemplate, setSelectedTemplate] = React.useState<'owner' | 'admin' | 'developer' | 'user' | null>(null);
  const [selectedPermissions, setSelectedPermissions] = React.useState<Set<string>>(
    new Set(initialPermissions)
  );
  const [showHighRiskDialog, setShowHighRiskDialog] = React.useState(false);
  const [pendingSave, setPendingSave] = React.useState<(() => void) | null>(null);

  // Detect initial template
  React.useEffect(() => {
    for (const [template, perms] of Object.entries(ROLE_TEMPLATES)) {
      const templateSet = new Set(perms);
      const currentSet = new Set(initialPermissions);
      if (templateSet.size === currentSet.size && 
          Array.from(templateSet).every(p => currentSet.has(p))) {
        setSelectedTemplate(template as 'owner' | 'admin' | 'developer' | 'user');
        return;
      }
    }
    setSelectedTemplate(null);
  }, [initialPermissions]);

  // Calculate changes
  const changes = React.useMemo(() => {
    const added = Array.from(selectedPermissions).filter(p => !initialPermissions.includes(p));
    const removed = initialPermissions.filter(p => !selectedPermissions.has(p));
    return { added, removed };
  }, [selectedPermissions, initialPermissions]);

  // Detect high-risk permissions
  const highRiskAdded = React.useMemo(() => {
    return changes.added.filter(p => HIGH_RISK_PERMISSIONS.includes(p as any));
  }, [changes.added]);

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
    // If template mode, mark as custom
    if (selectedTemplate && checked) {
      const templatePerms = new Set(ROLE_TEMPLATES[selectedTemplate]);
      if (!templatePerms.has(permission)) {
        setSelectedTemplate(null);
      }
    }
  }, [selectedTemplate]);

  const handleTemplateChange = React.useCallback((template: 'owner' | 'admin' | 'developer' | 'user' | null) => {
    setSelectedTemplate(template);
    if (template) {
      setSelectedPermissions(new Set(ROLE_TEMPLATES[template]));
    }
  }, []);

  const handleReset = React.useCallback(() => {
    if (selectedTemplate) {
      setSelectedPermissions(new Set(ROLE_TEMPLATES[selectedTemplate]));
    }
  }, [selectedTemplate]);

  const handleSave = React.useCallback(() => {
    const permissions = Array.from(selectedPermissions);
    const saveMode = selectedTemplate ? 'template' : 'custom';
    const template = selectedTemplate || undefined;

    // Check for high-risk permissions
    if (highRiskAdded.length > 0) {
      setPendingSave(() => () => {
        onSave(permissions, saveMode, template);
        setShowHighRiskDialog(false);
        setPendingSave(null);
      });
      setShowHighRiskDialog(true);
      return;
    }

    onSave(permissions, saveMode, template);
  }, [selectedPermissions, selectedTemplate, highRiskAdded, onSave]);

  const hasChanges = changes.added.length > 0 || changes.removed.length > 0;

  return (
    <div className="space-y-6">
      <Tabs value={mode} onValueChange={(v) => setMode(v as 'template' | 'advanced')}>
        <TabsList>
          <TabsTrigger value="template">{t('template_mode')}</TabsTrigger>
          <TabsTrigger value="advanced">{t('advanced_mode')}</TabsTrigger>
        </TabsList>

        <TabsContent value="template" className="mt-4">
          <TemplateMode
            selectedTemplate={selectedTemplate}
            onTemplateChange={handleTemplateChange}
            currentPermissions={Array.from(selectedPermissions)}
          />
        </TabsContent>

        <TabsContent value="advanced" className="mt-4">
          <AdvancedMode
            selectedPermissions={selectedPermissions}
            onPermissionToggle={handlePermissionToggle}
            onReset={handleReset}
            initialTemplate={selectedTemplate || undefined}
          />
        </TabsContent>
      </Tabs>

      <ChangesPreview
        added={changes.added}
        removed={changes.removed}
      />

      <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
        <Button variant="outline" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button
          variant="default"
          onClick={handleSave}
          disabled={!hasChanges}
        >
          {t('save_changes')}
        </Button>
      </div>

      <AlertDialog open={showHighRiskDialog} onOpenChange={setShowHighRiskDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('high_risk_warning')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('high_risk_description')}
              <ul className="list-disc list-inside mt-2 space-y-1">
                {highRiskAdded.map((permission) => (
                  <li key={permission}>
                    <code className="text-xs font-mono">{permission}</code>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm">
                {t('high_risk_confirm')}
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={pendingSave || undefined}>
              {t('confirm_save')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
