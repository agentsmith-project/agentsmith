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

// Re-export ApiError alias from client (same as APIError, for backward compatibility)
export { ApiError } from './client';

// Types
export * from './types';

// Endpoint APIs
export {
  WorkspaceAPI,
  ProjectAPI,
  AgentAPI,
  EndpointAPI,
  CredentialsAPI,
  MemberAPI,
  AuditAPI,
  UsageAPI,
  UserAPIKeyService,
  MeAPI,
  ChatAPI,
  FilesAPI,
  TaskAPI,
  AlertAPI,
  RuntimeAPI,
  ReleaseOpsAPI,
  GovernanceExplainabilityAPI,
  OrganizationActionsAPI,
} from './endpoints';

export type {
  CreateProjectRequest,
  UpdateProjectRequest,
  CreateAgentRequest,
  UpdateAgentRequest,
  CreateEndpointRequest,
  UpdateEndpointRequest,
  UpdateMemberGroupRequest,
  JoinRequest,
  Member,
  UsageKPI,
  UsageReportSchedule,
  UsageReportScheduleDeliveryResult,
  CreateUserKeyRequest,
  CreateSessionRequest,
  CreateMessageRequest,
  Task,
  TaskMessage,
  Artifact,
  CreateTaskRequest,
  UpdateTaskRequest,
  SendMessageRequest,
  SaveArtifactRequest,
  TaskListParams,
  TaskListResponse,
  RuntimeProviderConnection,
  CreateRuntimeProviderConnectionRequest,
  UpdateRuntimeProviderConnectionRequest,
  RuntimeModelCatalogEntry,
  CreateRuntimeModelCatalogEntryRequest,
  UpdateRuntimeModelCatalogEntryRequest,
  RuntimeModelAlias,
  CreateRuntimeModelAliasRequest,
  UpdateRuntimeModelAliasRequest,
  RuntimeModelCombo,
  CreateRuntimeModelComboRequest,
  UpdateRuntimeModelComboRequest,
  RuntimePricingMap,
  RuntimeAttemptTrace,
  RuntimeAttemptOutcome,
  RuntimeRoutingDryRunAttempt,
  RuntimeRoutingDryRunRequest,
  RuntimeRoutingDryRunResponse,
  RuntimeImpactPreviewRequest,
  RuntimeImpactPreviewResponse,
  PublishRuntimeRouteRequest,
  CreateRuntimePricingVersionRequest,
  RuntimePricingCompareResponse,
  RuntimeReleaseGuardrails,
  UnifiedChatRuntimeMetadata,
  RuntimeUnifiedChatRequest,
  RuntimeUnifiedChatResponse,
  RuntimeUnifiedChatErrorResponse,
  RuntimeUnifiedChatResult,
  GovernanceAuthorizationRequest,
  GovernanceAuthorizationResponse,
  GovernanceAuthorizationDecision,
  GovernanceMatchedPolicy,
  GovernanceQuotaCheckRequest,
  GovernanceQuotaCheckResponse,
  GovernanceQuotaExceededDetails,
  GovernanceRouteForbiddenDetails,
  GovernanceEffectiveAccessSnapshot,
  GovernanceMembershipStatus,
} from './endpoints';

// Adapters (for advanced usage)
// Note: MSWApiClient is NOT exported here to avoid bundling in production.
// It is dynamically imported in client.ts when NEXT_PUBLIC_USE_MSW=true.
export { FetchApiClient } from './adapters/fetch-adapter';
