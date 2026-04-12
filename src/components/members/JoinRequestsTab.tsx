'use client';
import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/loading';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { CheckCircle, ShieldCheck, XCircle, Clock, UserPlus } from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { useMemberPageCapabilities } from '@/lib/hooks/use-permissions';
import { useApproveJoinRequest, useRejectJoinRequest } from '@/lib/hooks/use-join-requests';
import { useProjectGroups, useUpdateProjectGroup } from '@/lib/hooks/use-members';
import { projectKeys } from '@/lib/hooks/use-projects-queries';
import { queryKeys } from '@/lib/query-keys';
import { toast } from '@/components/ui/toast';
import { handleErrorForToast } from '@/lib/api/errors';
import type { JoinRequest } from '@/lib/api/endpoints/members';
import { PROJECT_BUILT_IN_GROUP_IDS } from '@/lib/governance/member-groups';

export interface JoinRequestsTabProps {
  workspaceId: string;
  projectId: string;
  requests?: JoinRequest[];
  loading?: boolean;
  onApprove?: (requestId: string) => void;
  onReject?: (requestId: string) => void;
}

export function JoinRequestsTab({
  workspaceId,
  projectId,
  requests = [],
  loading = false,
  onApprove,
  onReject,
}: JoinRequestsTabProps) {
  const t = useTranslations('members.join_requests');
  const { canManage: canApprove } = useMemberPageCapabilities();
  const queryClient = useQueryClient();
  const { data: projectGroups = [] } = useProjectGroups(workspaceId, projectId);
  const updateProjectGroup = useUpdateProjectGroup(workspaceId, projectId);
  const approveMutation = useApproveJoinRequest(workspaceId, projectId);
  const rejectMutation = useRejectJoinRequest(workspaceId, projectId);
  const [rejectDialogOpen, setRejectDialogOpen] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState('');
  const [rejectTarget, setRejectTarget] = React.useState<JoinRequest | null>(null);
  const [elevatingRequestId, setElevatingRequestId] = React.useState<string | null>(null);
  const projectAdminGroup = React.useMemo(
    () => projectGroups.find((group) => group.id === PROJECT_BUILT_IN_GROUP_IDS.admins) ?? null,
    [projectGroups],
  );
  const currentProjectAdmins = React.useMemo(
    () => new Set(projectAdminGroup?.member_ids ?? []),
    [projectAdminGroup],
  );

  const grantProjectAdminMutation = useMutation({
    mutationFn: async (userId: string) => {
      const currentAdmins = Array.from(currentProjectAdmins);
      const nextAdmins = Array.from(new Set([...currentAdmins, userId]));
      return updateProjectGroup.mutateAsync({
        groupId: PROJECT_BUILT_IN_GROUP_IDS.admins,
        data: { member_ids: nextAdmins },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(workspaceId, projectId) });
      void queryClient.invalidateQueries({ queryKey: projectKeys.all(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(workspaceId, projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.list(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.members.list(workspaceId, projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectGroups.list(workspaceId, projectId) });
      toast.success(t('approve_and_grant_success'));
    },
    onError: (error) => handleErrorForToast(error, 'useGrantProjectAdminFromJoinRequests'),
  });

  const handleApprove = React.useCallback((requestId: string) => {
    if (onApprove) {
      onApprove(requestId);
    } else {
      approveMutation.mutate(requestId);
    }
  }, [onApprove, approveMutation]);

  const handleReject = React.useCallback((requestId: string) => {
    if (onReject) {
      onReject(requestId);
    } else {
      const target = requests.find((r) => r.id === requestId) || null;
      setRejectTarget(target);
      setRejectReason('');
      setRejectDialogOpen(true);
    }
  }, [onReject, requests]);

  const handleRejectConfirm = () => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) return;
    rejectMutation.mutate({ requestId: rejectTarget.id, reason: rejectReason.trim() });
    setRejectDialogOpen(false);
  };

  const handleApproveAndGrantProjectAdmin = React.useCallback(async (request: JoinRequest) => {
    setElevatingRequestId(request.id);
    try {
      await approveMutation.mutateAsync(request.id);
      await grantProjectAdminMutation.mutateAsync(request.user_id);
    } finally {
      setElevatingRequestId(null);
    }
  }, [approveMutation, grantProjectAdminMutation]);

  if (loading) {
    return (
      <div className="text-center py-8 text-tertiary">
        <p className="text-sm">{t('loading')}</p>
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <EmptyState
        icon={UserPlus}
        title={t('empty.title')}
        description={t('empty.description')}
      />
    );
  }

  const pendingRequests = requests.filter(r => r.status === 'pending');
  const reviewedRequests = requests.filter(r => r.status !== 'pending');

  return (
    <div className="space-y-6" data-testid="members__join-requests-list">
      {pendingRequests.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-foreground">
            {t('pending_requests')} ({pendingRequests.length})
          </h3>
          <div className="divide-y divide-subtle/70 border-y border-subtle/70">
            {pendingRequests.map((request) => (
              <JoinRequestRow
                key={request.id}
                request={request}
                canApprove={canApprove}
                onApprove={() => handleApprove(request.id)}
                onApproveAndGrantProjectAdmin={() => void handleApproveAndGrantProjectAdmin(request)}
                onReject={() => handleReject(request.id)}
                isProcessing={
                  approveMutation.isPending
                  || rejectMutation.isPending
                  || grantProjectAdminMutation.isPending
                }
                isApprovingAndGranting={elevatingRequestId === request.id}
                isProjectAdmin={currentProjectAdmins.has(request.user_id)}
              />
            ))}
          </div>
        </div>
      )}

      {reviewedRequests.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-foreground">
            {t('reviewed_requests')} ({reviewedRequests.length})
          </h3>
          <div className="divide-y divide-subtle/70 border-y border-subtle/70">
            {reviewedRequests.map((request) => (
              <JoinRequestRow
                key={request.id}
                request={request}
                canApprove={false}
                onApprove={undefined}
                onReject={undefined}
                isProjectAdmin={currentProjectAdmins.has(request.user_id)}
              />
            ))}
          </div>
        </div>
      )}

      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="sm:max-w-[420px]" data-testid="members__join-request-reject-dialog">
          <DialogHeader>
            <DialogTitle>{t('reject_title')}</DialogTitle>
            <DialogDescription>{t('reject_description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t('reject_placeholder')}
              disabled={rejectMutation.isPending}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setRejectDialogOpen(false)}>
                {t('cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={handleRejectConfirm}
                disabled={!rejectReason.trim() || rejectMutation.isPending}
              >
                {t('confirm_reject')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface JoinRequestRowProps {
  request: JoinRequest;
  canApprove: boolean;
  onApprove?: () => void;
  onApproveAndGrantProjectAdmin?: () => void;
  onReject?: () => void;
  isProcessing?: boolean;
  isApprovingAndGranting?: boolean;
  isProjectAdmin?: boolean;
}

function JoinRequestRow({
  request,
  canApprove,
  onApprove,
  onApproveAndGrantProjectAdmin,
  onReject,
  isProcessing = false,
  isApprovingAndGranting = false,
  isProjectAdmin = false,
}: JoinRequestRowProps) {
  const t = useTranslations('members.join_requests');

  const getStatusBadge = () => {
    switch (request.status) {
      case 'pending':
        return (
          <Badge variant="outline" className="text-xs">
            <Clock className="h-3 w-3 mr-1" />
            {t('status.pending')}
          </Badge>
        );
      case 'approved':
        return (
          <Badge variant="default" className="text-xs">
            <CheckCircle className="h-3 w-3 mr-1" />
            {t('status.approved')}
          </Badge>
        );
      case 'rejected':
        return (
          <Badge variant="destructive" className="text-xs">
            <XCircle className="h-3 w-3 mr-1" />
            {t('status.rejected')}
          </Badge>
        );
      default:
        return null;
    }
  };

  return (
    <div
      className="grid gap-4 py-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(220px,0.9fr)] md:items-start"
      data-testid={`members__join-request-row--${request.id}`}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md border border-subtle bg-surface-low text-xs font-medium text-foreground">
          {request.user_name?.[0] || request.user_email?.[0] || '?'}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {request.user_name || request.user_email}
          </p>
          {request.user_name && (
            <p className="truncate text-xs text-tertiary">{request.user_email}</p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {getStatusBadge()}
          {request.status === 'approved' ? (
            <span className="text-xs text-tertiary">{isProjectAdmin ? t('outcome.project_admin') : t('outcome.project_member')}</span>
          ) : null}
        </div>
        {request.reason ? (
          <p className="text-sm leading-6 text-secondary">
            <span className="text-tertiary">{t('reason')}:</span> {request.reason}
          </p>
        ) : null}
        {request.status === 'rejected' && request.reject_reason ? (
          <p className="text-sm leading-6 text-secondary">
            <span className="text-tertiary">{t('reject_reason')}:</span> {request.reject_reason}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-tertiary">
          <span>
            {t('requested_at')}: {formatRelativeTime(request.requested_at)}
          </span>
          {request.reviewed_at && (
            <span>
              {t('reviewed_at')}: {formatRelativeTime(request.reviewed_at)}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {request.status === 'pending' && canApprove ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={onApprove}
              disabled={isProcessing}
              className="gap-2"
              data-testid={`members__join-request-approve--${request.id}`}
            >
              <CheckCircle className="h-4 w-4" />
              {t('approve')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onApproveAndGrantProjectAdmin}
              disabled={isProcessing}
              className="gap-2"
              data-testid={`members__join-request-approve-admin--${request.id}`}
            >
              <ShieldCheck className="h-4 w-4" />
              {isApprovingAndGranting ? t('approve_and_grant_pending') : t('approve_and_grant')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onReject}
              disabled={isProcessing}
              className="gap-2"
              data-testid={`members__join-request-reject--${request.id}`}
            >
              <XCircle className="h-4 w-4" />
              {t('reject')}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
