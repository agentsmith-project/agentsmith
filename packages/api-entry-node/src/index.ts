import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { drainJobQueue } from '@mbos/application';
import type { ProjectRepoFactoryResult } from '@mbos/adapters-private';
import { ACTIVE_CHAT_STREAMS } from './chat-stream-runtime.js';
import {
  createDefaultNodeApiDeps,
  createNodeApiDepsFromEnv,
} from './node-api-deps-factory.js';
import { handleRequest } from './request-handler.js';
import { createUsageReportRunner } from './usage-report-runner.js';
import { createUsageReportDeliveryDispatcher } from './usage-report-delivery.js';
import { createReleaseGateRunner } from './release-gate-runner.js';

export type { NodeApiDeps } from './node-api-deps.js';
export { createDefaultNodeApiDeps } from './node-api-deps-factory.js';

type CreateNodeApiServerOptions = {
  usageReportRunner?: {
    enabled?: boolean;
    intervalMs?: number;
  };
};

export function createNodeApiServer(
  port = 3010,
  deps = createDefaultNodeApiDeps(),
  lifecycle?: Pick<ProjectRepoFactoryResult, 'shutdown'>,
  options?: CreateNodeApiServerOptions,
): http.Server {
  const usageReportDeliveryDispatch = createUsageReportDeliveryDispatcher({
    getCredentialSecret: (workspaceId, projectId, credentialId) =>
      deps.endpointResourceService.getCredentialSecret(workspaceId, projectId, credentialId),
  });
  const usageReportRunner = createUsageReportRunner(deps.docStore, {
    enabled: options?.usageReportRunner?.enabled ?? false,
    intervalMs: options?.usageReportRunner?.intervalMs,
    deliveryDispatch: usageReportDeliveryDispatch,
  });
  deps.usageReportRunner = usageReportRunner;
  deps.releaseGateRunner = createReleaseGateRunner({
    releaseRunsDir: deps.releaseRunsDir ?? 'artifacts/release-runs',
  });

  const server = http.createServer((req, res) => {
    void handleRequest(req, res, deps);
  });
  server.on('upgrade', (req, socket, head) => {
    deps.agentRuntimeService.handleUpgrade(req, socket, head);
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
      usageReportRunner.stop();
      ACTIVE_CHAT_STREAMS.clear();
      void lifecycle.shutdown();
    });
  } else {
    server.on('close', () => {
      clearInterval(jobWorkerInterval);
      usageReportRunner.stop();
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
  createNodeApiServer(port, deps, lifecycle, {
    usageReportRunner: {
      enabled: process.env.USAGE_REPORT_RUNNER_ENABLED === 'true',
      intervalMs: Number.parseInt(process.env.USAGE_REPORT_RUNNER_INTERVAL_MS ?? '60000', 10),
    },
  });
  // Keep log compact and machine-readable for local integration.
  process.stdout.write(`[api-entry-node] listening on ${port} (repo=${repoMode})\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startFromCli();
}
