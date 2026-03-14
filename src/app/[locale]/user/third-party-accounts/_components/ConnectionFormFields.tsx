'use client';

import { Plus, Trash2 } from 'lucide-react';

import type {
  UserExternalConnectionFieldInput,
  UserExternalConnectionKind,
  UserExternalConnectionProvider,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

import {
  allowedKindsForProvider,
  CREATE_PROVIDERS,
  KINDS,
  PROVIDERS,
} from '../third-party-accounts-utils';

interface ConnectionFormFieldsProps {
  createEmptyField: () => UserExternalConnectionFieldInput;
  customDomain: string;
  displayName: string;
  editing: boolean;
  fields: UserExternalConnectionFieldInput[];
  gitHost: string;
  githubApiBaseUrl: string;
  githubToken: string;
  jiraApiToken: string;
  jiraBaseUrl: string;
  kind: UserExternalConnectionKind;
  note: string;
  provider: UserExternalConnectionProvider;
  sshPrivateKey: string;
  sshPublicKey: string;
  t: (key: string) => string;
  onCustomDomainChange: (value: string) => void;
  onDisplayNameChange: (value: string) => void;
  onFieldsChange: (value: UserExternalConnectionFieldInput[]) => void;
  onGitHostChange: (value: string) => void;
  onGithubApiBaseUrlChange: (value: string) => void;
  onGithubTokenChange: (value: string) => void;
  onJiraApiTokenChange: (value: string) => void;
  onJiraBaseUrlChange: (value: string) => void;
  onKindChange: (value: UserExternalConnectionKind) => void;
  onNoteChange: (value: string) => void;
  onProviderChange: (value: UserExternalConnectionProvider) => void;
  onSshPrivateKeyChange: (value: string) => void;
  onSshPublicKeyChange: (value: string) => void;
}

export function ConnectionFormFields({
  createEmptyField,
  customDomain,
  displayName,
  editing,
  fields,
  gitHost,
  githubApiBaseUrl,
  githubToken,
  jiraApiToken,
  jiraBaseUrl,
  kind,
  note,
  provider,
  sshPrivateKey,
  sshPublicKey,
  t,
  onCustomDomainChange,
  onDisplayNameChange,
  onFieldsChange,
  onGitHostChange,
  onGithubApiBaseUrlChange,
  onGithubTokenChange,
  onJiraApiTokenChange,
  onJiraBaseUrlChange,
  onKindChange,
  onNoteChange,
  onProviderChange,
  onSshPrivateKeyChange,
  onSshPublicKeyChange,
}: ConnectionFormFieldsProps) {
  return (
    <div className="space-y-4 py-4">
      <div className="rounded-xl border border-border/70 bg-surface-high p-4">
        <div className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-secondary">
          {t('section_connection_title')}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('provider_label')}</label>
            <select
              value={provider}
              onChange={(event) => onProviderChange(event.target.value as UserExternalConnectionProvider)}
              disabled={editing}
              aria-label={t('provider_label')}
              className="w-full h-10 rounded-md border border-subtle bg-background px-3 text-sm text-primary"
            >
              {(editing ? PROVIDERS : CREATE_PROVIDERS).map((item) => (
                <option key={item.value} value={item.value}>{t(item.labelKey)}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('kind_label')}</label>
            <select
              value={kind}
              onChange={(event) => onKindChange(event.target.value as UserExternalConnectionKind)}
              disabled={editing || provider === 'feishu'}
              aria-label={t('kind_label')}
              className="w-full h-10 rounded-md border border-subtle bg-background px-3 text-sm text-primary"
            >
              {KINDS.filter((item) => allowedKindsForProvider(provider).includes(item.value)).map((item) => (
                <option key={item.value} value={item.value}>{t(item.labelKey)}</option>
              ))}
            </select>
          </div>

          {provider === 'custom' ? (
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium">{t('custom_domain_label')}</label>
              <Input
                aria-label={t('custom_domain_label')}
                value={customDomain}
                onChange={(event) => onCustomDomainChange(event.target.value)}
                placeholder={t('custom_domain_placeholder')}
                className="bg-background"
              />
            </div>
          ) : null}

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">{t('display_name_label')}</label>
            <Input
              aria-label={t('display_name_label')}
              value={displayName}
              onChange={(event) => onDisplayNameChange(event.target.value)}
              placeholder={t('display_name_placeholder')}
              className="bg-background"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">{t('note_label')}</label>
            <Textarea
              aria-label={t('note_label')}
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
              rows={2}
              placeholder={t('note_placeholder')}
              className="bg-background"
            />
          </div>
        </div>
      </div>

      {provider === 'jira' ? (
        <div className="rounded-xl border border-border/70 bg-surface-high p-4">
          <div className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-secondary">
            {t('section_credentials_title')}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium">{t('jira_base_url_label')}</label>
              <Input
                aria-label={t('jira_base_url_label')}
                value={jiraBaseUrl}
                onChange={(event) => onJiraBaseUrlChange(event.target.value)}
                placeholder={t('jira_base_url_placeholder')}
                className="bg-background"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium">{t('jira_token_label')}</label>
              <Input
                aria-label={t('jira_token_label')}
                type="password"
                value={jiraApiToken}
                onChange={(event) => onJiraApiTokenChange(event.target.value)}
                placeholder={editing ? t('secret_keep_existing_hint') : t('jira_token_placeholder')}
                className="bg-background"
              />
            </div>
          </div>
        </div>
      ) : null}

      {provider === 'github' && kind === 'secret_bundle' ? (
        <div className="rounded-xl border border-border/70 bg-surface-high p-4">
          <div className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-secondary">
            {t('section_credentials_title')}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium">{t('github_api_base_url_label')}</label>
              <Input
                aria-label={t('github_api_base_url_label')}
                value={githubApiBaseUrl}
                onChange={(event) => onGithubApiBaseUrlChange(event.target.value)}
                placeholder={t('github_api_base_url_placeholder')}
                className="bg-background"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium">{t('github_token_label')}</label>
              <Input
                aria-label={t('github_token_label')}
                type="password"
                value={githubToken}
                onChange={(event) => onGithubTokenChange(event.target.value)}
                placeholder={editing ? t('secret_keep_existing_hint') : t('github_token_placeholder')}
                className="bg-background"
              />
            </div>
          </div>
        </div>
      ) : null}

      {(provider === 'github' || provider === 'gitee') && kind === 'ssh_keypair' ? (
        <div className="rounded-xl border border-border/70 bg-surface-high p-4">
          <div className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-secondary">
            {t('section_credentials_title')}
          </div>
          <div className="grid gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('git_host_optional_label')}</label>
              <Input
                aria-label={t('git_host_optional_label')}
                value={gitHost}
                onChange={(event) => onGitHostChange(event.target.value)}
                placeholder={provider === 'gitee' ? 'gitee.com' : 'github.com'}
                className="bg-background"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('ssh_public_key_label')}</label>
              <Textarea
                aria-label={t('ssh_public_key_label')}
                value={sshPublicKey}
                onChange={(event) => onSshPublicKeyChange(event.target.value)}
                rows={4}
                placeholder={t('ssh_public_key_placeholder')}
                className="bg-background"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('ssh_private_key_label')}</label>
              <Textarea
                aria-label={t('ssh_private_key_label')}
                value={sshPrivateKey}
                onChange={(event) => onSshPrivateKeyChange(event.target.value)}
                rows={6}
                placeholder={editing ? t('secret_keep_existing_hint') : t('ssh_private_key_placeholder')}
                className="bg-background"
              />
            </div>
          </div>
        </div>
      ) : null}

      {provider === 'custom' ? (
        <div className="rounded-xl border border-border/70 bg-surface-high p-4">
          <div className="mb-3 flex items-center justify-between">
            <label className="text-sm font-medium">{t('fields_label')}</label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onFieldsChange([...fields, createEmptyField()])}
            >
              <Plus className="w-4 h-4" />
              {t('add_field')}
            </Button>
          </div>
          <div className="space-y-3">
            {fields.map((field, index) => (
              <div key={`${index}-${field.key}`} className="space-y-3 rounded-md border border-subtle bg-background p-3">
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                  <Input
                    value={field.key}
                    onChange={(event) => onFieldsChange(fields.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item))}
                    placeholder={t('field_key_placeholder')}
                  />
                  <Input
                    value={field.value}
                    onChange={(event) => onFieldsChange(fields.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))}
                    placeholder={editing && field.secret ? t('secret_keep_existing_hint') : t('field_value_placeholder')}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-error hover:text-error"
                    onClick={() => onFieldsChange(fields.length > 1 ? fields.filter((_, itemIndex) => itemIndex !== index) : [createEmptyField()])}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                  <Input
                    value={field.description ?? ''}
                    onChange={(event) => onFieldsChange(fields.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))}
                    placeholder={t('field_description_placeholder')}
                  />
                  <label className="inline-flex items-center gap-2 text-sm text-tertiary">
                    <input
                      type="checkbox"
                      checked={field.secret !== false}
                      onChange={(event) => onFieldsChange(fields.map((item, itemIndex) => itemIndex === index ? { ...item, secret: event.target.checked } : item))}
                    />
                    {t('field_secret_label')}
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
