'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { JSONViewer } from './JSONViewer';
import { Copy } from 'lucide-react';
import { toast } from '@/components/ui/toast';
import type { AuditEvent } from '@/lib/api/types';

export interface AuditDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: AuditEvent | null;
}

function formatFullTimestamp(timestamp: string): string {
  return new Date(timestamp).toISOString();
}

export function AuditDetailDrawer({
  open,
  onOpenChange,
  event,
}: AuditDetailDrawerProps) {
  const t = useTranslations('common.toast');
  if (!event) return null;

  const handleCopyRequestId = () => {
    navigator.clipboard.writeText(event.request_id);
    toast.success(t('copied'));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Audit Event Details</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Basic Info Card */}
          <div className="bg-surface border border-border rounded-md p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-tertiary">Timestamp</span>
              <span className="text-sm text-foreground font-mono">
                {formatFullTimestamp(event.timestamp)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-tertiary">Action</span>
              <Badge variant="outline">{event.action}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-tertiary">Actor</span>
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    event.actor_type === 'user'
                      ? 'default'
                      : event.actor_type === 'agent'
                        ? 'secondary'
                        : 'outline'
                  }
                >
                  {event.actor_type}
                </Badge>
                <span className="text-sm text-foreground font-mono">{event.actor_id}</span>
              </div>
            </div>
            {event.end_user_id && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-tertiary">End User</span>
                <span className="text-sm text-foreground font-mono">{event.end_user_id}</span>
              </div>
            )}
            {event.resource_type && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-tertiary">Resource</span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{event.resource_type}</Badge>
                  {event.resource_id && (
                    <span className="text-sm text-foreground font-mono">
                      {event.resource_id}
                    </span>
                  )}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-tertiary">Result</span>
              <Badge variant={event.result === 'ok' ? 'default' : 'destructive'}>
                {event.result === 'ok' ? 'Success' : 'Error'}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-tertiary">Request ID</span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-foreground font-mono">{event.request_id}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopyRequestId}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>

          {/* Error Info Card */}
          {event.result === 'error' && (
            <div className="bg-surface border border-border rounded-md p-4 space-y-2">
              <h4 className="text-sm font-semibold text-foreground">Error Information</h4>
              {event.error_code && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-tertiary">Error Code:</span>
                  <Badge variant="destructive">{event.error_code}</Badge>
                </div>
              )}
              {event.error_message && (
                <div>
                  <span className="text-sm text-tertiary">Error Message:</span>
                  <p className="text-sm text-foreground mt-1">{event.error_message}</p>
                </div>
              )}
            </div>
          )}

          {/* Metadata JSON Card */}
          <JSONViewer data={event.metadata_json || {}} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
