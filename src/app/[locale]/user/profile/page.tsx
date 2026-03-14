'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { User, Mail, Bot, Save, Globe2, BriefcaseBusiness, ShieldCheck } from 'lucide-react';
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
  const completionScore = React.useMemo(() => {
    const fields = [
      displayName,
      bio,
      jobTitle,
      company,
      timezone,
      locale,
      greetingPreference,
      interestsStr,
    ];
    const completed = fields.filter((value) => value.trim().length > 0).length;
    return `${completed}/${fields.length}`;
  }, [bio, company, displayName, greetingPreference, interestsStr, jobTitle, locale, timezone]);

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
      <PageLayout>
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-4 md:px-5 md:py-5">
          <section className="rounded-2xl border border-border bg-surface px-5 py-5 shadow-sm shadow-black/10 md:px-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex flex-col gap-4">
                <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
                  <Bot className="h-3.5 w-3.5" />
                  {t('summary_badge')}
                </div>
                <div className="flex items-center gap-4">
                  <Avatar className="h-16 w-16 border border-border/70">
                    {user.avatar ? (
                      <AvatarImage src={user.avatar} alt={user.name} />
                    ) : (
                      <AvatarFallback className="bg-surface-high text-xl text-foreground">
                        {getInitials(user.name)}
                      </AvatarFallback>
                    )}
                  </Avatar>
                  <div>
                    <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
                    <p className="mt-1 text-sm text-tertiary">{t('description')}</p>
                    <div className="mt-2 flex items-center gap-2 text-sm text-secondary">
                      <Mail className="h-3.5 w-3.5" />
                      {user.email}
                    </div>
                  </div>
                </div>
                <p className="max-w-2xl text-sm leading-6 text-secondary">{t('summary_intro')}</p>
              </div>
              <Button
                variant="action"
                onClick={handleSave}
                disabled={saveMutation.isPending || isLoading}
                className="gap-2 self-start"
                data-testid="profile__save-btn"
              >
                <Save className="w-4 h-4" />
                {saveMutation.isPending ? t('saving') : t('save')}
              </Button>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-border/70 bg-surface-high p-4">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-secondary">
                  <User className="h-3.5 w-3.5 text-accent" />
                  {t('summary_completion_label')}
                </div>
                <div className="mt-3 text-2xl font-semibold text-foreground">{completionScore}</div>
                <p className="mt-1 text-sm text-tertiary">{t('summary_completion_hint')}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-surface-high p-4">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-secondary">
                  <BriefcaseBusiness className="h-3.5 w-3.5 text-accent" />
                  {t('summary_work_label')}
                </div>
                <div className="mt-3 text-base font-semibold text-foreground">
                  {jobTitle.trim() || company.trim() || t('summary_work_empty')}
                </div>
                <p className="mt-1 text-sm text-tertiary">{t('summary_work_hint')}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-surface-high p-4">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-secondary">
                  <ShieldCheck className="h-3.5 w-3.5 text-accent" />
                  {t('summary_context_label')}
                </div>
                <div className="mt-3 text-base font-semibold text-foreground">
                  {hasContext ? t('summary_context_ready') : t('summary_context_empty')}
                </div>
                <p className="mt-1 text-sm text-tertiary">{t('summary_context_hint')}</p>
              </div>
            </div>
          </section>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.95fr)]">
            <div className="space-y-5">
              <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
                <div className="flex gap-3">
                  <Bot className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                  <div>
                    <h3 className="mb-1 text-sm font-medium text-foreground">{t('agent_disclosure_title')}</h3>
                    <p className="text-sm leading-6 text-tertiary">{t('agent_disclosure')}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm shadow-black/10" data-testid="profile__form">
                <h2 className="mb-4 flex items-center gap-2 text-base font-medium text-foreground">
                  <User className="h-4 w-4 text-icon-default" />
                  {t('basic_info')}
                </h2>
                <div className="mb-6 rounded-xl border border-border/70 bg-surface-high px-4 py-4">
                  <p className="text-sm text-tertiary">{t('account_name_label')}</p>
                  <p className="mt-1 font-medium text-foreground">{user.name}</p>
                  <div className="mt-2 flex items-center gap-2 text-sm text-tertiary">
                    <Mail className="h-3.5 w-3.5" />
                    {user.email}
                  </div>
                </div>

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
              </div>

              <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm shadow-black/10">
                <h2 className="mb-4 flex items-center gap-2 text-base font-medium text-foreground">
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
            </div>

            <div className="space-y-5">
              <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm shadow-black/10">
                <h2 className="mb-4 flex items-center gap-2 text-base font-medium text-foreground">
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

              <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm shadow-black/10" data-testid="profile__permission-tokens">
                <h2 className="mb-1 text-base font-medium text-foreground">
                  {t('permission_tokens_title')}
                </h2>
                <p className="mb-4 text-sm text-tertiary">{t('permission_tokens_description')}</p>
                {!hasContext ? (
                  <div className="rounded-xl border border-dashed border-border bg-surface-high/70 px-4 py-5 text-sm text-tertiary">
                    {t('permission_tokens_context_hint')}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <p className="mb-2 text-xs text-secondary">{t('workspace_permissions')}</p>
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
                    <div>
                      <p className="mb-2 text-xs text-secondary">{t('project_permissions')}</p>
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
              </div>
            </div>
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}
