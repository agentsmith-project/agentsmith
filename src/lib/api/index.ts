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
export { createApiClient, getApiClient, resetApiClient, API_BASE } from './client';
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
  handleErrorForToast,
  getErrorSuggestions,
} from './errors';

// Re-export ApiError from the client module.
export { ApiError } from './client';

// Types
export * from './types';

// Endpoint APIs
export {
  WorkspaceAPI,
  ProjectAPI,
  AgentRunnerAPI,
  EndpointAPI,
  CredentialsAPI,
  MemberAPI,
  AuditAPI,
  UsageAPI,
  UserAPIKeyService,
  UserExternalConnectionsAPI,
  MeAPI,
  ChatAPI,
  FilesAPI,
  TaskAPI,
  AlertAPI,
  ModelConfigAPI,
  GovernanceExplainabilityAPI,
  FileLibrariesAPI,
  ContextAPI,
} from './endpoints';

export type {
  CreateProjectRequest,
  UpdateProjectRequest,
  CreateAgentRunnerRequest,
  UpdateAgentRunnerRequest,
  CreateEndpointRequest,
  UpdateEndpointRequest,
  UpdateAgentTaskModelSettingRequest,
  JoinRequest,
  Member,
  CreateUserKeyRequest,
  UserExternalConnection,
  UserExternalConnectionProvider,
  UserExternalConnectionKind,
  UserExternalConnectionStatus,
  UserExternalConnectionField,
  UserExternalConnectionFieldInput,
  UserExternalConnectionProviderConfig,
  UserExternalConnectionOAuthStartResponse,
  CreateUserExternalConnectionRequest,
  UpdateUserExternalConnectionRequest,
  CreateSessionRequest,
  CreateMessageRequest,
  Task,
  TaskActivityItem,
  Artifact,
  ContextEntry,
  ContextScope,
  ContextContentType,
  PutContextEntryRequest,
  ContextQuery,
  CreateTaskRequest,
  UpdateTaskRequest,
  StartTaskRunRequest,
  TaskListParams,
  TaskListResponse,
  ProjectPricingMap,
  ModelRequestTrace,
  ModelRequestDetails,
  ModelRequestPayload,
  ModelRequestResponse,
  ModelRequestErrorResponse,
  ModelRequestExecutionResult,
  GovernanceAuthorizationRequest,
  GovernanceAuthorizationResponse,
  GovernanceAuthorizationDecision,
  GovernanceMatchedPolicy,
  GovernanceLimitCheckRequest,
  GovernanceLimitCheckResponse,
  GovernanceLimitExceededDetails,
  GovernanceRouteForbiddenDetails,
  GovernanceEffectiveAccessSnapshot,
  GovernanceMembershipStatus,
} from './endpoints';

// Adapters (for advanced usage)
// Note: MSWApiClient is NOT exported here to avoid bundling in production.
// It is dynamically imported in client.ts when NEXT_PUBLIC_USE_MSW=true.
export { FetchApiClient } from './adapters/fetch-adapter';
