'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { formatExpiry } from './utils';

interface ShareLinkDialogProps {
  creatingShareLink: boolean;
  metaKey: string;
  open: boolean;
  shareExpirySeconds: string;
  shareExpiresAt: string | null;
  shareLinkValue: string | null;
  t: (key: string, values?: Record<string, string>) => string;
  onCopyShareLink: () => void;
  onCreateShareLink: () => void;
  onOpenChange: (open: boolean) => void;
  onShareExpirySecondsChange: (value: string) => void;
}

export function ShareLinkDialog({
  creatingShareLink,
  metaKey,
  open,
  shareExpirySeconds,
  shareExpiresAt,
  shareLinkValue,
  t,
  onCopyShareLink,
  onCreateShareLink,
  onOpenChange,
  onShareExpirySecondsChange,
}: ShareLinkDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="files__dialog__share-link">
        <DialogHeader>
          <DialogTitle>{t('file_manager.share_link')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-tertiary break-all">{metaKey}</div>
          <div className="space-y-1.5">
            <Label htmlFor="share-expiry">{t('file_manager.share_link_expiry')}</Label>
            <Select value={shareExpirySeconds} onValueChange={onShareExpirySecondsChange}>
              <SelectTrigger id="share-expiry" data-testid="files__share-expiry">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="900">{t('file_manager.share_expiry_15m')}</SelectItem>
                <SelectItem value="3600">{t('file_manager.share_expiry_1h')}</SelectItem>
                <SelectItem value="86400">{t('file_manager.share_expiry_24h')}</SelectItem>
                <SelectItem value="604800">{t('file_manager.share_expiry_7d')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" onClick={onCreateShareLink} disabled={creatingShareLink} data-testid="files__share-generate">
              {creatingShareLink ? t('file_manager.generating') : t('file_manager.generate_link')}
            </Button>
            {shareLinkValue ? (
              <Button type="button" variant="outline" onClick={onCopyShareLink} data-testid="files__share-copy">
                {t('file_manager.copy_link')}
              </Button>
            ) : null}
          </div>
          {shareLinkValue ? (
            <div className="space-y-2">
              <Input readOnly value={shareLinkValue} data-testid="files__share-link-value" />
              <div className="text-xs text-tertiary">
                {t('file_manager.share_link_expires_at', { time: formatExpiry(shareExpiresAt ?? '') })}
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
