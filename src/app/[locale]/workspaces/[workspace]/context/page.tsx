'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ContextManager } from '@/components/context/ContextManager';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { validateWorkspaceParam } from '@/lib/utils/validate-url-params';

export default function WorkspacePersonalContextPage() {
  const params = useParams();
  const t = useTranslations('context_store');
  const tErrors = useTranslations('errors');
  const workspaceId = validateWorkspaceParam(params?.workspace);

  if (!workspaceId) {
    return (
      <PageState state="error">
        <div className="max-w-md space-y-2 text-center">
          <h2 className="text-lg font-semibold">{tErrors('validation_error')}</h2>
          <p className="text-sm text-tertiary">{tErrors('badRequest.description')}</p>
        </div>
      </PageState>
      );
  }

  return (
    <PageState state="success">
      <PageLayout
        header={(
          <PageHeader
            title={t('member_workspace_title')}
            subtitle={t('member_workspace_subtitle')}
            variant="compact"
          />
        )}
      >
        <ContextManager scope="member" workspaceId={workspaceId} surface="workspace" />
      </PageLayout>
    </PageState>
  );
}
