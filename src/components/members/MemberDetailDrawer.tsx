'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { History } from 'lucide-react';
import { PermissionsEditor } from './PermissionsEditor/PermissionsEditor';
import { QuotaOverridesEditor } from './QuotaOverridesEditor';
import { ResourceACLEditor } from './ResourceACLEditor';
import { ROLE_TEMPLATES } from '@/lib/constants/permissions';
import type { Member } from '@/lib/api/endpoints/members';
import type { MemberPermissions, QuotaOverride, PermissionTemplate, QuotaTemplate } from '@/lib/api/types';

function extractQuotasFromGovernance(governance?: Record<string, unknown>): QuotaOverride {
  const quotas = governance?.quotas as QuotaOverride | undefined;
  return quotas ?? {};
}

export interface MemberDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: Member | null;
  permissions?: MemberPermissions;
  projectGovernance?: Record<string, unknown>;
  quotaOverrides?: QuotaOverride;
  workspaceId?: string;
  projectId?: string;
  permissionTemplates?: PermissionTemplate[];
  quotaTemplates?: QuotaTemplate[];
  onSavePermissions?: (permissions: string[], mode: 'template' | 'custom', template?: string) => void;
  onSaveQuota?: (quota: QuotaOverride) => void;
  onViewHistory?: () => void;
  onViewQuotaHistory?: () => void;
}

const PERM_TEMPLATE_IDS = ['admin', 'developer', 'user'] as const;

export function MemberDetailDrawer({
  open,
  onOpenChange,
  member,
  permissions,
  projectGovernance,
  quotaOverrides,
  workspaceId,
  projectId,
  permissionTemplates = [],
  quotaTemplates = [],
  onSavePermissions,
  onSaveQuota,
  onViewHistory,
  onViewQuotaHistory,
}: MemberDetailDrawerProps) {
  const t = useTranslations('members');
  const tTpl = useTranslations('members.templates');
  const [activeTab, setActiveTab] = React.useState<'permissions' | 'quota' | 'acl'>('permissions');
  const [appliedPermTemplateId, setAppliedPermTemplateId] = React.useState<string | null>(null);
  const [appliedQuotaTemplateId, setAppliedQuotaTemplateId] = React.useState<string | null>(null);

  const permTemplatesForDropdown = React.useMemo(() => {
    const defaults = PERM_TEMPLATE_IDS.map((id) => ({
      id,
      name: tTpl(`default_templates.${id}`),
      permissions: [...ROLE_TEMPLATES[id]],
    }));
    const custom = permissionTemplates.filter((tpl) => !PERM_TEMPLATE_IDS.includes(tpl.id as typeof PERM_TEMPLATE_IDS[number]));
    return [...defaults, ...custom];
  }, [permissionTemplates, tTpl]);

  const permInitialPermissions = React.useMemo(() => {
    if (appliedPermTemplateId) {
      const tpl = permTemplatesForDropdown.find((t) => t.id === appliedPermTemplateId);
      return tpl?.permissions ?? permissions?.platform_permissions ?? [];
    }
    return permissions?.platform_permissions ?? [];
  }, [appliedPermTemplateId, permTemplatesForDropdown, permissions]);

  const quotaInitialOverrides = React.useMemo(() => {
    if (appliedQuotaTemplateId) {
      const tpl = quotaTemplates.find((t) => t.id === appliedQuotaTemplateId);
      return tpl?.overrides_json ?? quotaOverrides ?? {};
    }
    return quotaOverrides ?? {};
  }, [appliedQuotaTemplateId, quotaTemplates, quotaOverrides]);

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

  if (!member) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right-wide"
        className="flex flex-col p-0 gap-0 h-full overflow-hidden sm:w-[640px]"
      >
        {/* Header: fixed, no shrink. Design: 16-18px title, 24px padding */}
        <SheetHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-subtle">
          <div className="flex items-center justify-between pr-8">
            <div>
              <SheetTitle className="text-base font-semibold text-foreground">
                {member.name}
              </SheetTitle>
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
        </SheetHeader>

        {/* Tab content: scrollable, fixed height prevents resize on tab switch */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'permissions' | 'quota' | 'acl')}>
            <TabsList>
              <TabsTrigger value="permissions">{t('permissions.title')}</TabsTrigger>
              <TabsTrigger value="quota">{t('quota.title')}</TabsTrigger>
              <TabsTrigger value="acl">{t('acl.title')}</TabsTrigger>
            </TabsList>

            <TabsContent value="permissions" className="mt-4 space-y-4">
              <div className="flex items-center gap-3">
                <Label className="text-sm shrink-0">{tTpl('apply_template')}:</Label>
                <Select
                  value={appliedPermTemplateId ?? '__none__'}
                  onValueChange={(v) => setAppliedPermTemplateId(v === '__none__' ? null : v)}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder={tTpl('select_template')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{tTpl('select_template')}</SelectItem>
                    {permTemplatesForDropdown.map((tpl) => (
                      <SelectItem key={tpl.id} value={tpl.id}>
                        {tpl.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-sm text-tertiary">{t('permissions.title_description')}</p>
              {permissions ? (
                <PermissionsEditor
                  key={`${member.id}-${appliedPermTemplateId ?? 'current'}`}
                  initialPermissions={permInitialPermissions}
                  onSave={handleSavePermissions}
                  onCancel={() => onOpenChange(false)}
                />
              ) : (
                <div className="text-center py-8 text-tertiary">
                  <p className="text-sm">{t('permissions.loading')}</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="quota" className="mt-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Label className="text-sm shrink-0">{tTpl('apply_template')}:</Label>
                    <Select
                      value={appliedQuotaTemplateId ?? '__none__'}
                      onValueChange={(v) => setAppliedQuotaTemplateId(v === '__none__' ? null : v)}
                    >
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder={tTpl('select_template')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{tTpl('select_template')}</SelectItem>
                        {quotaTemplates.map((tpl) => (
                          <SelectItem key={tpl.id} value={tpl.id}>
                            {tpl.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {onViewQuotaHistory && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onViewQuotaHistory}
                      className="gap-2"
                    >
                      <History className="h-4 w-4" />
                      {t('quota_history.view_history')}
                    </Button>
                  )}
                </div>
                <QuotaOverridesEditor
                  key={`${member.id}-quota-${appliedQuotaTemplateId ?? 'current'}`}
                  defaultQuotas={extractQuotasFromGovernance(projectGovernance)}
                  initialOverrides={quotaInitialOverrides}
                  onSave={handleSaveQuota}
                  onCancel={() => onOpenChange(false)}
                />
              </div>
            </TabsContent>

            <TabsContent value="acl" className="mt-4">
              {workspaceId && projectId ? (
                <ResourceACLEditor
                  workspaceId={workspaceId}
                  projectId={projectId}
                  memberId={member.id}
                  memberName={member.name || member.email}
                  onSave={() => {}}
                  onCancel={() => onOpenChange(false)}
                />
              ) : (
                <div className="text-center py-8 text-tertiary">
                  <p className="text-sm">Workspace and project ID required</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}
