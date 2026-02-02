'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/loading';
import { Settings, Eye, Plus, Lock, CheckCircle } from 'lucide-react';
import { usePermissionTemplates } from '@/lib/hooks/use-members';
import { ROLE_TEMPLATES } from '@/lib/constants/permissions';
import { useIsOwnerOrAdmin } from '@/lib/hooks/use-permissions';
import type { PermissionTemplate } from '@/lib/api/types';

export interface PermissionTemplatesTabProps {
  workspaceId: string;
  projectId: string;
  onApplyTemplate?: (templateId: string, memberId: string) => void;
}

export function PermissionTemplatesTab({
  workspaceId,
  projectId,
  onApplyTemplate,
}: PermissionTemplatesTabProps) {
  const t = useTranslations('members.templates');
  const { data: templates, isLoading } = usePermissionTemplates(workspaceId, projectId);
  const canManage = useIsOwnerOrAdmin();
  const [selectedTemplate, setSelectedTemplate] = React.useState<PermissionTemplate | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = React.useState(false);

  const defaultTemplates = React.useMemo(() => {
    return [
      {
        id: 'owner',
        name: t('default_templates.owner'),
        description: t('default_templates.owner_description'),
        permissions: ROLE_TEMPLATES.owner as string[],
        is_default: true,
        is_readonly: true,
      },
      {
        id: 'admin',
        name: t('default_templates.admin'),
        description: t('default_templates.admin_description'),
        permissions: ROLE_TEMPLATES.admin as string[],
        is_default: true,
        is_readonly: true,
      },
      {
        id: 'developer',
        name: t('default_templates.developer'),
        description: t('default_templates.developer_description'),
        permissions: ROLE_TEMPLATES.developer as string[],
        is_default: true,
        is_readonly: true,
      },
      {
        id: 'user',
        name: t('default_templates.user'),
        description: t('default_templates.user_description'),
        permissions: ROLE_TEMPLATES.user as string[],
        is_default: true,
        is_readonly: true,
      },
    ] as PermissionTemplate[];
  }, [t]);

  const allTemplates = React.useMemo(() => {
    if (!templates) return defaultTemplates;
    return [...defaultTemplates, ...templates.filter(t => !t.is_default)];
  }, [templates, defaultTemplates]);

  if (isLoading) {
    return (
      <div className="text-center py-8 text-tertiary">
        <p className="text-sm">Loading templates...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-foreground">{t('title')}</h3>
          <p className="text-xs text-tertiary mt-1">{t('description')}</p>
        </div>
        {canManage && (
          <Button variant="outline" size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            {t('create_template')}
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {allTemplates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            canManage={canManage}
            onView={() => {
              setSelectedTemplate(template);
              setViewDialogOpen(true);
            }}
            onEdit={() => {
              // TODO: Implement edit template
              console.log('Edit template:', template.id);
            }}
          />
        ))}
      </div>

      {selectedTemplate && (
        <TemplateViewDialog
          open={viewDialogOpen}
          onOpenChange={setViewDialogOpen}
          template={selectedTemplate}
        />
      )}
    </div>
  );
}

interface TemplateCardProps {
  template: PermissionTemplate;
  canManage: boolean;
  onView: () => void;
  onEdit: () => void;
}

function TemplateCard({
  template,
  canManage,
  onView,
  onEdit,
}: TemplateCardProps) {
  const t = useTranslations('members.templates');

  return (
    <div className="border border-border rounded-md p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-foreground">{template.name}</h4>
            {template.is_default && (
              <Badge variant="outline" className="text-xs">
                {t('default')}
              </Badge>
            )}
            {template.is_readonly && (
              <Badge variant="secondary" className="text-xs">
                <Lock className="h-3 w-3 mr-1" />
                {t('readonly')}
              </Badge>
            )}
          </div>
          {template.description && (
            <p className="text-xs text-tertiary mt-1">{template.description}</p>
          )}
          <p className="text-xs text-tertiary mt-1">
            {t('permissions_count', { count: template.permissions.length })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onView} className="gap-2">
            <Eye className="h-4 w-4" />
            {t('view_details')}
          </Button>
          {canManage && !template.is_readonly && (
            <Button variant="outline" size="sm" onClick={onEdit} className="gap-2">
              <Settings className="h-4 w-4" />
              {t('edit')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

interface TemplateViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: PermissionTemplate;
}

function TemplateViewDialog({
  open,
  onOpenChange,
  template,
}: TemplateViewDialogProps) {
  const t = useTranslations('members.templates');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {template.description && (
            <div>
              <p className="text-sm text-foreground">{template.description}</p>
            </div>
          )}

          <div>
            <h4 className="text-sm font-medium text-foreground mb-3">
              {t('permissions_list')} ({template.permissions.length})
            </h4>
            <div className="border border-border rounded-md p-4 max-h-[400px] overflow-y-auto">
              <div className="space-y-1">
                {template.permissions.map((permission) => (
                  <div
                    key={permission}
                    className="flex items-center gap-2 text-sm"
                  >
                    <CheckCircle className="h-4 w-4 text-success shrink-0" />
                    <code className="text-xs font-mono text-foreground">{permission}</code>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
