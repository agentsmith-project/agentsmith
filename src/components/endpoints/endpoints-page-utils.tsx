import type { ComponentProps } from 'react';

import type { Endpoint } from '@/lib/api/types';

export function buildEndpointsBasePath(locale: string, workspaceId: string, projectId: string) {
  return `/${locale}/workspaces/${workspaceId}/projects/${projectId}`;
}

export function buildEndpointsExportPayload(
  workspaceId: string,
  projectId: string,
  endpoints: Endpoint[],
) {
  return {
    exported_at: new Date().toISOString(),
    workspace_id: workspaceId,
    project_id: projectId,
    endpoints: endpoints.map((endpoint) => ({
      name: endpoint.name,
      description: endpoint.description,
      model: endpoint.model,
      type: endpoint.type,
      provider_family: endpoint.provider_family,
      upstream_protocol: endpoint.upstream_protocol,
      capabilities: endpoint.capabilities,
      models: endpoint.models,
      defaults: endpoint.defaults,
      api_base: endpoint.base_url,
      status: endpoint.status,
      credential_ref: endpoint.credential_ref,
      limits: endpoint.limits,
    })),
    bulk_import_template_examples: {
      reranker: {
        model: '',
        api_base: '',
        api_key: '',
        mode: 'openai',
      },
      embedding: {
        model: '',
        api_base: '',
        api_key: '',
        mode: 'openai',
      },
      completion: {
        model: '',
        api_base: '',
        api_key: '',
        mode: 'openai',
      },
      image_generation: {
        model: '',
        api_base: '',
        api_key: '',
        mode: 'openai',
      },
      video_generation: {
        model: '',
        api_base: '',
        api_key: '',
        mode: 'openai',
      },
    },
  };
}

export function createEndpointsErrorContent(
  title: string,
  description: string,
): ComponentProps<'div'>['children'] {
  return (
    <div className="max-w-md text-center space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-tertiary">{description}</p>
    </div>
  );
}
