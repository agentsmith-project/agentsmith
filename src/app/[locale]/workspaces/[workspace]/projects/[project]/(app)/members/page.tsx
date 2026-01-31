/**
 * Members Page
 *
 * Manage project members and their roles.
 */

'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, UserPlus, Shield } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/authStore';

interface MembersPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function MembersPage({ params }: MembersPageProps) {
  const [resolvedParams, setResolvedParams] = useState<{ workspace: string; project: string } | null>(null);
  const currentProject = useAuthStore((state) => state.currentProject);

  useEffect(() => {
    params.then((p) => setResolvedParams({ workspace: p.workspace, project: p.project }));
  }, [params]);

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';

  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ['members', workspaceId, projectId],
    queryFn: async () => {
      const response = await fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/members`);
      return response.json();
    },
    enabled: !!workspaceId && !!projectId,
  });

  const members = membersData?.items || [];

  if (!resolvedParams || !currentProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Members</h1>
        <button className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
          <UserPlus className="w-4 h-4" />
          Invite Member
        </button>
      </div>

      {membersLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading members...</div>
      ) : members.length === 0 ? (
        <div className="text-center py-12">
          <Users className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold mb-2">No members yet</h2>
          <p className="text-muted-foreground">Invite team members to collaborate</p>
        </div>
      ) : (
        <div className="space-y-2">
          {members.map((member: any) => (
            <div key={member.id} className="flex items-center justify-between p-4 rounded-lg border bg-card">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  {member.avatar || member.name?.[0] || member.email?.[0]}
                </div>
                <div>
                  <div className="font-medium">{member.name || member.email}</div>
                  <div className="text-sm text-muted-foreground">{member.email}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 text-sm">
                  <Shield className="w-4 h-4 text-muted-foreground" />
                  <span className="capitalize">{member.role}</span>
                </div>
                <span className={`text-xs px-2 py-1 rounded ${
                  member.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                }`}>
                  {member.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
