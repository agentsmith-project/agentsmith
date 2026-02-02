'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckCircle, XCircle, Settings, Plus } from 'lucide-react';
import { EndpointDenyDialog } from './ResourceACLEditor/EndpointDenyDialog';
import { KBPermissionsDialog } from './ResourceACLEditor/KBPermissionsDialog';
import { useResourceACL, useUpdateResourceACL } from '@/lib/hooks/use-members';
import { getApiClient } from '@/lib/api';
import type { Endpoint } from '@/lib/api/types';
import type { ResourceACL } from '@/lib/api/types';

// Mock KB type - should be replaced with actual KB type from API
interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
}

export interface ResourceACLEditorProps {
  workspaceId: string;
  projectId: string;
  memberId: string;
  memberName: string;
  onSave?: () => void;
  onCancel?: () => void;
}

export function ResourceACLEditor({
  workspaceId,
  projectId,
  memberId,
  memberName,
  onSave,
  onCancel,
}: ResourceACLEditorProps) {
  const t = useTranslations('members.acl');
  const [endpoints, setEndpoints] = React.useState<Endpoint[]>([]);
  const [kbs, setKbs] = React.useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedEndpoint, setSelectedEndpoint] = React.useState<Endpoint | null>(null);
  const [selectedKB, setSelectedKB] = React.useState<KnowledgeBase | null>(null);
  const [endpointDenyDialogOpen, setEndpointDenyDialogOpen] = React.useState(false);
  const [kbPermissionsDialogOpen, setKBPermissionsDialogOpen] = React.useState(false);

  // Fetch endpoints and KBs
  React.useEffect(() => {
    const fetchResources = async () => {
      try {
        const api = getApiClient();
        // Fetch endpoints
        const endpointsResponse = await api.endpoints.list(workspaceId, projectId);
        setEndpoints(endpointsResponse.items || []);

        // TODO: Fetch KBs when API is available
        // const kbsResponse = await api.kbs.list(workspaceId, projectId);
        // setKbs(kbsResponse.items || []);
        setKbs([]); // Placeholder

        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch resources:', error);
        setLoading(false);
      }
    };

    fetchResources();
  }, [workspaceId, projectId]);

  const handleEndpointDeny = (endpoint: Endpoint) => {
    setSelectedEndpoint(endpoint);
    setEndpointDenyDialogOpen(true);
  };

  const handleKBEdit = (kb: KnowledgeBase) => {
    setSelectedKB(kb);
    setKBPermissionsDialogOpen(true);
  };

  if (loading) {
    return <div className="text-center py-8 text-tertiary">Loading resources...</div>;
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-tertiary">{t('description')}</p>

      <Tabs defaultValue="endpoints" className="w-full">
        <TabsList>
          <TabsTrigger value="endpoints">Endpoints</TabsTrigger>
          <TabsTrigger value="knowledge-bases">Knowledge Bases</TabsTrigger>
        </TabsList>

        <TabsContent value="endpoints" className="mt-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-foreground">Endpoints</h4>
            </div>

            {endpoints.length === 0 ? (
              <div className="text-center py-8 text-tertiary">
                <p className="text-sm">No endpoints available</p>
              </div>
            ) : (
              <div className="space-y-3">
                {endpoints.map((endpoint) => (
                  <EndpointACLRow
                    key={endpoint.id}
                    endpoint={endpoint}
                    workspaceId={workspaceId}
                    projectId={projectId}
                    memberId={memberId}
                    memberName={memberName}
                    onDeny={() => handleEndpointDeny(endpoint)}
                  />
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="knowledge-bases" className="mt-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-foreground">Knowledge Bases</h4>
            </div>

            {kbs.length === 0 ? (
              <div className="text-center py-8 text-tertiary">
                <p className="text-sm">No knowledge bases available</p>
              </div>
            ) : (
              <div className="space-y-3">
                {kbs.map((kb) => (
                  <KBACLRow
                    key={kb.id}
                    kb={kb}
                    workspaceId={workspaceId}
                    projectId={projectId}
                    memberId={memberId}
                    memberName={memberName}
                    onEdit={() => handleKBEdit(kb)}
                  />
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {selectedEndpoint && (
        <EndpointDenyDialog
          open={endpointDenyDialogOpen}
          onOpenChange={setEndpointDenyDialogOpen}
          endpoint={selectedEndpoint}
          workspaceId={workspaceId}
          projectId={projectId}
          memberId={memberId}
          memberName={memberName}
          onSuccess={() => {
            setEndpointDenyDialogOpen(false);
            onSave?.();
          }}
        />
      )}

      {selectedKB && (
        <KBPermissionsDialog
          open={kbPermissionsDialogOpen}
          onOpenChange={setKBPermissionsDialogOpen}
          kb={selectedKB}
          workspaceId={workspaceId}
          projectId={projectId}
          memberId={memberId}
          memberName={memberName}
          onSuccess={() => {
            setKBPermissionsDialogOpen(false);
            onSave?.();
          }}
        />
      )}

      <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
        {onCancel && (
          <Button variant="outline" onClick={onCancel}>
            {t('cancel')}
          </Button>
        )}
      </div>
    </div>
  );
}

interface EndpointACLRowProps {
  endpoint: Endpoint;
  workspaceId: string;
  projectId: string;
  memberId: string;
  memberName: string;
  onDeny: () => void;
}

function EndpointACLRow({
  endpoint,
  workspaceId,
  projectId,
  memberId,
  onDeny,
}: EndpointACLRowProps) {
  const t = useTranslations('members.acl');
  const { data: acl, isLoading } = useResourceACL(
    workspaceId,
    projectId,
    'endpoint',
    endpoint.id
  );

  const isDenied = React.useMemo(() => {
    if (!acl) return false;
    return acl.deny.some((d) => d.subject_id === memberId);
  }, [acl, memberId]);

  const denyEntry = React.useMemo(() => {
    if (!acl) return null;
    return acl.deny.find((d) => d.subject_id === memberId);
  }, [acl, memberId]);

  const { mutate: updateACL } = useUpdateResourceACL(
    workspaceId,
    projectId,
    'endpoint',
    endpoint.id
  );

  const handleRemoveDeny = React.useCallback(() => {
    updateACL({
      ops: [
        {
          op: 'remove_deny',
          subject_type: 'user',
          subject_id: memberId,
          permissions: ['endpoint:use'],
        },
      ],
    });
  }, [updateACL, memberId]);

  if (isLoading) {
    return (
      <div className="border border-border rounded-md p-4">
        <div className="animate-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-md p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h5 className="text-sm font-medium text-foreground">{endpoint.name}</h5>
          {endpoint.description && (
            <p className="text-xs text-tertiary mt-1">{endpoint.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isDenied ? (
            <>
              <Badge variant="destructive" className="text-xs">
                <XCircle className="h-3 w-3 mr-1" />
                Denied
              </Badge>
              {denyEntry?.reason && (
                <span className="text-xs text-tertiary">Reason: {denyEntry.reason}</span>
              )}
              <Button variant="outline" size="sm" onClick={handleRemoveDeny}>
                {t('endpoint.remove_deny')}
              </Button>
            </>
          ) : (
            <>
              <Badge variant="default" className="text-xs">
                <CheckCircle className="h-3 w-3 mr-1" />
                Allowed (default)
              </Badge>
              <Button variant="outline" size="sm" onClick={onDeny}>
                {t('endpoint.deny')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface KBACLRowProps {
  kb: KnowledgeBase;
  workspaceId: string;
  projectId: string;
  memberId: string;
  memberName: string;
  onEdit: () => void;
}

function KBACLRow({
  kb,
  workspaceId,
  projectId,
  memberId,
  onEdit,
}: KBACLRowProps) {
  const { data: acl, isLoading } = useResourceACL(
    workspaceId,
    projectId,
    'kb',
    kb.id
  );

  const allowedPermissions = React.useMemo(() => {
    if (!acl) return [];
    const allowEntry = acl.allow.find((a) => a.subject_id === memberId);
    return allowEntry?.permissions || [];
  }, [acl, memberId]);

  if (isLoading) {
    return (
      <div className="border border-border rounded-md p-4">
        <div className="animate-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-md p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h5 className="text-sm font-medium text-foreground">{kb.name}</h5>
          {kb.description && (
            <p className="text-xs text-tertiary mt-1">{kb.description}</p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Settings className="h-4 w-4 mr-2" />
          {t('kb.edit_permissions')}
        </Button>
      </div>
      {allowedPermissions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {allowedPermissions.map((perm) => (
            <Badge key={perm} variant="outline" className="text-xs font-mono">
              {perm}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
