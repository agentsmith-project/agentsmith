'use client';

import { useState, useEffect } from 'react';
import { UsagePage as UsagePageComponent } from '@/components/audit-usage/UsagePage';
import { useAuthStore } from '@/lib/stores/authStore';

interface UsagePageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function UsagePage({ params }: UsagePageProps) {
  const [resolvedParams, setResolvedParams] = useState<{
    workspace: string;
    project: string;
  } | null>(null);
  const currentUser = useAuthStore((s) => s.user);

  useEffect(() => {
    params.then((p) =>
      setResolvedParams({ workspace: p.workspace, project: p.project }),
    );
  }, [params]);

  if (!resolvedParams) {
    return <div className="p-6">Loading...</div>;
  }

  // TODO: Lock end_user_id filter for user role when membership API is integrated
  const defaultEndUserId = undefined;

  return (
    <UsagePageComponent
      workspaceId={resolvedParams.workspace}
      projectId={resolvedParams.project}
      defaultEndUserId={defaultEndUserId}
      currentUserId={currentUser?.id}
    />
  );
}
