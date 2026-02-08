'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Settings, Eye, Plus, Lock, CheckCircle, UserPlus, Trash2 } from 'lucide-react';
import {
  usePermissionTemplates,
  useCreatePermissionTemplate,
  useUpdatePermissionTemplate,
  useDeletePermissionTemplate,
  useBatchApplyPermissionTemplate,
  useMembers,
} from '@/lib/hooks/use-members';
import { ROLE_TEMPLATES } from '@/lib/constants/permissions';
import { useCanManageMemberGovernance } from '@/lib/hooks/use-permissions';
import { CreateTemplateDrawer } from './CreateTemplateDrawer';
import { ApplyTemplateDialog } from './ApplyTemplateDialog';
import { EditTemplateDrawer } from './EditTemplateDrawer';
import type { PermissionTemplate } from '@/lib/api/types';
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

export interface PermissionTemplatesTabProps {
  workspaceId: string;
  projectId: string;
}

export function PermissionTemplatesTab({
  workspaceId,
  projectId,
}: PermissionTemplatesTabProps) {
  const t = useTranslations('members.templates');
  const { data: templates, isLoading } = usePermissionTemplates(workspaceId, projectId);
  const { data: members = [] } = useMembers(workspaceId, projectId);
  const createTemplate = useCreatePermissionTemplate(workspaceId, projectId);
  const batchApplyTemplate = useBatchApplyPermissionTemplate(workspaceId, projectId);
  const canManage = useCanManageMemberGovernance();
  const [selectedTemplate, setSelectedTemplate] = React.useState<PermissionTemplate | null>(null);
  const [editingTemplateId, setEditingTemplateId] = React.useState('');
  const updateTemplate = useUpdatePermissionTemplate(workspaceId, projectId, editingTemplateId);
  const deleteTemplate = useDeletePermissionTemplate(workspaceId, projectId);
  const [viewDialogOpen, setViewDialogOpen] = React.useState(false);
  const [createDrawerOpen, setCreateDrawerOpen] = React.useState(false);
  const [applyDialogOpen, setApplyDialogOpen] = React.useState(false);
  const [editDrawerOpen, setEditDrawerOpen] = React.useState(false);
  const [templateToDelete, setTemplateToDelete] = React.useState<PermissionTemplate | null>(null);

  const defaultTemplates = React.useMemo((): PermissionTemplate[] => {
    return [
      {
        id: 'owner',
        name: t('default_templates.owner'),
        description: t('default_templates.owner_description'),
        permissions: [...ROLE_TEMPLATES.owner],
        is_default: true,
        is_readonly: true,
      },
      {
        id: 'admin',
        name: t('default_templates.admin'),
        description: t('default_templates.admin_description'),
        permissions: [...ROLE_TEMPLATES.admin],
        is_default: true,
        is_readonly: true,
      },
      {
        id: 'developer',
        name: t('default_templates.developer'),
        description: t('default_templates.developer_description'),
        permissions: [...ROLE_TEMPLATES.developer],
        is_default: true,
        is_readonly: true,
      },
      {
        id: 'user',
        name: t('default_templates.user'),
        description: t('default_templates.user_description'),
        permissions: [...ROLE_TEMPLATES.user],
        is_default: true,
        is_readonly: true,
      },
    ];
  }, [t]);

  const allTemplates = React.useMemo(() => {
    if (!templates) return defaultTemplates;
    return [...defaultTemplates, ...templates.filter((t) => !t.is_default)];
  }, [templates, defaultTemplates]);

  const customTemplates = allTemplates.filter((t) => !t.is_default);

  const handleApplyTemplate = React.useCallback(
    async (memberIds: string[], permissions: string[], templateId?: string | null) => {
      return batchApplyTemplate.mutateAsync({
        memberIds,
        permissions,
        template: templateId ?? undefined,
      });
    },
    [batchApplyTemplate]
  );

  const handleConfirmDelete = React.useCallback(async () => {
    if (!templateToDelete) return;
    await deleteTemplate.mutateAsync(templateToDelete.id);
    if (selectedTemplate?.id === templateToDelete.id) {
      setSelectedTemplate(null);
      setViewDialogOpen(false);
      setEditDrawerOpen(false);
      setApplyDialogOpen(false);
    }
    setTemplateToDelete(null);
  }, [deleteTemplate, selectedTemplate, templateToDelete]);

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
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setCreateDrawerOpen(true)}
          >
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
              setSelectedTemplate(template);
              setEditingTemplateId(template.id);
              setEditDrawerOpen(true);
            }}
            onDelete={() => setTemplateToDelete(template)}
          />
        ))}
        {customTemplates.length === 0 && (
          <div className="border border-dashed border-border rounded-lg p-8 text-center">
            <p className="text-sm font-medium text-foreground mb-1">{t('empty_custom_title')}</p>
            <p className="text-xs text-tertiary mb-4">{t('empty_custom_description')}</p>
            {canManage && (
              <Button variant="outline" size="sm" onClick={() => setCreateDrawerOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                {t('create_template')}
              </Button>
            )}
          </div>
        )}
      </div>

      {selectedTemplate && (
        <TemplateViewDialog
          open={viewDialogOpen}
          onOpenChange={setViewDialogOpen}
          template={selectedTemplate}
          canManage={canManage}
          onApplyToMember={() => setApplyDialogOpen(true)}
        />
      )}

      {selectedTemplate && (
        <ApplyTemplateDialog
          open={applyDialogOpen}
          onOpenChange={setApplyDialogOpen}
          template={selectedTemplate}
          members={Array.isArray(members) ? members : []}
          onApply={handleApplyTemplate}
        />
      )}

      <CreateTemplateDrawer
        open={createDrawerOpen}
        onOpenChange={setCreateDrawerOpen}
        onSubmit={async (data) => {
          await createTemplate.mutateAsync(data);
        }}
      />

      {selectedTemplate && !selectedTemplate.is_readonly && (
        <EditTemplateDrawer
          open={editDrawerOpen}
          onOpenChange={(open) => {
            setEditDrawerOpen(open);
            if (!open) setEditingTemplateId('');
          }}
          template={selectedTemplate}
          onSubmit={async (data) => {
            await updateTemplate.mutateAsync(data);
          }}
        />
      )}

      <AlertDialog
        open={!!templateToDelete}
        onOpenChange={(open) => !open && setTemplateToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('permission_delete_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {templateToDelete
                ? t('permission_delete_confirm_message', { name: templateToDelete.name })
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmDelete();
              }}
              disabled={deleteTemplate.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="members__permission-template-delete-confirm"
            >
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface TemplateCardProps {
  template: PermissionTemplate;
  canManage: boolean;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function TemplateCard({
  template,
  canManage,
  onView,
  onEdit,
  onDelete,
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
            <>
              <Button variant="outline" size="sm" onClick={onEdit} className="gap-2">
                <Settings className="h-4 w-4" />
                {t('edit')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onDelete}
                className="gap-2 text-destructive hover:text-destructive"
                data-testid={`members__permission-template-delete-btn--${template.id}`}
              >
                <Trash2 className="h-4 w-4" />
                {t('delete')}
              </Button>
            </>
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
  canManage?: boolean;
  onApplyToMember?: () => void;
}

function TemplateViewDialog({
  open,
  onOpenChange,
  template,
  canManage,
  onApplyToMember,
}: TemplateViewDialogProps) {
  const t = useTranslations('members.templates');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template.name}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('view_dialog_description', { name: template.name })}
          </DialogDescription>
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

          {canManage && onApplyToMember && (
            <div className="pt-2 border-t border-border">
              <Button variant="outline" size="sm" onClick={onApplyToMember} className="gap-2">
                <UserPlus className="h-4 w-4" />
                {t('apply_to_member')}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
