/**
 * Members Page
 *
 * Manage project members, permissions, and quotas.
 */

'use client';

import { useState, useEffect } from 'react';
import { MembersPage } from '@/components/members/MembersPage';

interface MembersPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function MembersRoute({ params }: MembersPageProps) {
  const [resolvedParams, setResolvedParams] = useState<{ workspace: string; project: string } | null>(null);

  useEffect(() => {
    params.then((p) => setResolvedParams({ workspace: p.workspace, project: p.project }));
  }, [params]);

  if (!resolvedParams) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-tertiary">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-6 max-w-7xl mx-auto">
      <MembersPage workspaceId={resolvedParams.workspace} projectId={resolvedParams.project} />
    </div>
  );
}
