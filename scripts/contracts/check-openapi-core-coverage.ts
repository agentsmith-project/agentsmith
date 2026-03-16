import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type OpenApiDoc = {
  paths?: Record<string, Record<string, unknown>>;
};

const REQUIRED_OPERATIONS: Array<{ method: string; path: string }> = [
  { method: 'get', path: '/api/v1/workspaces' },
  { method: 'get', path: '/api/v1/workspaces/{workspaceId}/projects' },
  { method: 'post', path: '/api/v1/workspaces/{workspaceId}/projects' },
  { method: 'get', path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/chat/sessions' },
  { method: 'post', path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/chat/sessions' },
  { method: 'post', path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/chat/sessions/{sessionId}/messages/stream' },
  { method: 'post', path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/chat/sessions/{sessionId}/attachments' },
  { method: 'get', path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/agents' },
  { method: 'post', path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/agents' },
  { method: 'get', path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/agents/{agentId}/connection-info' },
  { method: 'get', path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/agents/{agentId}/keys' },
  { method: 'post', path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/agents/{agentId}/keys' },
  { method: 'get', path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/endpoints' },
  { method: 'post', path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/endpoints' },
  { method: 'get', path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries' },
  { method: 'post', path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries' },
  { method: 'get', path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/entries' },
  { method: 'post', path: '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/upload' },
  { method: 'get', path: '/api/v1/openapi.json' },
  { method: 'get', path: '/api/v1/asyncapi.json' },
];

function loadOpenApiDoc(): OpenApiDoc {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '../..');
  const openApiPath = path.join(repoRoot, 'docs', 'contracts', 'specs', 'openapi.json');
  return JSON.parse(readFileSync(openApiPath, 'utf-8')) as OpenApiDoc;
}

function hasOperation(doc: OpenApiDoc, operation: { method: string; path: string }): boolean {
  const pathItem = doc.paths?.[operation.path];
  if (!pathItem) return false;
  return Object.prototype.hasOwnProperty.call(pathItem, operation.method.toLowerCase());
}

function main(): void {
  const doc = loadOpenApiDoc();
  const missing = REQUIRED_OPERATIONS.filter((op) => !hasOperation(doc, op));

  if (missing.length > 0) {
    process.stderr.write('[contracts] OpenAPI core coverage check failed. Missing operations:\n');
    for (const operation of missing) {
      process.stderr.write(`- ${operation.method.toUpperCase()} ${operation.path}\n`);
    }
    process.exit(1);
  }

  process.stdout.write('[contracts] OpenAPI core coverage check passed.\n');
}

main();
