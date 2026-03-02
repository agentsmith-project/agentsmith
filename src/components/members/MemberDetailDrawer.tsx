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
import { GROUP_TEMPLATES } from '@/lib/constants/permissions';
import type { Member } from '@/lib/api/endpoints/members';
import type { MemberPermissions, QuotaOverride, PermissionTemplate, QuotaTemplate } from '@/lib/api/types';
import type {
  GovernanceAuthorizationResponse,
  GovernanceEffectiveAccessSnapshot,
  GovernanceMatchedPolicy,
} from '@/lib/api/endpoints/governance-explainability';

function extractQuotasFromGovernance(governance?: Record<string, unknown>): QuotaOverride {
  const quotas = governance?.quotas as QuotaOverride | undefined;
  return quotas ?? {};
}

function flattenQuotaOverrides(
  source: Record<string, unknown>,
  prefix = ''
): Array<{ key: string; value: string }> {
  return Object.entries(source).flatMap(([key, value]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined) {
      return [];
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      return flattenQuotaOverrides(value as Record<string, unknown>, nextKey);
    }
    return [{ key: nextKey, value: String(value) }];
  });
}

export interface MemberDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: Member | null;
  permissions?: MemberPermissions;
  projectGovernance?: Record<string, unknown>;
  quotaOverrides?: QuotaOverride;
  _workspaceId?: string;
  _projectId?: string;
  permissionTemplates?: PermissionTemplate[];
  quotaTemplates?: QuotaTemplate[];
  effectiveAccessSnapshot?: GovernanceEffectiveAccessSnapshot | null;
  authorizationCheckResult?: GovernanceAuthorizationResponse | null;
  isCheckingAuthorization?: boolean;
  onRunAuthorizationCheck?: (payload: {
    resourceType: 'project' | 'endpoint' | 'source_library' | 'agent';
    resourceId: string;
    action: string;
  }) => Promise<unknown>;
  onSavePermissions?: (permissions: string[], mode: 'template' | 'custom', template?: string) => void;
  onSaveQuota?: (quota: QuotaOverride) => void;
  onViewHistory?: () => void;
  onViewQuotaHistory?: () => void;
  initialAuthorization?: {
    resourceType: 'project' | 'endpoint' | 'source_library' | 'agent';
    resourceId: string;
    action: string;
  };
  embedded?: boolean;
  className?: string;
}

const PERM_TEMPLATE_IDS = ['owner', 'admin', 'developer', 'user'] as const;

function formatGroupAlias(role: string): string {
  switch (role) {
    case 'owner':
      return 'governance';
    case 'admin':
      return 'manager';
    case 'developer':
      return 'operator';
    case 'user':
      return 'member';
    default:
      return role;
  }
}

export function MemberDetailDrawer({
  open,
  onOpenChange,
  member,
  permissions,
  projectGovernance,
  quotaOverrides,
  _workspaceId,
  _projectId,
  permissionTemplates = [],
  quotaTemplates = [],
  effectiveAccessSnapshot,
  authorizationCheckResult,
  isCheckingAuthorization = false,
  onRunAuthorizationCheck,
  onSavePermissions,
  onSaveQuota,
  onViewHistory,
  onViewQuotaHistory,
  initialAuthorization,
  embedded = false,
  className,
}: MemberDetailDrawerProps) {
  const t = useTranslations('members');
  const tTpl = useTranslations('members.templates');
  const [activeTab, setActiveTab] = React.useState<'effective_access' | 'permissions' | 'quota'>('effective_access');
  const [appliedPermTemplateId, setAppliedPermTemplateId] = React.useState<string | null>(null);
  const [appliedQuotaTemplateId, setAppliedQuotaTemplateId] = React.useState<string | null>(null);
  const [authorizeResourceType, setAuthorizeResourceType] = React.useState<'project' | 'endpoint' | 'source_library' | 'agent'>('project');
  const [authorizeResourceId, setAuthorizeResourceId] = React.useState('');
  const [authorizeAction, setAuthorizeAction] = React.useState('read');
  const initializedPermTemplateMemberIdRef = React.useRef<string | null>(null);

  const permTemplatesForDropdown = React.useMemo(() => {
    const defaults = PERM_TEMPLATE_IDS.map((id) => ({
      id,
      name: tTpl(`default_templates.${id}`),
      permissions: [...GROUP_TEMPLATES[id]],
    }));
    const custom = permissionTemplates.filter((tpl) => !PERM_TEMPLATE_IDS.includes(tpl.id as typeof PERM_TEMPLATE_IDS[number]));
    return [...defaults, ...custom];
  }, [permissionTemplates, tTpl]);

  const permInitialPermissions = React.useMemo(() => {
    if (appliedPermTemplateId) {
      const tpl = permTemplatesForDropdown.find((tmpl) => tmpl.id === appliedPermTemplateId);
      return tpl?.permissions ?? permissions?.platform_permissions ?? [];
    }
    return permissions?.platform_permissions ?? [];
  }, [appliedPermTemplateId, permTemplatesForDropdown, permissions]);

  // Reset transient template selections when opening a different member.
  React.useEffect(() => {
    if (!open || !member) return;
    setActiveTab('effective_access');
    setAppliedPermTemplateId(null);
    setAppliedQuotaTemplateId(null);
    setAuthorizeResourceType('project');
    setAuthorizeResourceId('');
    setAuthorizeAction('read');
    initializedPermTemplateMemberIdRef.current = null;
  }, [open, member, member?.id]);

  React.useEffect(() => {
    if (!open || !member || !initialAuthorization) return;
    setActiveTab('effective_access');
    setAuthorizeResourceType(initialAuthorization.resourceType);
    setAuthorizeResourceId(initialAuthorization.resourceId);
    setAuthorizeAction(initialAuthorization.action);
  }, [initialAuthorization, member, open]);

  // Initialize selected permission template from the member's existing permissions.
  React.useEffect(() => {
    if (!open || !member || !permissions) return;
    if (initializedPermTemplateMemberIdRef.current === member.id) return;

    const currentSet = new Set(permissions.platform_permissions ?? []);
    const matchedTemplates = permTemplatesForDropdown.filter((tpl) => {
      const templateSet = new Set(tpl.permissions);
      if (templateSet.size !== currentSet.size) return false;
      return Array.from(templateSet).every((perm) => currentSet.has(perm));
    });
    const matchedTemplate =
      matchedTemplates.find((tpl) => tpl.id === member.role) ??
      matchedTemplates[0];

    setAppliedPermTemplateId(matchedTemplate?.id ?? null);
    initializedPermTemplateMemberIdRef.current = member.id;
  }, [open, member, permissions, permTemplatesForDropdown]);

  const quotaInitialOverrides = React.useMemo(() => {
    if (appliedQuotaTemplateId) {
      const tpl = quotaTemplates.find((tmpl) => tmpl.id === appliedQuotaTemplateId);
      return tpl?.overrides_json ?? quotaOverrides ?? {};
    }
    return quotaOverrides ?? {};
  }, [appliedQuotaTemplateId, quotaTemplates, quotaOverrides]);

  const effectiveQuotaEntries = React.useMemo(
    () => flattenQuotaOverrides((effectiveAccessSnapshot?.quota_overrides ?? quotaOverrides ?? {}) as Record<string, unknown>),
    [effectiveAccessSnapshot?.quota_overrides, quotaOverrides]
  );

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

  const handleAuthorizationCheck = React.useCallback(async () => {
    if (!onRunAuthorizationCheck || !member) return;
    await onRunAuthorizationCheck({
      resourceType: authorizeResourceType,
      resourceId: authorizeResourceId.trim() || member.id,
      action: authorizeAction.trim() || 'read',
    });
  }, [authorizeAction, authorizeResourceId, authorizeResourceType, member, onRunAuthorizationCheck]);

  if (!member) return null;

  const content = (
    <>
      {/* Header: fixed, no shrink. Design: 16-18px title, 24px padding */}
      <SheetHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-subtle">
        <div className="flex items-center justify-between pr-8">
          <div>
            {embedded ? (
              <h2 className="text-base font-semibold text-foreground">{member.name}</h2>
            ) : (
              <SheetTitle className="text-base font-semibold text-foreground">
                {member.name}
              </SheetTitle>
            )}
            <p className="text-sm text-tertiary mt-1">{member.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">group: {formatGroupAlias(member.role)}</Badge>
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
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'effective_access' | 'permissions' | 'quota')}>
          <TabsList>
            <TabsTrigger value="effective_access">{t('effective_access.title')}</TabsTrigger>
            <TabsTrigger value="permissions">{t('permissions.title')}</TabsTrigger>
            <TabsTrigger value="quota">{t('quota.title')}</TabsTrigger>
          </TabsList>

          <TabsContent value="effective_access" className="mt-4 space-y-4">
            <div className="rounded-lg border border-subtle bg-surface p-4" data-testid="member-detail__effective-access-summary">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{t('effective_access.current_state_title')}</p>
                  <p className="mt-1 text-sm text-tertiary">{t('effective_access.current_state_description')}</p>
                </div>
                <Badge variant="outline" data-testid="member-detail__membership-status">
                  {t(`effective_access.membership_status.${effectiveAccessSnapshot?.membership_status ?? 'active'}`)}
                </Badge>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-subtle bg-bg-base/10 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-tertiary">
                    {t('effective_access.membership_status_label')}
                  </p>
                  <p className="mt-2 text-sm text-foreground">
                    {t(`effective_access.membership_status.${effectiveAccessSnapshot?.membership_status ?? 'active'}`)}
                  </p>
                </div>
                <div className="rounded-lg border border-subtle bg-bg-base/10 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-tertiary">
                    {t('effective_access.role_label')}
                  </p>
                  <p className="mt-2 text-sm text-foreground">{formatGroupAlias(member.role)}</p>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-tertiary">
                  {t('effective_access.permissions_label')}
                </p>
                <div className="flex flex-wrap gap-2" data-testid="member-detail__effective-permissions">
                  {(effectiveAccessSnapshot?.effective_permissions ?? permissions?.platform_permissions ?? []).map((permission) => (
                    <Badge key={permission} variant="secondary">
                      {permission}
                    </Badge>
                  ))}
                  {(effectiveAccessSnapshot?.effective_permissions ?? permissions?.platform_permissions ?? []).length === 0 ? (
                    <span className="text-sm text-tertiary">{t('effective_access.no_permissions')}</span>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-tertiary">
                  {t('effective_access.quota_label')}
                </p>
                <div className="flex flex-wrap gap-2" data-testid="member-detail__effective-quotas">
                  {effectiveQuotaEntries.map(({ key, value }) => (
                    <Badge key={key} variant="outline">
                      {key}: {value}
                    </Badge>
                  ))}
                  {effectiveQuotaEntries.length === 0 ? (
                    <span className="text-sm text-tertiary">{t('effective_access.no_quota_overrides')}</span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-subtle bg-surface p-4" data-testid="member-detail__authorization-check">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">{t('effective_access.authorize_title')}</p>
                <p className="text-sm text-tertiary">{t('effective_access.authorize_description')}</p>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="space-y-2">
                  <Label className="text-sm">{t('effective_access.resource_type')}</Label>
                  <Select
                    value={authorizeResourceType}
                    onValueChange={(value) => setAuthorizeResourceType(value as 'project' | 'endpoint' | 'source_library' | 'agent')}
                  >
                    <SelectTrigger data-testid="member-detail__authorize-resource-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="project">project</SelectItem>
                      <SelectItem value="endpoint">endpoint</SelectItem>
                      <SelectItem value="source_library">source_library</SelectItem>
                      <SelectItem value="agent">agent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">{t('effective_access.resource_id')}</Label>
                  <input
                    value={authorizeResourceId}
                    onChange={(event) => setAuthorizeResourceId(event.target.value)}
                    placeholder={t('effective_access.resource_id_placeholder')}
                    className="h-9 w-full rounded-md border border-subtle bg-surface px-3 text-sm text-primary"
                    data-testid="member-detail__authorize-resource-id"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">{t('effective_access.action')}</Label>
                  <input
                    value={authorizeAction}
                    onChange={(event) => setAuthorizeAction(event.target.value)}
                    placeholder={t('effective_access.action_placeholder')}
                    className="h-9 w-full rounded-md border border-subtle bg-surface px-3 text-sm text-primary"
                    data-testid="member-detail__authorize-action"
                  />
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2">
                <Button
                  type="button"
                  variant="action"
                  size="sm"
                  onClick={() => void handleAuthorizationCheck()}
                  disabled={!onRunAuthorizationCheck || isCheckingAuthorization}
                  data-testid="member-detail__authorize-run"
                >
                  {isCheckingAuthorization ? t('effective_access.checking') : t('effective_access.run_check')}
                </Button>
              </div>

              {authorizationCheckResult ? (
                <div className="mt-4 rounded-lg border border-subtle bg-bg-base/10 p-3" data-testid="member-detail__authorize-result">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={authorizationCheckResult.allowed ? 'outline' : 'destructive'}>
                      {authorizationCheckResult.allowed ? t('effective_access.allowed') : t('effective_access.denied')}
                    </Badge>
                    <span className="text-sm text-primary">
                      {t('effective_access.reason_label')}: {authorizationCheckResult.decision.reason}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-tertiary">
                    {t('effective_access.source_label')}: {authorizationCheckResult.decision.source}
                    {authorizationCheckResult.decision.rule_id ? ` · ${authorizationCheckResult.decision.rule_id}` : ''}
                  </p>
                  {authorizationCheckResult.matched_policy ? (
                    <MatchedPolicySummary
                      matchedPolicy={authorizationCheckResult.matched_policy}
                      title={t('effective_access.matched_policy')}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          </TabsContent>

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

        </Tabs>
      </div>
    </>
  );

  if (embedded) {
    return (
      <div className={`flex h-full flex-col overflow-hidden border-l border-subtle bg-surface ${className ?? ''}`}>
        {content}
      </div>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right-wide"
        className="flex flex-col p-0 gap-0 h-full overflow-hidden sm:w-[640px]"
      >
        {content}
      </SheetContent>
    </Sheet>
  );
}

function MatchedPolicySummary({
  matchedPolicy,
  title,
}: {
  matchedPolicy: GovernanceMatchedPolicy;
  title: string;
}) {
  return (
    <div className="mt-3 rounded-lg border border-subtle bg-surface p-3" data-testid="member-detail__matched-policy">
      <p className="text-xs font-medium uppercase tracking-wide text-tertiary">{title}</p>
      <p className="mt-2 text-sm text-foreground">
        {matchedPolicy.resource_type}/{matchedPolicy.resource_id} · {matchedPolicy.access_mode}
      </p>
      {matchedPolicy.matched_subject ? (
        <p className="mt-1 text-sm text-tertiary">
          {matchedPolicy.matched_subject.type}: {matchedPolicy.matched_subject.id}
        </p>
      ) : null}
    </div>
  );
}
