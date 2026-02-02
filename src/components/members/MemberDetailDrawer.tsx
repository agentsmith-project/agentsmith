'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { History } from 'lucide-react';
import { PermissionsEditor } from './PermissionsEditor/PermissionsEditor';
import { QuotaOverridesEditor } from './QuotaOverridesEditor';
import { ResourceACLEditor } from './ResourceACLEditor';
import type { Member } from '@/lib/api/endpoints/members';
import type { MemberPermissions, QuotaOverride } from '@/lib/api/types';

export interface MemberDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: Member | null;
  permissions?: MemberPermissions;
  quotaOverrides?: QuotaOverride;
  workspaceId?: string;
  projectId?: string;
  onSavePermissions?: (permissions: string[], mode: 'template' | 'custom', template?: string) => void;
  onSaveQuota?: (quota: QuotaOverride) => void;
  onViewHistory?: () => void;
}

export function MemberDetailDrawer({
  open,
  onOpenChange,
  member,
  permissions,
  quotaOverrides,
  workspaceId,
  projectId,
  onSavePermissions,
  onSaveQuota,
  onViewHistory,
}: MemberDetailDrawerProps) {
  const t = useTranslations('members');
  const [activeTab, setActiveTab] = React.useState<'permissions' | 'quota' | 'acl'>('permissions');

  if (!member) return null;

  const handleSavePermissions = React.useCallback(
    (permissions: string[], mode: 'template' | 'custom', template?: string) => {
      onSavePermissions?.(permissions, mode, template);
      // Optionally close drawer after save
      // onOpenChange(false);
    },
    [onSavePermissions]
  );

  const handleSaveQuota = React.useCallback(
    (quota: QuotaOverride) => {
      onSaveQuota?.(quota);
    },
    [onSaveQuota]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>{member.name}</DialogTitle>
              <p className="text-sm text-tertiary mt-1">{member.email}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{member.role}</Badge>
              {onViewHistory && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onViewHistory}
                  className="gap-2"
                >
                  <History className="h-4 w-4" />
                  {t('history.view_history')}
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
          <TabsList>
            <TabsTrigger value="permissions">{t('permissions.title')}</TabsTrigger>
            <TabsTrigger value="quota">{t('quota.title')}</TabsTrigger>
            <TabsTrigger value="acl">{t('acl.title')}</TabsTrigger>
          </TabsList>

          <TabsContent value="permissions" className="mt-4">
            {permissions && (
              <PermissionsEditor
                initialPermissions={permissions.platform_permissions || []}
                onSave={handleSavePermissions}
                onCancel={() => onOpenChange(false)}
              />
            )}
          </TabsContent>

          <TabsContent value="quota" className="mt-4">
            <QuotaOverridesEditor
              defaultQuotas={quotaOverrides || {}}
              initialOverrides={member.quota_overrides}
              onSave={handleSaveQuota}
              onCancel={() => onOpenChange(false)}
            />
          </TabsContent>

          <TabsContent value="acl" className="mt-4">
            {workspaceId && projectId ? (
              <ResourceACLEditor
                workspaceId={workspaceId}
                projectId={projectId}
                memberId={member.id}
                memberName={member.name || member.email}
                onSave={() => {
                  // Optionally close drawer or show success message
                }}
                onCancel={() => onOpenChange(false)}
              />
            ) : (
              <div className="text-center py-8 text-tertiary">
                <p className="text-sm">Workspace and project ID required</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
