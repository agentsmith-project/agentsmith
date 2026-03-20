'use client';

import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { validateWorkspaceParam } from '@/lib/utils/validate-url-params';

export default function WorkspaceFeishuSettingsCallbackPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const workspaceId = validateWorkspaceParam(params?.workspace);
  const query = searchParams.toString();

  React.useEffect(() => {
    if (!workspaceId) {
      return;
    }
    const target = `/workspaces/${workspaceId}/feishu/callback${query ? `?${query}` : ''}`;
    window.location.replace(target);
  }, [query, workspaceId]);

  return null;
}
