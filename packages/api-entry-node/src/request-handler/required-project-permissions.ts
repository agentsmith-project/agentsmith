import type { ProjectsRoute } from '../projects-route-match.js';
import { isAgentRoute, isTaskRoute } from './route-kind-guards.js';

export function requiredProjectPermissions(route: ProjectsRoute, method: string): string[] {
  if (route.kind === 'projectAuthorize') {
    return [];
  }

  if (isTaskRoute(route)) {
    if (route.kind === 'taskMessages' && method === 'POST') {
      return ['project:endpoint:use', 'project:agent:manage'];
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

  if (isAgentRoute(route)) {
    if (method === 'GET') return ['project:agent:manage'];
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
