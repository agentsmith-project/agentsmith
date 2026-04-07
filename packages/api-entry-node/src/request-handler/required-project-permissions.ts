import type { ProjectsRoute } from '../projects-route-match.js';
import { isAgentRoute, isTaskRoute } from './route-kind-guards.js';

function isFileLibraryReadRoute(route: ProjectsRoute, method: string): boolean {
  return (
    (route.kind === 'fileLibraries' && method === 'GET')
    || (route.kind === 'fileLibraryItem' && method === 'GET')
    || (route.kind === 'fileLibraryBackend' && method === 'GET')
    || (route.kind === 'fileLibraryEntries' && method === 'GET')
    || (route.kind === 'fileLibraryDownload' && method === 'GET')
    || (route.kind === 'fileLibraryMeta' && method === 'GET')
    || route.kind === 'fileLibraryStorageCredentialExchange'
    || route.kind === 'fileLibraryDesktopMountAccess'
  );
}

export function requiredProjectPermissions(route: ProjectsRoute, method: string): string[] {
  if (route.kind === 'projectAuthorize') {
    return [];
  }

  if (route.kind === 'item' && method === 'GET') {
    return [];
  }

  if (isTaskRoute(route)) {
    if (route.kind === 'tasks' && method === 'POST') {
      return ['project:endpoint:use', 'project:agent:use'];
    }
    if (route.kind === 'taskMessages' && method === 'POST') {
      return ['project:endpoint:use', 'project:agent:use'];
    }
    if (route.kind === 'taskTerminalSessions' || route.kind === 'taskTerminalSession') {
      return ['project:terminal:use'];
    }
    return ['project:endpoint:use'];
  }

  if (route.kind === 'audit') {
    return ['project:audit:read'];
  }

  if (
    route.kind === 'usage'
    || route.kind === 'usageTimeseries'
    || route.kind === 'usageFacts'
    || route.kind === 'usageRecordsSummary'
    || route.kind === 'usageOperationsSummary'
    || route.kind === 'limitsSummary'
  ) {
    return ['project:endpoint:use'];
  }

  if (
    route.kind === 'projectMembers'
    || route.kind === 'projectInvites'
    || route.kind === 'projectJoinRequestApprove'
    || route.kind === 'projectJoinRequestReject'
    || route.kind === 'projectPermissionTemplates'
    || route.kind === 'projectPermissionTemplateItem'
    || route.kind === 'projectGroups'
    || route.kind === 'projectGroupItem'
    || route.kind === 'projectGroupApplyTemplate'
    || route.kind === 'projectMembershipItem'
    || route.kind === 'projectMemberPermissions'
    || route.kind === 'projectMemberChangeHistory'
  ) {
    return ['project:membership:update'];
  }

  if (route.kind === 'projectJoinRequests') {
    return method === 'POST' ? [] : ['project:membership:update'];
  }

  if (route.kind === 'projectResourcePolicy') {
    return ['project:governance:update'];
  }

  if (
    route.kind === 'fileLibraries'
    || route.kind === 'fileLibraryItem'
    || route.kind === 'fileLibraryBackend'
    || route.kind === 'fileLibraryStorageCredentialExchange'
    || route.kind === 'fileLibraryDesktopMountAccess'
    || route.kind === 'fileLibraryEntries'
    || route.kind === 'fileLibraryFolders'
    || route.kind === 'fileLibraryDelete'
    || route.kind === 'fileLibraryMove'
    || route.kind === 'fileLibraryUpload'
    || route.kind === 'fileLibraryDownload'
    || route.kind === 'fileLibraryMeta'
    || route.kind === 'fileLibraryShareLink'
  ) {
    return isFileLibraryReadRoute(route, method) ? ['project:endpoint:use'] : ['project:files:update'];
  }

  if (isAgentRoute(route)) {
    if (route.kind === 'agentKeys' || route.kind === 'agentKeyItem') return ['project:agent:manage'];
    if (route.kind === 'agentDiagnostics' || route.kind === 'agentExecutionConfig' || route.kind === 'agentConnectionInfo') {
      return ['project:agent:manage'];
    }
    if (method === 'GET') return ['project:agent:use'];
    return ['project:agent:manage'];
  }

  if (route.kind === 'credentials' || route.kind === 'credentialItem' || route.kind === 'credentialRotate') {
    return ['project:governance:update'];
  }

  if (
    route.kind === 'llmUnifiedChat'
    || route.kind === 'projectPricing'
    || route.kind === 'modelCatalogProviders'
    || route.kind === 'modelCatalogModels'
    || route.kind === 'modelCatalogSync'
  ) {
    if (route.kind === 'llmUnifiedChat') {
      return ['project:endpoint:use'];
    }
    if (route.kind === 'modelCatalogProviders' || route.kind === 'modelCatalogModels') {
      return ['project:endpoint:use'];
    }
    return ['project:governance:update'];
  }

  if (
    route.kind === 'endpoints'
    || route.kind === 'endpointItem'
    || route.kind === 'endpointRerank'
    || route.kind === 'endpointImageGeneration'
    || route.kind === 'endpointVideoGenerationCreate'
    || route.kind === 'endpointVideoGenerationPoll'
    || route.kind === 'endpointVideoGenerationCancel'
    || route.kind === 'endpointProxy'
    || route.kind === 'llmGatewayProxy'
    || route.kind === 'endpointImportOpenAICompatible'
  ) {
    if (
      route.kind === 'endpointRerank'
      || route.kind === 'endpointImageGeneration'
      || route.kind === 'endpointVideoGenerationCreate'
      || route.kind === 'endpointVideoGenerationPoll'
      || route.kind === 'endpointVideoGenerationCancel'
      || route.kind === 'endpointProxy'
      || route.kind === 'llmGatewayProxy'
      || (route.kind === 'endpoints' && method === 'GET')
      || (route.kind === 'endpointItem' && method === 'GET')
    ) {
      return ['project:endpoint:use'];
    }
    return ['project:governance:update'];
  }

  return ['project:endpoint:use'];
}
