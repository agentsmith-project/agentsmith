/**
 * MBOS API Client Module
 *
 * Main entry point for all API operations.
 *
 * Usage:
 * ```ts
 * import { getApiClient, WorkspaceAPI, ProjectAPI } from '@/lib/api';
 *
 * const client = getApiClient();
 * const workspaceAPI = new WorkspaceAPI(client);
 * const workspaces = await workspaceAPI.list();
 * ```
 */

// Core client
export { createApiClient, getApiClient, API_BASE } from './client';
export type { ApiClient, ApiRequestOptions, ApiResponse } from './client';

// Error handling
export {
  APIError,
  isErrorResponse,
  parseErrorResponse,
  parseSSEError,
  formatErrorForToast,
  formatErrorWithRequestID,
  copyRequestID,
  handleAPIError,
  getErrorSuggestions,
} from './errors';

// Types
export * from './types';

// Endpoint APIs
export {
  WorkspaceAPI,
  ProjectAPI,
  AgentAPI,
  EndpointAPI,
  MemberAPI,
  AuditAPI,
  UsageAPI,
  UserAPIKeyService,
  ChatAPI,
} from './endpoints';

export type {
  CreateProjectRequest,
  UpdateProjectRequest,
  CreateAgentRequest,
  UpdateAgentRequest,
  CreateEndpointRequest,
  UpdateEndpointRequest,
  UpdateMemberRoleRequest,
  JoinRequest,
  Member,
  UsageKPI,
  CreateUserKeyRequest,
  CreateSessionRequest,
  CreateMessageRequest,
} from './endpoints';

// Adapters (for advanced usage)
export { MSWApiClient } from './adapters/msw-adapter';
export { FetchApiClient } from './adapters/fetch-adapter';
