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
    <div className="space-y-6">
      {/* Pending Requests */}
      {pendingRequests.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-foreground">
            {t('pending_requests')} ({pendingRequests.length})
          </h3>
          <p className="text-xs text-tertiary">{t('pending_help')}</p>
          <div className="grid gap-3 md:grid-cols-2" data-testid="members__join-request-decision-paths">
            <div className="rounded-md border border-subtle bg-surface-high px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-tertiary">{t('approve')}</p>
              <p className="mt-1 text-sm text-secondary">{t('decision_paths.approve')}</p>
            </div>
            <div className="rounded-md border border-subtle bg-surface-high px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-tertiary">{t('approve_and_grant')}</p>
              <p className="mt-1 text-sm text-secondary">{t('decision_paths.approve_and_grant')}</p>
            </div>
          </div>
          <div className="space-y-3">
            {pendingRequests.map((request) => (
              <JoinRequestCard
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

      {/* Reviewed Requests */}
      {reviewedRequests.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-foreground">
            {t('reviewed_requests')} ({reviewedRequests.length})
          </h3>
          <p className="text-xs text-tertiary">{t('reviewed_help')}</p>
          <div className="space-y-3">
            {reviewedRequests.map((request) => (
              <JoinRequestCard
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

interface JoinRequestCardProps {
  request: JoinRequest;
  canApprove: boolean;
  onApprove?: () => void;
  onApproveAndGrantProjectAdmin?: () => void;
  onReject?: () => void;
  isProcessing?: boolean;
  isApprovingAndGranting?: boolean;
  isProjectAdmin?: boolean;
}

function JoinRequestCard({
  request,
  canApprove,
  onApprove,
  onApproveAndGrantProjectAdmin,
  onReject,
  isProcessing = false,
  isApprovingAndGranting = false,
  isProjectAdmin = false,
}: JoinRequestCardProps) {
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
    <div className="border border-border rounded-md p-4 space-y-3" data-testid={`members__join-request-card--${request.id}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-hover flex items-center justify-center text-foreground text-xs font-medium">
            {request.user_name?.[0] || request.user_email?.[0] || '?'}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              {request.user_name || request.user_email}
            </p>
            {request.user_name && (
              <p className="text-xs text-tertiary">{request.user_email}</p>
            )}
          </div>
        </div>
        {getStatusBadge()}
      </div>

      {request.reason && (
        <div className="bg-surface-high rounded-md p-3">
          <p className="text-xs text-tertiary mb-1">{t('reason')}</p>
          <p className="text-sm text-foreground">{request.reason}</p>
        </div>
      )}

      {request.status === 'rejected' && request.reject_reason && (
        <div className="bg-surface-high rounded-md p-3">
          <p className="text-xs text-tertiary mb-1">{t('reject_reason')}</p>
          <p className="text-sm text-foreground">{request.reject_reason}</p>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-tertiary">
        <span>
          {t('requested_at')}: {formatRelativeTime(request.requested_at)}
        </span>
        {request.reviewed_at && (
          <span>
            {t('reviewed_at')}: {formatRelativeTime(request.reviewed_at)}
          </span>
        )}
      </div>

      {request.status === 'approved' && (
        <div className="flex items-center gap-2 rounded-md border border-border/70 bg-surface-high px-3 py-2 text-xs text-secondary">
          {isProjectAdmin ? <ShieldCheck className="h-3.5 w-3.5 text-accent" /> : <CheckCircle className="h-3.5 w-3.5 text-success" />}
          <span>{isProjectAdmin ? t('outcome.project_admin') : t('outcome.project_member')}</span>
        </div>
      )}

      {request.status === 'pending' && canApprove && (
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <Button
            variant="default"
            size="sm"
            onClick={onApprove}
            disabled={isProcessing}
            className="flex-1 gap-2"
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
            className="flex-1 gap-2"
            data-testid={`members__join-request-approve-admin--${request.id}`}
          >
            <ShieldCheck className="h-4 w-4" />
            {isApprovingAndGranting ? t('approve_and_grant_pending') : t('approve_and_grant')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onReject}
            disabled={isProcessing}
            className="flex-1 gap-2"
            data-testid={`members__join-request-reject--${request.id}`}
          >
            <XCircle className="h-4 w-4" />
            {t('reject')}
          </Button>
        </div>
      )}
    </div>
  );
}
