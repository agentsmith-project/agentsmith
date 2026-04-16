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

const DEFAULT_FILE_LIBRARY_GATEWAY_RECONCILE_INTERVAL_MS = 60_000;

function logGatewayReconcileFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : 'unknown_error';
  process.stderr.write(`[api-entry-node] file library gateway reconcile failed: ${message}\n`);
}

function resolveGatewayReconcileIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(env.FILE_LIBRARY_GATEWAY_RECONCILE_INTERVAL_MS ?? '', 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_FILE_LIBRARY_GATEWAY_RECONCILE_INTERVAL_MS;
}

function startGatewayReconcileLoop(manager?: {
  reconcile?: () => Promise<void>;
}): { stop: () => Promise<void> } {
  if (!manager?.reconcile) {
    return {
      stop: async () => undefined,
    };
  }

  let inFlight: Promise<void> | null = null;
  const runReconcile = (): Promise<void> => {
    if (inFlight) {
      return inFlight;
    }
    inFlight = Promise.resolve()
      .then(() => manager.reconcile?.())
      .catch((error: unknown) => {
        logGatewayReconcileFailure(error);
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  void runReconcile();

  const intervalHandle = setInterval(() => {
    void runReconcile();
  }, resolveGatewayReconcileIntervalMs());
  intervalHandle.unref?.();

  return {
    stop: async () => {
      clearInterval(intervalHandle);
      await inFlight?.catch(() => undefined);
    },
  };
}

export function createNodeApiServer(
  port = 3010,
  deps = createDefaultNodeApiDeps(),
  lifecycle?: Pick<ProjectRepoFactoryResult, 'shutdown'>,
  host?: string,
): http.Server {
  const gatewayReconcileLoop = startGatewayReconcileLoop(deps.fileLibraryGatewayManager);

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

  let shutdownPromise: Promise<void> | null = null;
  let shutdownPerformed = false;
  const originalClose = server.close.bind(server);
  const normalizeServerCloseError = (error: unknown): Error =>
    error instanceof Error ? error : new Error('server_close_failed');

  const shutdownServerResources = async (): Promise<void> => {
    if (shutdownPerformed) return;
    shutdownPerformed = true;
    if (feishuRefreshInterval) clearInterval(feishuRefreshInterval);
    await gatewayReconcileLoop.stop();
    ACTIVE_CHAT_STREAMS.clear();
    await deps.fileLibraryGatewayManager?.shutdown?.();
    await deps.notebookTerminalService.shutdown?.();
    await deps.agentExecutionService.shutdown?.();
    await lifecycle?.shutdown?.();
  };

  const ensureServerResourcesShutdown = (): Promise<void> => {
    if (!shutdownPromise) {
      shutdownPromise = shutdownServerResources();
      void shutdownPromise.catch(() => undefined);
    }
    return shutdownPromise;
  };

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

  server.close = ((callback?: (error?: Error) => void) => {
    const resolveClose = (closeError?: Error) => {
      const cleanup = ensureServerResourcesShutdown();
      if (!callback) {
        return;
      }
      void cleanup.then(
        () => callback(closeError),
        (cleanupError) => callback(closeError ?? normalizeServerCloseError(cleanupError)),
      );
    };

    try {
      originalClose((error?: Error) => {
        resolveClose(error);
      });
    } catch (error) {
      resolveClose(normalizeServerCloseError(error));
    }

    return server;
  }) as typeof server.close;

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
  const server = createNodeApiServer(port, deps, lifecycle);
  let closing = false;
  const closeServer = (signal: string) => {
    if (closing) return;
    closing = true;
    process.stderr.write(`[api-entry-node] received ${signal}, shutting down\n`);
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => closeServer('SIGTERM'));
  process.on('SIGINT', () => closeServer('SIGINT'));
  // Keep log compact and machine-readable for local integration.
  process.stdout.write(`[api-entry-node] listening on ${port} (repo=${repoMode})\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startFromCli();
}
