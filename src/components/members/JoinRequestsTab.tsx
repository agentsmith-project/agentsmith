'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/loading';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { CheckCircle, XCircle, Clock, UserPlus } from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { useCanManageMemberGovernance } from '@/lib/hooks/use-permissions';
import { useApproveJoinRequest, useRejectJoinRequest } from '@/lib/hooks/use-join-requests';
import type { JoinRequest } from '@/lib/api/endpoints/members';

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
  const canApprove = useCanManageMemberGovernance();
  const approveMutation = useApproveJoinRequest(workspaceId, projectId);
  const rejectMutation = useRejectJoinRequest(workspaceId, projectId);
  const [rejectDialogOpen, setRejectDialogOpen] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState('');
  const [rejectTarget, setRejectTarget] = React.useState<JoinRequest | null>(null);

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

  if (loading) {
    return (
      <div className="text-center py-8 text-tertiary">
        <p className="text-sm">Loading join requests...</p>
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
          <div className="space-y-3">
            {pendingRequests.map((request) => (
              <JoinRequestCard
                key={request.id}
                request={request}
                canApprove={canApprove}
                onApprove={() => handleApprove(request.id)}
                onReject={() => handleReject(request.id)}
                isProcessing={approveMutation.isPending || rejectMutation.isPending}
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
          <div className="space-y-3">
            {reviewedRequests.map((request) => (
              <JoinRequestCard
                key={request.id}
                request={request}
                canApprove={false}
                onApprove={undefined}
                onReject={undefined}
              />
            ))}
          </div>
        </div>
      )}

      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
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
  onReject?: () => void;
  isProcessing?: boolean;
}

function JoinRequestCard({
  request,
  canApprove,
  onApprove,
  onReject,
  isProcessing = false,
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
    <div className="border border-border rounded-md p-4 space-y-3">
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

      {request.status === 'pending' && canApprove && (
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <Button
            variant="default"
            size="sm"
            onClick={onApprove}
            disabled={isProcessing}
            className="flex-1 gap-2"
          >
            <CheckCircle className="h-4 w-4" />
            {t('approve')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onReject}
            disabled={isProcessing}
            className="flex-1 gap-2"
          >
            <XCircle className="h-4 w-4" />
            {t('reject')}
          </Button>
        </div>
      )}
    </div>
  );
}
