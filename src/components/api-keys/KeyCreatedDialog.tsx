'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Copy, Key, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';

interface KeyCreatedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Full key value - shown only once, user must copy */
  keyValue: string | null;
  keyPrefix?: string;
  scope?: 'user' | 'project';
}

export function KeyCreatedDialog({
  open,
  onOpenChange,
  keyValue,
  keyPrefix,
  scope: _scope = 'user',
}: KeyCreatedDialogProps) {
  const t = useTranslations('user_keys');
  const commonT = useTranslations('common');
  const [copied, setCopied] = React.useState(false);

  const displayValue = (keyValue || keyPrefix || '').trim();

  const handleCopy = async () => {
    if (!keyValue) return;
    try {
      await navigator.clipboard.writeText(keyValue);
      setCopied(true);
      toast.success(commonT('copied'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(commonT('copy_failed'));
    }
  };

  const handleClose = () => {
    setCopied(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]" onPointerDownOutside={(e) => e.preventDefault()} data-testid="api-keys__key-created-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="w-5 h-5 text-accent" />
            {t('create_success_title')}
          </DialogTitle>
          <DialogDescription>{t('create_success_hint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2.5 bg-surface-high border border-subtle rounded-sm text-sm font-mono text-primary break-all">
              {displayValue}
            </code>
            <Button
              variant="outline"
              size="icon"
              onClick={handleCopy}
              disabled={!keyValue}
              className="flex-shrink-0"
              aria-label={commonT('copy')}
            >
              {copied ? (
                <Check className="w-4 h-4 text-success" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </Button>
          </div>
          {!keyValue && keyPrefix && (
            <p className="text-xs text-tertiary">
              Full key was not returned by the API. Use the prefix above to identify this key.
            </p>
          )}
        </div>
        <div className="flex justify-end">
          <Button variant="action" onClick={handleClose}>
            {commonT('confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
