'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { User, Mail, Bot, Save } from 'lucide-react';
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
  const queryClient = useQueryClient();
  const api = React.useMemo(() => new MeAPI(getApiClient()), []);

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
        <div className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
      <p className="text-sm text-tertiary">{t('description')}</p>

      {/* Agent Disclosure */}
      <div className="rounded-lg border border-accent/30 bg-accent/5 p-4 flex gap-3">
        <Bot className="w-5 h-5 text-accent shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-medium text-foreground mb-1">
            {t('agent_disclosure_title')}
          </h3>
          <p className="text-sm text-tertiary">{t('agent_disclosure')}</p>
        </div>
      </div>

      {/* Basic Info from Auth */}
      <div className="p-6 rounded-md border border-border bg-surface">
        <h2 className="text-base font-medium text-foreground mb-4 flex items-center gap-2">
          <User className="w-4 h-4 text-icon-default" />
          {t('basic_info')}
        </h2>
        <div className="flex items-center gap-4 mb-6">
          <Avatar className="w-16 h-16">
            {user.avatar ? (
              <AvatarImage src={user.avatar} alt={user.name} />
            ) : (
              <AvatarFallback className="text-foreground text-xl bg-surface-high border border-subtle">
                {getInitials(user.name)}
              </AvatarFallback>
            )}
          </Avatar>
          <div>
            <p className="text-sm text-tertiary">Account name</p>
            <p className="font-medium text-foreground">{user.name}</p>
            <div className="flex items-center gap-2 mt-1 text-sm text-tertiary">
              <Mail className="w-3.5 h-3.5" />
              {user.email}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-primary mb-2">
              {t('display_name')}
            </label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t('display_name_placeholder')}
              className="bg-surface-high"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-primary mb-2">
              {t('bio')}
            </label>
            <Textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder={t('bio_placeholder')}
              rows={3}
              className="bg-surface-high resize-none"
            />
          </div>
        </div>
      </div>

      {/* Work Info */}
      <div className="p-6 rounded-md border border-border bg-surface">
        <h2 className="text-base font-medium text-foreground mb-4">
          {t('work_info')}
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-primary mb-2">
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
            <label className="block text-sm font-medium text-primary mb-2">
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

      {/* Preferences */}
      <div className="p-6 rounded-md border border-border bg-surface">
        <h2 className="text-base font-medium text-foreground mb-4">
          {t('preferences')}
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-primary mb-2">
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
            <label className="block text-sm font-medium text-primary mb-2">
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
            <label className="block text-sm font-medium text-primary mb-2">
              {t('greeting_preference')}
            </label>
            <select
              value={greetingPreference}
              onChange={(e) => setGreetingPreference(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-subtle bg-surface-high text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
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
            <label className="block text-sm font-medium text-primary mb-2">
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

      <div className="flex justify-end">
        <Button
          variant="action"
          onClick={handleSave}
          disabled={saveMutation.isPending || isLoading}
          className="gap-2"
        >
          <Save className="w-4 h-4" />
          {saveMutation.isPending ? t('saving') : t('save')}
        </Button>
      </div>
        </div>
      </PageLayout>
    </PageState>
  );
}
