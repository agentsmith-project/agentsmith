'use client';

import { useParams } from 'next/navigation';
import { WorkspaceLoginCallbackClient } from '@/components/auth/WorkspaceLoginCallbackClient';

export default function WorkspaceLoginCallbackPage() {
  const params = useParams();
  const workspaceId = (params?.workspace as string) || '';

  return <WorkspaceLoginCallbackClient workspaceId={workspaceId} />;
}
