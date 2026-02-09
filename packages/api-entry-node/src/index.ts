import http from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  ErrorResponseSchema,
} from '@mbos/contracts';
import {
  drainJobQueue,
} from '@mbos/application';
import type { ProjectRepoFactoryResult } from '@mbos/adapters-private';
import {
  ACTIVE_CHAT_STREAMS,
} from './chat-stream-runtime.js';
import { handleChatNonStreamRoute } from './chat-non-stream-handler.js';
import { handleChatStreamRoute } from './chat-stream-handler.js';
import { handleEndpointRoute } from './endpoint-route-handler.js';
import { verifyBearerToken } from './auth.js';
import { handleProjectSourceRoute } from './project-source-route-handler.js';
import { applyCors, json, proxyJsonRequest, readBody, unauthorized } from './http-utils.js';
import { matchProjectsRoute } from './projects-route-match.js';
import {
  OWNER_WORKSPACE_PERMISSIONS,
  buildWorkspaceRecords,
  resolveProjectPermissions,
} from './workspace-permissions.js';
import type { NodeApiDeps } from './node-api-deps.js';
import {
  createDefaultNodeApiDeps,
  createNodeApiDepsFromEnv,
} from './node-api-deps-factory.js';

export type { NodeApiDeps } from './node-api-deps.js';
export { createDefaultNodeApiDeps } from './node-api-deps-factory.js';

function buildUpstreamUrl(baseUrl: string, proxyPath: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const cleanPath = proxyPath.replace(/^\/+/, '');
  return `${cleanBase}/${cleanPath}`;
}

function sseWrite(res: http.ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}


async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse, deps: NodeApiDeps): Promise<void> {
  applyCors(res);
  const method = req.method ?? 'GET';
  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const route = matchProjectsRoute(req.url ?? '');
  if (!route) {
    json(res, 404, { code: 'NOT_FOUND', message: 'Route not found' });
    return;
  }

  try {
    const requestUrl = new URL(req.url ?? '', 'http://localhost');
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }

    const workspaces = buildWorkspaceRecords();
    const defaultWorkspace = workspaces[0];

    const handledProjectSourceRoute = await handleProjectSourceRoute({
      route,
      method,
      req,
      res,
      deps,
      user,
      workspaces,
      defaultWorkspace,
      requestUrl,
      json,
      readBody,
      ownerWorkspacePermissions: OWNER_WORKSPACE_PERMISSIONS,
      resolveProjectPermissions,
    });
    if (handledProjectSourceRoute) {
      return;
    }

    const handledChatNonStream = await handleChatNonStreamRoute({
      route,
      method,
      req,
      res,
      deps,
      requestUrl,
      json,
      readBody,
    });
    if (handledChatNonStream) {
      return;
    }

    const handledChatStream = await handleChatStreamRoute({
      route,
      method,
      req,
      res,
      deps,
      json,
      readBody,
      buildUpstreamUrl,
      sseWrite,
    });
    if (handledChatStream) {
      return;
    }

    const handledEndpointRoute = await handleEndpointRoute({
      route,
      method,
      req,
      res,
      deps,
      json,
      readBody,
      buildUpstreamUrl,
      proxyJsonRequest,
    });
    if (handledEndpointRoute) {
      return;
    }

    json(res, 405, { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });
  } catch (error) {
    if (error instanceof Error && error.message === 'project_not_found') {
      json(res, 404, { code: 'RESOURCE_NOT_FOUND', message: 'project_not_found' });
      return;
    }
    if (error instanceof Error && error.message === 'source_not_found') {
      json(res, 404, { code: 'RESOURCE_NOT_FOUND', message: 'source_not_found' });
      return;
    }
    if (error instanceof Error && error.message === 'source_library_not_found') {
      json(res, 404, { code: 'RESOURCE_NOT_FOUND', message: 'source_library_not_found' });
      return;
    }
    if (error instanceof Error && error.message === 'ai_ready_job_not_found') {
      json(res, 404, { code: 'RESOURCE_NOT_FOUND', message: 'ai_ready_job_not_found' });
      return;
    }
    if (error instanceof Error && error.message === 'source_library_mismatch') {
      json(res, 422, { code: 'VALIDATION_ERROR', message: 'source_library_mismatch' });
      return;
    }

    const parsed = ErrorResponseSchema.safeParse({
      code: 'VALIDATION_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error',
    });

    json(res, 400, parsed.success ? parsed.data : { code: 'BAD_REQUEST', message: 'Bad request' });
  }
}

export function createNodeApiServer(
  port = 3010,
  deps = createDefaultNodeApiDeps(),
  lifecycle?: Pick<ProjectRepoFactoryResult, 'shutdown'>,
): http.Server {
  const server = http.createServer((req, res) => {
    void handleRequest(req, res, deps);
  });

  const jobWorkerInterval = setInterval(() => {
    void drainJobQueue(deps.aiReadyJobQueue, async (item) => {
      await deps.runQueuedAIReadyJobUseCase.execute({
        workspaceId: item.workspaceId,
        projectId: item.projectId,
        libraryId: item.libraryId,
        jobId: item.jobId,
      });
    });
  }, 200);

  if (lifecycle) {
    server.on('close', () => {
      clearInterval(jobWorkerInterval);
      ACTIVE_CHAT_STREAMS.clear();
      void lifecycle.shutdown();
    });
  } else {
    server.on('close', () => {
      clearInterval(jobWorkerInterval);
      ACTIVE_CHAT_STREAMS.clear();
    });
  }

  server.listen(port);
  return server;
}

function startFromCli(): void {
  const portRaw = process.env.PORT;
  const port = portRaw ? Number(portRaw) : 3010;
  if (!Number.isInteger(port) || port <= 0) {
    // Keep startup validation explicit for ops.
    throw new Error('invalid_port');
  }

  const { deps, lifecycle, repoMode } = createNodeApiDepsFromEnv(process.env);
  createNodeApiServer(port, deps, lifecycle);
  // Keep log compact and machine-readable for local integration.
  process.stdout.write(`[api-entry-node] listening on ${port} (repo=${repoMode})\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startFromCli();
}
