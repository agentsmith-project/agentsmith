'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { User, Mail, Save, Globe2, BriefcaseBusiness, ShieldCheck } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/authStore';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MeAPI, getApiClient } from '@/lib/api';
import { MemberAPI } from '@/lib/api/endpoints/members';
import { useWorkspaceMembers } from '@/lib/hooks/use-workspaces';
import { handleErrorForToast } from '@/lib/api';
import { toast } from '@/components/ui/toast';

const GREETING_OPTIONS = [
  { value: 'formal', labelKey: 'formal' },
  { value: 'casual', labelKey: 'casual' },
  { value: 'friendly', labelKey: 'friendly' },
  { value: 'professional', labelKey: 'professional' },
] as const;

export default function ProfilePage() {
  const t = useTranslations('profile');
  const user = useAuthStore((state) => state.user);
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const api = React.useMemo(() => new MeAPI(getApiClient()), []);
  const memberApi = React.useMemo(() => new MemberAPI(getApiClient()), []);
  const contextWorkspaceId = searchParams.get('workspace') ?? '';
  const contextProjectId = searchParams.get('project') ?? '';
  const { data: contextMembers = [] } = useWorkspaceMembers(contextWorkspaceId);

  const [displayName, setDisplayName] = React.useState('');
  const [bio, setBio] = React.useState('');
  const [jobTitle, setJobTitle] = React.useState('');
  const [company, setCompany] = React.useState('');
  const [timezone, setTimezone] = React.useState('');
  const [locale, setLocale] = React.useState('');
  const [greetingPreference, setGreetingPreference] = React.useState('');
  const [interestsStr, setInterestsStr] = React.useState('');

  const { data: profile, isLoading } = useQuery({
    queryKey: ['me', 'profile'],
    queryFn: () => api.getProfile(),
  });
  const { data: contextMembership } = useQuery({
    queryKey: ['profile', 'context-membership', contextWorkspaceId, contextProjectId, user?.id],
    queryFn: () => memberApi.getMembership(contextWorkspaceId, contextProjectId, user?.id ?? ''),
    enabled: Boolean(contextWorkspaceId && contextProjectId && user?.id),
  });

  React.useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name ?? '');
      setBio(profile.bio ?? '');
      setJobTitle(profile.job_title ?? '');
      setCompany(profile.company ?? '');
      setTimezone(profile.timezone ?? '');
      setLocale(profile.locale ?? '');
      setGreetingPreference(profile.greeting_preference ?? '');
      setInterestsStr((profile.interests ?? []).join(', '));
    }
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.updateProfile({
        display_name: displayName || undefined,
        bio: bio || undefined,
        job_title: jobTitle || undefined,
        company: company || undefined,
        timezone: timezone || undefined,
        locale: locale || undefined,
        greeting_preference: greetingPreference || undefined,
        interests: interestsStr
          ? interestsStr.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me', 'profile'] });
      toast.success(t('saved'));
    },
    onError: (err) => handleErrorForToast(err, 'ProfilePage.save'),
  });

  const handleSave = () => saveMutation.mutate();
  const workspacePermissions = React.useMemo<readonly string[]>(() => {
    if (!contextWorkspaceId || !user?.id) return [];
    const member = contextMembers.find((item) => item.user_id === user.id);
    return member?.permissions ?? [];
  }, [contextMembers, contextWorkspaceId, user?.id]);
  const projectPermissions = React.useMemo<readonly string[]>(
    () => contextMembership?.permissions ?? [],
    [contextMembership],
  );
  const hasContext = Boolean(contextWorkspaceId && contextProjectId);

  if (!user) {
    return (
      <PageState state="loading">
        <PageLoading />
      </PageState>
    );
  }

  const getInitials = (name: string) =>
    name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

  return (
    <PageState state="success">
      <PageLayout contentWidth="narrow">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-4 md:px-5 md:py-5">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
            <p className="text-sm text-tertiary">{t('description')}</p>
          </div>

          <section className="rounded-md border border-subtle bg-surface p-4" data-testid="profile__form">
            <div className="flex items-start justify-between gap-4 border-b border-subtle/60 pb-4">
              <div className="flex min-w-0 items-start gap-3">
                <Avatar className="h-12 w-12 border border-border/70">
                  {user.avatar ? (
                    <AvatarImage src={user.avatar} alt={user.name} />
                  ) : (
                    <AvatarFallback className="bg-surface-high text-base text-foreground">
                      {getInitials(user.name)}
                    </AvatarFallback>
                  )}
                </Avatar>
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 text-base font-medium text-foreground">
                    <User className="h-4 w-4 text-icon-default" />
                    {t('basic_info')}
                  </h2>
                  <p className="mt-1 text-sm text-tertiary">{t('account_name_label')}</p>
                  <p className="mt-1 font-medium text-foreground">{user.name}</p>
                  <div className="mt-2 flex items-center gap-2 text-sm text-tertiary">
                    <Mail className="h-3.5 w-3.5" />
                    {user.email}
                  </div>
                </div>
              </div>
              <Button
                variant="action"
                onClick={handleSave}
                disabled={saveMutation.isPending || isLoading}
                className="gap-2"
                data-testid="profile__save-btn"
              >
                <Save className="w-4 h-4" />
                {saveMutation.isPending ? t('saving') : t('save')}
              </Button>
            </div>

            <div className="space-y-5 pt-4">
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-primary">
                    {t('display_name')}
                  </label>
                  <Input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={t('display_name_placeholder')}
                    className="bg-surface-high"
                    data-testid="profile__display-name"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-primary">
                    {t('bio')}
                  </label>
                  <Textarea
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder={t('bio_placeholder')}
                    rows={4}
                    className="resize-none bg-surface-high"
                    data-testid="profile__bio"
                  />
                </div>
              </div>

              <div className="space-y-4 border-t border-subtle/60 pt-5">
                <h2 className="flex items-center gap-2 text-base font-medium text-foreground">
                  <BriefcaseBusiness className="h-4 w-4 text-icon-default" />
                  {t('work_info')}
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-primary">
                      {t('job_title')}
                    </label>
                    <Input
                      value={jobTitle}
                      onChange={(e) => setJobTitle(e.target.value)}
                      placeholder={t('job_title_placeholder')}
                      className="bg-surface-high"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-primary">
                      {t('company')}
                    </label>
                    <Input
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      placeholder={t('company_placeholder')}
                      className="bg-surface-high"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4 border-t border-subtle/60 pt-5">
                <h2 className="flex items-center gap-2 text-base font-medium text-foreground">
                  <Globe2 className="h-4 w-4 text-icon-default" />
                  {t('preferences')}
                </h2>
                <div className="space-y-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-primary">
                      {t('timezone')}
                    </label>
                    <Input
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      placeholder={t('timezone_placeholder')}
                      className="bg-surface-high"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-primary">
                      {t('locale')}
                    </label>
                    <Input
                      value={locale}
                      onChange={(e) => setLocale(e.target.value)}
                      placeholder="en-US"
                      className="bg-surface-high"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-primary">
                      {t('greeting_preference')}
                    </label>
                    <select
                      value={greetingPreference}
                      onChange={(e) => setGreetingPreference(e.target.value)}
                      className="h-10 w-full rounded-md border border-subtle bg-surface-high px-3 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                    >
                      <option value="">—</option>
                      {GREETING_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {t(`greeting_preference_options.${opt.labelKey}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-primary">
                      {t('interests')}
                    </label>
                    <Input
                      value={interestsStr}
                      onChange={(e) => setInterestsStr(e.target.value)}
                      placeholder={t('interests_placeholder')}
                      className="bg-surface-high"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-md border border-subtle bg-surface p-4" data-testid="profile__permissions">
            <h2 className="mb-1 flex items-center gap-2 text-base font-medium text-foreground">
              <ShieldCheck className="h-4 w-4 text-icon-default" />
              {t('permission_tokens_title')}
            </h2>
            <p className="mb-4 text-sm text-tertiary">{t('permission_tokens_description')}</p>
            {!hasContext ? (
              <div className="rounded-md border border-dashed border-border bg-surface-high/70 px-4 py-5 text-sm text-tertiary">
                {t('permission_tokens_context_hint')}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs text-secondary">{t('workspace_permissions')}</p>
                  {workspacePermissions.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {workspacePermissions.map((permission: string) => (
                        <span
                          key={`profile-workspace-${permission}`}
                          className="rounded-sm border border-subtle bg-surface-high px-2 py-1 text-[11px] font-mono text-foreground"
                        >
                          {permission}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-tertiary">{t('no_permissions')}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-secondary">{t('project_permissions')}</p>
                  {projectPermissions.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {projectPermissions.map((permission: string) => (
                        <span
                          key={`profile-project-${permission}`}
                          className="rounded-sm border border-subtle bg-surface-high px-2 py-1 text-[11px] font-mono text-foreground"
                        >
                          {permission}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-tertiary">{t('no_permissions')}</p>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </PageLayout>
    </PageState>
  );
}
