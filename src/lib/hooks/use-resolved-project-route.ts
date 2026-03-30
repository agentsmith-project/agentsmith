'use client';

import { useEffect, useState } from 'react';

import { validateProjectParam, validateWorkspaceParam } from '@/lib/utils/validate-url-params';

export interface ResolvedProjectRoute {
  workspace: string | null;
  project: string | null;
  locale: string;
  isReady: boolean;
  isValid: boolean;
}

interface ProjectRouteParams {
  workspace: string;
  project: string;
  locale: string;
}

export function useResolvedProjectRoute(
  params: Promise<ProjectRouteParams>,
): ResolvedProjectRoute {
  const [resolvedParams, setResolvedParams] = useState<{
    workspace: string | null;
    project: string | null;
    locale: string;
  } | null>(null);

  useEffect(() => {
    params.then((value) => {
      const nextParams = {
        workspace: validateWorkspaceParam(value.workspace) ?? null,
        project: validateProjectParam(value.project) ?? null,
        locale: value.locale || 'en-US',
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

  if (!resolvedParams) {
    return {
      workspace: null,
      project: null,
      locale: 'en-US',
      isReady: false,
      isValid: false,
    };
  }

  return {
    ...resolvedParams,
    isReady: true,
    isValid: Boolean(resolvedParams.workspace && resolvedParams.project),
  };
}
