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
import type { Member } from '@/lib/api/endpoints/members';
import type { MemberPermissions, PermissionTemplate } from '@/lib/api/types';
import type {
  GovernanceAuthorizationResponse,
  GovernanceEffectiveAccessSnapshot,
  GovernanceMatchedPolicy,
} from '@/lib/api/endpoints/governance-explainability';

export interface MemberDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: Member | null;
  permissions?: MemberPermissions;
  projectGovernance?: Record<string, unknown>;
  _workspaceId?: string;
  _projectId?: string;
  permissionTemplates?: PermissionTemplate[];
  effectiveAccessSnapshot?: GovernanceEffectiveAccessSnapshot | null;
  authorizationCheckResult?: GovernanceAuthorizationResponse | null;
  isCheckingAuthorization?: boolean;
  onRunAuthorizationCheck?: (payload: {
    resourceType: 'endpoint';
    resourceId: string;
    action: string;
  }) => Promise<unknown>;
  onSavePermissions?: (permissions: string[], mode: 'template' | 'custom', template?: string) => void;
  onViewHistory?: () => void;
  initialAuthorization?: {
    resourceType: 'endpoint';
    resourceId: string;
    action: string;
  };
  embedded?: boolean;
  className?: string;
}

function formatGroupAlias(role: string): string {
  switch (role) {
    case 'owner':
      return 'governance';
    case 'admin':
      return 'manager';
    case 'developer':
      return 'developer';
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
  effectiveAccessSnapshot,
  authorizationCheckResult,
  isCheckingAuthorization = false,
  onRunAuthorizationCheck,
  onViewHistory,
  initialAuthorization,
  embedded = false,
  className,
}: MemberDetailDrawerProps) {
  const t = useTranslations('members');
  const [authorizeResourceType, setAuthorizeResourceType] = React.useState<'endpoint'>('endpoint');
  const [authorizeResourceId, setAuthorizeResourceId] = React.useState('');
  const [authorizeAction, setAuthorizeAction] = React.useState('read');

  React.useEffect(() => {
    if (!open || !member || !initialAuthorization) return;
    setAuthorizeResourceType(initialAuthorization.resourceType);
    setAuthorizeResourceId(initialAuthorization.resourceId);
    setAuthorizeAction(initialAuthorization.action);
  }, [initialAuthorization, member, open]);

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

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
        <Tabs value="effective_access">
          <TabsList>
            <TabsTrigger value="effective_access">{t('effective_access.title')}</TabsTrigger>
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
                    onValueChange={(value) => setAuthorizeResourceType(value as 'endpoint')}
                  >
                    <SelectTrigger data-testid="member-detail__authorize-resource-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="endpoint">endpoint</SelectItem>
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
