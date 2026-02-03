'use client';

import * as React from 'react';
import { useTranslations, useLocale } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Copy, Loader2, Check } from 'lucide-react';
import { useCreateInvite } from '@/lib/hooks/use-members';

export interface InviteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
}

export function InviteMemberDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
}: InviteMemberDialogProps) {
  const t = useTranslations('members.invite');
  const locale = useLocale();
  const [email, setEmail] = React.useState('');
  const [roleTemplate, setRoleTemplate] = React.useState<'developer' | 'user'>('user');
  const [expiresInHours, setExpiresInHours] = React.useState<number>(168); // 7 days
  const [inviteUrl, setInviteUrl] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const createInvite = useCreateInvite(workspaceId, projectId);

  const resetForm = React.useCallback(() => {
    setEmail('');
    setRoleTemplate('user');
    setExpiresInHours(168);
    setInviteUrl(null);
    setCopied(false);
  }, []);

  React.useEffect(() => {
    if (open) {
      resetForm();
    }
  }, [open, resetForm]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    try {
      const result = await createInvite.mutateAsync({
        email: email.trim(),
        role_template: roleTemplate,
        expires_in_hours: expiresInHours,
      });
      const path = result.invite_url.startsWith('/') ? result.invite_url.slice(1) : result.invite_url;
      const fullUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}/${locale}/${path}`
          : `/${locale}/${path}`;
      setInviteUrl(fullUrl);
    } catch {
      // Error handled by hook
    }
  };

  const handleCopy = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const input = document.createElement('input');
      input.value = inviteUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    resetForm();
  };

  const handleCreateAnother = () => {
    resetForm();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>

        {inviteUrl ? (
          <div className="space-y-4">
            <p className="text-sm text-tertiary">{t('success_description')}</p>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-high p-3">
              <Input
                readOnly
                value={inviteUrl}
                className="flex-1 font-mono text-xs bg-transparent border-0"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                className="gap-2 shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 text-success" />
                    {t('copied')}
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    {t('copy_link')}
                  </>
                )}
              </Button>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={handleCreateAnother}>
                {t('create_another')}
              </Button>
              <Button variant="default" onClick={handleClose}>
                {t('done')}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">{t('email_label')}</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder={t('email_placeholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={createInvite.isPending}
                className="rounded-lg"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite-role">{t('role_label')}</Label>
              <Select
                value={roleTemplate}
                onValueChange={(v) => setRoleTemplate(v as 'developer' | 'user')}
                disabled={createInvite.isPending}
              >
                <SelectTrigger id="invite-role" className="rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="developer">{t('role_developer')}</SelectItem>
                  <SelectItem value="user">{t('role_user')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite-expires">{t('expires_label')}</Label>
              <Select
                value={expiresInHours.toString()}
                onValueChange={(v) => setExpiresInHours(parseInt(v, 10))}
                disabled={createInvite.isPending}
              >
                <SelectTrigger id="invite-expires" className="rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24">{t('expires_24h')}</SelectItem>
                  <SelectItem value="72">{t('expires_72h')}</SelectItem>
                  <SelectItem value="168">{t('expires_7d')}</SelectItem>
                  <SelectItem value="336">{t('expires_14d')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="ghost" onClick={handleClose}>
                {t('cancel')}
              </Button>
              <Button
                type="submit"
                variant="default"
                disabled={!email.trim() || createInvite.isPending}
                className="gap-2"
              >
                {createInvite.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('creating')}
                  </>
                ) : (
                  t('create_invite')
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
