'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Settings, Eye, Plus, UserPlus, Trash2 } from 'lucide-react';
import {
  useQuotaTemplates,
  useCreateQuotaTemplate,
  useUpdateQuotaTemplate,
  useDeleteQuotaTemplate,
  useBatchApplyQuotaTemplate,
  useMembers,
} from '@/lib/hooks/use-members';
import { useIsOwnerOrAdmin } from '@/lib/hooks/use-permissions';
import { CreateQuotaTemplateDrawer } from './CreateQuotaTemplateDrawer';
import { EditQuotaTemplateDrawer } from './EditQuotaTemplateDrawer';
import { ApplyQuotaTemplateDialog } from './ApplyQuotaTemplateDialog';
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
import type { QuotaTemplate } from '@/lib/api/types';

export interface QuotaTemplatesSectionProps {
  workspaceId: string;
  projectId: string;
  projectGovernance?: Record<string, unknown>;
}

export function QuotaTemplatesSection({
  workspaceId,
  projectId,
  projectGovernance,
}: QuotaTemplatesSectionProps) {
  const t = useTranslations('members.templates');
  const { data: templates = [], isLoading } = useQuotaTemplates(workspaceId, projectId);
  const { data: members = [] } = useMembers(workspaceId, projectId);
  const createTemplate = useCreateQuotaTemplate(workspaceId, projectId);
  const batchApply = useBatchApplyQuotaTemplate(workspaceId, projectId);
  const canManage = useIsOwnerOrAdmin();

  const [selectedTemplate, setSelectedTemplate] = React.useState<QuotaTemplate | null>(null);
  const [editingTemplateId, setEditingTemplateId] = React.useState('');
  const [viewDialogOpen, setViewDialogOpen] = React.useState(false);
  const [createDrawerOpen, setCreateDrawerOpen] = React.useState(false);
  const [applyDialogOpen, setApplyDialogOpen] = React.useState(false);
  const [editDrawerOpen, setEditDrawerOpen] = React.useState(false);
  const [templateToDelete, setTemplateToDelete] = React.useState<QuotaTemplate | null>(null);

  const updateTemplate = useUpdateQuotaTemplate(
    workspaceId,
    projectId,
    editingTemplateId
  );
  const deleteTemplate = useDeleteQuotaTemplate(workspaceId, projectId);

  const handleApplyTemplate = React.useCallback(
    async (memberIds: string[]) => {
      if (!selectedTemplate) return;
      await batchApply.mutateAsync({
        templateId: selectedTemplate.id,
        memberIds,
      });
    },
    [selectedTemplate, batchApply]
  );

  const handleConfirmDelete = React.useCallback(async () => {
    if (!templateToDelete) return;
    try {
      await deleteTemplate.mutateAsync(templateToDelete.id);
      setTemplateToDelete(null);
      if (selectedTemplate?.id === templateToDelete.id) {
        setSelectedTemplate(null);
        setViewDialogOpen(false);
      }
    } catch {
      // Error handled by hook
    }
  }, [templateToDelete, deleteTemplate, selectedTemplate]);

  if (isLoading) {
    return (
      <div className="text-center py-8 text-tertiary">
        <p className="text-sm">Loading quota templates...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-foreground">{t('quota_title')}</h3>
          <p className="text-xs text-tertiary mt-1">{t('quota_description')}</p>
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
        {templates.map((template) => (
          <QuotaTemplateCard
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
            onApply={() => {
              setSelectedTemplate(template);
              setApplyDialogOpen(true);
            }}
            onDelete={() => setTemplateToDelete(template)}
          />
        ))}
        {templates.length === 0 && (
          <div className="border border-dashed border-border rounded-lg p-8 text-center">
            <p className="text-sm font-medium text-foreground mb-1">
              {t('quota_empty_title')}
            </p>
            <p className="text-xs text-tertiary mb-4">{t('quota_empty_description')}</p>
            {canManage && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreateDrawerOpen(true)}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                {t('create_template')}
              </Button>
            )}
          </div>
        )}
      </div>

      {selectedTemplate && (
        <QuotaTemplateViewDialog
          open={viewDialogOpen}
          onOpenChange={setViewDialogOpen}
          template={selectedTemplate}
          canManage={canManage}
          onApplyToMembers={() => setApplyDialogOpen(true)}
        />
      )}

      {selectedTemplate && (
        <ApplyQuotaTemplateDialog
          open={applyDialogOpen}
          onOpenChange={setApplyDialogOpen}
          template={selectedTemplate}
          members={Array.isArray(members) ? members : []}
          onApply={handleApplyTemplate}
        />
      )}

      <CreateQuotaTemplateDrawer
        open={createDrawerOpen}
        onOpenChange={setCreateDrawerOpen}
        projectGovernance={projectGovernance}
        onSubmit={async (data) => {
          await createTemplate.mutateAsync(data);
        }}
      />

      {selectedTemplate && editingTemplateId === selectedTemplate.id && (
        <EditQuotaTemplateDrawer
          open={editDrawerOpen}
          onOpenChange={(open) => {
            setEditDrawerOpen(open);
            if (!open) setEditingTemplateId('');
          }}
          template={selectedTemplate}
          projectGovernance={projectGovernance}
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
            <AlertDialogTitle>{t('delete_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {templateToDelete
                ? t('delete_confirm_message', { name: templateToDelete.name })
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
            >
              {deleteTemplate.isPending ? t('updating') : t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface QuotaTemplateCardProps {
  template: QuotaTemplate;
  canManage: boolean;
  onView: () => void;
  onEdit: () => void;
  onApply: () => void;
  onDelete: () => void;
}

function QuotaTemplateCard({
  template,
  canManage,
  onView,
  onEdit,
  onApply,
  onDelete,
}: QuotaTemplateCardProps) {
  const t = useTranslations('members.templates');
  const overrideCount = Object.keys(template.overrides_json || {}).length;

  return (
    <div className="border border-border rounded-md p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h4 className="text-sm font-medium text-foreground">{template.name}</h4>
          {template.description && (
            <p className="text-xs text-tertiary mt-1">{template.description}</p>
          )}
          <p className="text-xs text-tertiary mt-1">
            {overrideCount} override path{overrideCount !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onView} className="gap-2">
            <Eye className="h-4 w-4" />
            {t('view_details')}
          </Button>
          {canManage && (
            <>
              <Button variant="outline" size="sm" onClick={onApply} className="gap-2">
                <UserPlus className="h-4 w-4" />
                {t('apply_to_member')}
              </Button>
              <Button variant="outline" size="sm" onClick={onEdit} className="gap-2">
                <Settings className="h-4 w-4" />
                {t('edit')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onDelete}
                className="gap-2 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface QuotaTemplateViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: QuotaTemplate;
  canManage?: boolean;
  onApplyToMembers?: () => void;
}

function QuotaTemplateViewDialog({
  open,
  onOpenChange,
  template,
  canManage,
  onApplyToMembers,
}: QuotaTemplateViewDialogProps) {
  const t = useTranslations('members.templates');

  const overrides = template.overrides_json || {};
  const overrideEntries = Object.entries(overrides);

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
              Quota Overrides
            </h4>
            <div className="border border-border rounded-md p-4 max-h-[400px] overflow-y-auto">
              {overrideEntries.length === 0 ? (
                <p className="text-sm text-tertiary">No overrides (uses project defaults)</p>
              ) : (
                <pre className="text-xs font-mono text-foreground whitespace-pre-wrap">
                  {JSON.stringify(overrides, null, 2)}
                </pre>
              )}
            </div>
          </div>

          {canManage && onApplyToMembers && (
            <div className="pt-2 border-t border-border">
              <Button variant="outline" size="sm" onClick={onApplyToMembers} className="gap-2">
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
