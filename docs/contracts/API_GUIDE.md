# MBOS API Developer Guide

**Last Updated:** 2026-02-27
**API Version:** 1.0.0
**Base URL:** `/api/v1`

## Overview

The MBOS (Microservices-Based Agent System) API provides REST endpoints for managing workspaces, projects, agents, endpoints, sources, and more. This guide is for frontend developers and API consumers.

## Table of Contents

- [Authentication](#authentication)
- [Common Patterns](#common-patterns)
- [API Endpoints](#api-endpoints)
- [Error Codes](#error-codes)
- [Rate Limiting](#rate-limiting)
- [SSE Events](#sse-events)

## Authentication

All API requests require authentication via Bearer token:

```bash
curl -H "Authorization: Bearer <token>" https://api.example.com/api/v1/workspaces
```

### Token Sources

1. **Keycloak** (production): JWT tokens from `/realms/mbos/protocol/openid-connect`
2. **MSW** (development): Mock tokens for testing

### Authorization

Token must include permissions for the requested resource. See [auth-permission-model.md](../contracts/auth-permission-model.md) for details.

## Common Patterns

### Path Parameters

- `workspaceId`: Workspace UUID (e.g., `ws_abc123`)
- `projectId`: Project UUID (e.g., `proj_def456`)
- `endpointId`: Endpoint UUID

### Response Format

All responses use JSON:

```json
{
  "data": { ... },
  "error": null
}
```

### Pagination

List endpoints support pagination:

```bash
GET /api/v1/workspaces/{workspaceId}/projects?page=1&page_size=25
```

Response:
```json
{
  "items": [...],
  "total": 100,
  "page": 1,
  "page_size": 25,
  "has_more": true
}
```

## API Endpoints

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/openapi.json` | Get OpenAPI spec |
| GET | `/api/v1/asyncapi.json` | Get AsyncAPI spec |

### Workspaces

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|-------------|
| GET | `/api/v1/workspaces` | List workspaces | `workspace:list` |
| POST | `/api/v1/workspaces` | Create workspace | `workspace:create` |

### Projects

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|-------------|
| GET | `/api/v1/workspaces/{workspaceId}/projects` | List projects | `project:list` |
| POST | `/api/v1/workspaces/{workspaceId}/projects` | Create project | `project:create` |
| GET | `/api/v1/workspaces/{workspaceId}/projects/{projectId}` | Get project | `project:read` |
| PUT | `/api/v1/workspaces/{workspaceId}/projects/{projectId}` | Update project | `project:update` |
| DELETE | `/api/v1/workspaces/{workspaceId}/projects/{projectId}` | Delete project | `project:delete` |

### Authorization (Epic A1)

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|-------------|
| POST | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/authorize` | Unified authorization check | `project:*` |

### SSE (Epic B1)

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|-------------|
| POST | `/api/v1/sse-ticket` | Exchange JWT for SSE ticket | (authenticated) |

### Governance (Epic B2)

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|-------------|
| GET | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/audit/export` | Export audit logs | `audit:export` |
| POST | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/quota/check` | Check quota before operation | `project:*` |

### Chat

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|-------------|
| POST | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/chat` | Send chat message | `project:chat` |
| GET | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/chat/{threadId}` | Get chat thread | `project:chat` |

### Agents

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|-------------|
| GET | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/agents` | List agents | `agent:list` |
| POST | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/agents` | Create agent | `agent:create` |
| GET | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/agents/{agentId}` | Get agent | `agent:read` |
| PUT | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/agents/{agentId}` | Update agent | `agent:update` |
| DELETE | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/agents/{agentId}` | Delete agent | `agent:delete` |
| POST | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/agents/{agentId}/run` | Run agent task | `agent:run` |

### Endpoints

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|-------------|
| GET | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/endpoints` | List endpoints | `endpoint:list` |
| POST | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/endpoints` | Create endpoint | `endpoint:create` |
| GET | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/endpoints/{endpointId}` | Get endpoint | `endpoint:read` |
| PUT | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/endpoints/{endpointId}` | Update endpoint | `endpoint:update` |
| DELETE | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/endpoints/{endpointId}` | Delete endpoint | `endpoint:delete` |

### Sources (Files)

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|-------------|
| GET | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/sources` | List sources | `source:list` |
| POST | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/sources` | Create source | `source:create` |
| GET | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/sources/{sourceId}` | Get source | `source:read` |
| PUT | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/sources/{sourceId}` | Update source | `source:update` |
| DELETE | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/sources/{sourceId}` | Delete source | `source:delete` |
| POST | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/sources/{sourceId}/upload` | Upload file | `source:upload` |

### Credentials

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|-------------|
| GET | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/credentials` | List credentials | `credential:list` |
| POST | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/credentials` | Create credential | `credential:create` |
| DELETE | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/credentials/{credentialId}` | Delete credential | `credential:delete` |
| POST | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/credentials/{credentialId}/rotate` | Rotate credential | `credential:rotate` |

### Members

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|-------------|
| GET | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/members` | List members | `member:list` |
| POST | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/invites` | Create invite | `member:invite` |
| DELETE | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/invites/{inviteId}` | Delete invite | `member:invite` |
| PUT | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/members/{userId}` | Update member | `member:update` |
| DELETE | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/members/{userId}` | Remove member | `member:remove` |

### Audit Logs

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|-------------|
| GET | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/audit` | Get audit logs | `audit:read` |
| GET | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/audit/export` | Export audit logs | `audit:export` |

### Usage

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|-------------|
| GET | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/usage` | Get usage stats | `usage:read` |

### Notebook (AI Studio)

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|-------------|
| GET | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/notebook/tasks` | List tasks | `notebook:read` |
| POST | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/notebook/tasks` | Create task | `notebook:write` |
| GET | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/notebook/tasks/{taskId}` | Get task | `notebook:read` |
| POST | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/notebook/tasks/{taskId}/execute` | Execute task | `notebook:write` |
| GET | `/api/v1/workspaces/{workspaceId}/projects/{projectId}/notebook/tasks/{taskId}/trace` | Get execution trace | `notebook:read` |

## Error Codes

### HTTP Status Codes

| Code | Description | Example |
|------|-------------|---------|
| 200 | Success | Request completed successfully |
| 201 | Created | Resource created successfully |
| 204 | No Content | Request succeeded with no response body |
| 400 | Bad Request | Invalid request parameters |
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | Valid token but insufficient permissions |
| 404 | Not Found | Resource does not exist |
| 409 | Conflict | Resource already exists or state conflict |
| 422 | Unprocessable Entity | Validation error |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server error |

### Error Response Format

```json
{
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "You do not have permission to perform this action",
    "details": {
      "required_permission": "project:delete",
      "resource": "proj_123"
    }
  }
}
```

### Common Error Codes

| Code | Description |
|------|-------------|
| `UNAUTHORIZED` | Missing or invalid token |
| `PERMISSION_DENIED` | Insufficient permissions |
| `RESOURCE_NOT_FOUND` | Resource does not exist |
| `RESOURCE_ALREADY_EXISTS` | Conflict with existing resource |
| `VALIDATION_ERROR` | Invalid request parameters |
| `RATE_LIMIT_EXCEEDED` | Too many requests |
| `QUOTA_EXCEEDED` | Resource quota exceeded |
| `INTERNAL_ERROR` | Unexpected server error |

## Rate Limiting

API requests are rate-limited per project. Limits are configured per endpoint type:

- **Chat endpoints**: 60 requests/minute
- **Agent execution**: 30 requests/minute
- **Read operations**: 120 requests/minute

Rate limit headers are included in responses:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1677648000
```

## SSE Events

Server-Sent Events (SSE) are used for real-time updates:

1. **Exchange JWT for SSE ticket**: `POST /api/v1/sse-ticket`
2. **Connect to SSE endpoint**: `GET /api/v1/sse?ticket=<ticket>`

### SSE Event Types

| Event | Description |
|-------|-------------|
| `agent.progress` | Agent execution progress |
| `agent.message` | Agent message chunk |
| `agent.artifact` | Agent artifact created |
| `agent.error` | Agent execution error |
| `agent.done` | Agent execution complete |

See [asyncapi.yaml](specs/asyncapi.yaml) for SSE protocol details.

## Schema Reference

### Common Schemas

#### Workspace
```typescript
interface Workspace {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}
```

#### Project
```typescript
interface Project {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
}
```

#### Endpoint
```typescript
interface Endpoint {
  id: string;
  project_id: string;
  name: string;
  endpoint_type: 'chat' | 'completion';
  model: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
```

#### Agent
```typescript
interface Agent {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  system_prompt?: string;
  tools: string[];
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
```

## Related Documentation

- [OpenAPI Spec](specs/openapi.yaml) - Full API specification
- [AsyncAPI Spec](specs/asyncapi.yaml) - SSE event specification
- [Auth Permission Model](auth-permission-model.md) - Permission system
- [Product Terminology](product-terminology.md) - Domain terms

## Validation

Run these commands before committing API changes:

```bash
# Check OpenAPI spec validity
npm run contracts:check-openapi

# Check for breaking changes
npm run contracts:check-openapi-breaking

# Generate TypeScript types from spec
npm run openapi:generate

# Check generated types are in sync
npm run openapi:check-generated
```
