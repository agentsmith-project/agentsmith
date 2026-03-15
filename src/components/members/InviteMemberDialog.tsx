'use client';

import * as React from 'react';
import { useTranslations, useLocale } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Copy, Loader2, Check, UserPlus } from 'lucide-react';
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
  const [groupTemplate, setGroupTemplate] = React.useState<'admin' | 'developer' | 'user'>('user');
  const [expiresInHours, setExpiresInHours] = React.useState<number>(168); // 7 days
  const [inviteUrl, setInviteUrl] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const createInvite = useCreateInvite(workspaceId, projectId);

  const resetForm = React.useCallback(() => {
    setEmail('');
    setGroupTemplate('user');
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
        group_template: groupTemplate,
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
      <DialogContent className="sm:max-w-[520px]" data-testid="members__invite-dialog">
        <DialogHeader className="space-y-3">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            <UserPlus className="h-3.5 w-3.5" />
            Members
          </div>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('success_description')}</DialogDescription>
        </DialogHeader>

        {inviteUrl ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <p className="text-sm leading-6 text-secondary">{t('success_description')}</p>
            </div>
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
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <p className="text-sm leading-6 text-secondary">
                {t('success_description')}
              </p>
            </div>

            <div className="space-y-2 rounded-2xl border border-white/8 bg-white/[0.02] p-4">
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

            <div className="space-y-2 rounded-2xl border border-white/8 bg-white/[0.02] p-4">
              <Label htmlFor="invite-group">{t('group_label')}</Label>
              <Select
                value={groupTemplate}
                onValueChange={(v) => setGroupTemplate(v as 'admin' | 'developer' | 'user')}
                disabled={createInvite.isPending}
              >
                <SelectTrigger id="invite-group" className="rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{t('group_admin')}</SelectItem>
                  <SelectItem value="developer">{t('group_developer')}</SelectItem>
                  <SelectItem value="user">{t('group_user')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 rounded-2xl border border-white/8 bg-white/[0.02] p-4">
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
