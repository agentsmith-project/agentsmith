'use client';

import { useEffect, useState } from 'react';

import { validateProjectParam, validateWorkspaceParam } from '@/lib/utils/validate-url-params';

import type { ResolvedChatPageParams } from './chat-page-types';

export function useResolvedChatParams(
  params: Promise<{ workspace: string; project: string; locale: string }>,
) {
  const [resolvedParams, setResolvedParams] = useState<ResolvedChatPageParams | null>(null);

  useEffect(() => {
    params.then((value) => {
      const nextParams = {
        workspace: validateWorkspaceParam(value.workspace),
        project: validateProjectParam(value.project),
        locale: value.locale,
      };
      setResolvedParams((previous) =>
        previous
        && previous.workspace === nextParams.workspace
        && previous.project === nextParams.project
        && previous.locale === nextParams.locale
          ? previous
          : nextParams,
      );
    });
  }, [params]);

  return resolvedParams;
}
