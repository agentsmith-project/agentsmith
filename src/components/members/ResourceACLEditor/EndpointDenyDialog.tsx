'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateResourceACL } from '@/lib/hooks/use-members';
import type { Endpoint } from '@/lib/api/types';

export interface EndpointDenyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  endpoint: Endpoint;
  workspaceId: string;
  projectId: string;
  memberId: string;
  memberName: string;
  onSuccess?: () => void;
}

export function EndpointDenyDialog({
  open,
  onOpenChange,
  endpoint,
  workspaceId,
  projectId,
  memberId,
  memberName,
  onSuccess,
}: EndpointDenyDialogProps) {
  const t = useTranslations('members.acl');
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const { mutate: updateACL, isPending } = useUpdateResourceACL(
    workspaceId,
    projectId,
    'endpoint',
    endpoint.id
  );

  const handleSubmit = React.useCallback(() => {
    if (!reason.trim()) {
      setError(t('endpoint.reason_required'));
      return;
    }

    updateACL(
      {
        ops: [
          {
            op: 'deny',
            subject_type: 'user',
            subject_id: memberId,
            permissions: ['endpoint:use'],
            reason: reason.trim(),
          },
        ],
      },
      {
        onSuccess: () => {
          setReason('');
          setError(null);
          onOpenChange(false);
          onSuccess?.();
        },
        onError: (err) => {
          setError(err instanceof Error ? err.message : 'Failed to deny access');
        },
      }
    );
  }, [reason, updateACL, memberId, onOpenChange, onSuccess, t]);

  const handleCancel = React.useCallback(() => {
    setReason('');
    setError(null);
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t('endpoint.deny')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-sm text-tertiary">Endpoint</Label>
            <p className="text-sm font-medium text-foreground mt-1">{endpoint.name}</p>
          </div>

          <div>
            <Label className="text-sm text-tertiary">User</Label>
            <p className="text-sm font-medium text-foreground mt-1">{memberName}</p>
          </div>

          <div>
            <Label htmlFor="reason" className="text-sm text-foreground">
              {t('endpoint.reason_required')}
            </Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
              placeholder='e.g., "Abuse detected", "Quota exceeded"'
              className="mt-2"
              rows={3}
            />
            {error && (
              <p className="text-xs text-error mt-1">{error}</p>
            )}
          </div>

          <div className="rounded-md bg-warning/10 border border-warning/30 p-3">
            <p className="text-xs text-foreground">
              This will prevent the user from using this endpoint via OpenAI Chat or Agent Workbench.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={isPending || !reason.trim()}>
            {isPending ? 'Processing...' : 'Confirm Deny'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
