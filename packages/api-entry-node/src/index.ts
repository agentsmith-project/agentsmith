import http from 'node:http';
import { fileURLToPath } from 'node:url';
import type { ProjectRepoFactoryResult } from '@mbos/adapters-private';
import { ACTIVE_CHAT_STREAMS } from './chat-stream-state';
import {
  createDefaultNodeApiDeps,
  createNodeApiDepsFromEnv,
} from './node-api-deps-factory';
import { handleRequest } from './request-handler';
import { createGovernanceRunner } from './governance-runner';
import { ensureModelCatalogBootstrap } from './model-catalog-service';
import { refreshExpiringFeishuConnections } from './feishu-oauth';
export {
  createWorkspaceFoundationStoreResourceFromEnv,
  getWorkspaceFoundationBaseCollections,
  initializeWorkspaceFoundations,
} from './workspace-foundation-initializer';

export type { NodeApiDeps } from './node-api-deps';
export { createDefaultNodeApiDeps } from './node-api-deps-factory';

export function createNodeApiServer(
  port = 3010,
  deps = createDefaultNodeApiDeps(),
  lifecycle?: Pick<ProjectRepoFactoryResult, 'shutdown'>,
  host?: string,
): http.Server {
  void ensureModelCatalogBootstrap(deps.docStore).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'unknown_error';
    process.stderr.write(`[api-entry-node] model catalog bootstrap failed: ${message}\n`);
  });

  deps.governanceRunner = createGovernanceRunner({
    governanceRunsDir: deps.governanceRunsDir ?? 'artifacts/governance-runs',
  });

  const server = http.createServer((req, res) => {
    void handleRequest(req, res, deps);
  });
  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url ?? '', 'http://localhost').pathname;
    if (/\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/tasks\/[^/]+\/terminal\/ws\/?$/.test(pathname)) {
      deps.notebookTerminalService.handleUpgrade(req, socket, head);
      return;
    }
    deps.agentExecutionService.handleUpgrade(req, socket, head);
  });

  const feishuRefreshEnabled = process.env.FEISHU_OAUTH_REFRESH_RUNNER_ENABLED !== 'false';
  const feishuRefreshIntervalMs = Number.parseInt(process.env.FEISHU_OAUTH_REFRESH_RUNNER_INTERVAL_MS ?? '300000', 10);
  const feishuRefreshInterval = feishuRefreshEnabled
    ? setInterval(() => {
      void refreshExpiringFeishuConnections(deps.docStore).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'unknown_error';
        process.stderr.write(`[api-entry-node] feishu refresh failed: ${message}\n`);
      });
    }, Number.isFinite(feishuRefreshIntervalMs) && feishuRefreshIntervalMs > 0 ? feishuRefreshIntervalMs : 300000)
    : null;

  if (lifecycle) {
    server.on('close', () => {
      if (feishuRefreshInterval) clearInterval(feishuRefreshInterval);
      ACTIVE_CHAT_STREAMS.clear();
      void lifecycle.shutdown();
    });
  } else {
    server.on('close', () => {
      if (feishuRefreshInterval) clearInterval(feishuRefreshInterval);
      ACTIVE_CHAT_STREAMS.clear();
    });
  }

  server.listen(port, host);
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
