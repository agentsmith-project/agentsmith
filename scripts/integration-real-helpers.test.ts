import { afterEach, describe, expect, it, vi } from 'vitest';
import type { APIRequestContext } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocketServer, type WebSocket as ServerWebSocket } from 'ws';
const upsertManagedRunner = vi.hoisted(() => vi.fn());

vi.mock('../scripts/agent-runner-seed-managed-runner-core', () => ({
  upsertDeploymentDefaultManagedRunner: upsertManagedRunner,
  default: {
    upsertDeploymentDefaultManagedRunner: upsertManagedRunner,
  },
}));
import {
  API_BASE,
  bindAgentTaskExecutionSocketToTask,
  buildCreateProjectRequestBody,
  createAgentTaskRunnerBundleViaApi,
  createAgentTaskViaApi,
  createExternalConnectionViaApi,
  createInternalAgentTaskRunnerViaApi,
  createManagedAgentRunnerViaApi,
  createProjectInWorkspace,
  createTerminalSessionViaApi,
  expectTerminalSessionRunnerEvidenceViaApi,
  findPreparedTaskWorkspaceRootInRunnerLog,
  parseWorkloadPodSnapshot,
  releaseExpiredWorkloadsViaAsbcp,
  summarizeWorkloadPodEvents,
  resolveAgentTaskCreateTimeoutMs,
  resolveAgentTaskCreateStoragePendingRetries,
  resolveAgentTaskCreateStoragePendingRetryDelayMs,
  resolveAgentTaskRunFinalState,
  selectExpiredWorkloadReleaseTargets,
  resolveIntegrationKeycloakBaseUrl,
  resolveAgentTaskRunnerSocketUrl,
  resolveTerminalSessionCreateTimeoutMs,
  runTerminalCommandInSession,
  runTerminalCommandViaWs,
  spawnAndCapture,
  startAgentTaskRunViaApi,
  startMockExternalHttpService,
  startMockExternalMcpService,
  waitForExpiredWorkloadReleasedViaAsbcp,
  waitForWorkloadPodDeleted,
  waitForWorkloadPodIdentity,
  waitForWorkloadPodPresent,
  waitForTerminalSessionFinalTruthViaApi,
  waitForRunnerOutputToken,
} from '../e2e/integration-real-helpers';
import { evaluateAgentTaskExecutionSnapshot } from '../e2e/agent-task-execution-outcome';

const originalFetch = globalThis.fetch;

type TerminalTestServer = {
  url: string;
  close: () => Promise<void>;
};

const terminalTestServers: TerminalTestServer[] = [];

async function listen(httpServer: Server): Promise<number> {
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const address = httpServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('terminal_test_server_address_unavailable');
  }
  return address.port;
}

async function startTerminalWsTestServer(
  onConnection: (socket: ServerWebSocket, requestUrl: string) => void,
): Promise<TerminalTestServer> {
  const httpServer = createServer();
  const wsServer = new WebSocketServer({ server: httpServer });
  wsServer.on('connection', (socket, request) => {
    onConnection(socket, request.url ?? '/');
  });
  const port = await listen(httpServer);
  const server = {
    url: `ws://127.0.0.1:${port}`,
    close: async () => {
      for (const client of wsServer.clients) {
        client.close();
      }
      await new Promise<void>((resolve, reject) => {
        wsServer.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
  terminalTestServers.push(server);
  return server;
}

async function startRejectedUpgradeServer(statusCode: 401 | 403): Promise<TerminalTestServer> {
  const httpServer = createServer();
  httpServer.on('upgrade', (_request, socket) => {
    socket.write(`HTTP/1.1 ${statusCode} Unauthorized\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  });
  const port = await listen(httpServer);
  const server = {
    url: `ws://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
  terminalTestServers.push(server);
  return server;
}

function parseClientFrame(raw: Buffer): Record<string, unknown> {
  return JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
}

async function withMockKubectlPodSnapshot<T>(
  payload: Record<string, unknown> | Record<string, unknown>[],
  run: (input: { argLogPath: string }) => Promise<T>,
): Promise<T> {
  const previousPath = process.env.PATH;
  const previousNamespace = process.env.INTERNAL_AGENT_K8S_NAMESPACE;
  const previousKubectlArgLog = process.env.KUBECTL_ARG_LOG;
  const previousKubectlStatePath = process.env.KUBECTL_STATE_PATH;
  const binDir = await mkdtemp(path.join(tmpdir(), 'agentsmith-kubectl-'));
  const kubectlPath = path.join(binDir, 'kubectl');
  const argLogPath = path.join(binDir, 'kubectl-args.log');
  const statePath = path.join(binDir, 'kubectl-state.json');
  const script = [
    '#!/usr/bin/env node',
    'const fs = require("node:fs");',
    'const logPath = process.env.KUBECTL_ARG_LOG;',
    'const statePath = process.env.KUBECTL_STATE_PATH;',
    'const args = process.argv.slice(2);',
    'if (logPath) fs.appendFileSync(logPath, args.join(" ") + "\\n");',
    `const snapshots = ${JSON.stringify(Array.isArray(payload) ? payload : [payload])};`,
    'let callIndex = 0;',
    'if (statePath && fs.existsSync(statePath)) {',
    '  callIndex = Number(JSON.parse(fs.readFileSync(statePath, "utf8")).callIndex || 0);',
    '}',
    'const payload = snapshots[Math.min(callIndex, snapshots.length - 1)] || {};',
    'if (statePath) fs.writeFileSync(statePath, JSON.stringify({ callIndex: callIndex + 1 }));',
    'const selector = args[args.indexOf("-l") + 1] || "";',
    'const output = args[args.indexOf("-o") + 1] || "json";',
    'const items = Array.isArray(payload.items) ? payload.items : [];',
    'const readLabel = (item, key) => {',
    '  const value = item && item.metadata && item.metadata.labels && item.metadata.labels[key];',
    '  return typeof value === "string" ? value : "";',
    '};',
    'const filtered = items.filter((item) => {',
    '  if (selector === "app=managed-workload") return readLabel(item, "app") === "managed-workload";',
    '  if (selector.startsWith("workload_id=")) return readLabel(item, "workload_id") === selector.slice("workload_id=".length);',
    '  return true;',
    '});',
    'if (output === "json") {',
    '  process.stdout.write(JSON.stringify({ ...payload, items: filtered }));',
    '  process.stdout.write("\\n");',
    '  process.exit(0);',
    '}',
    'if (output.includes(".items[*].metadata.name")) {',
    '  process.stdout.write(filtered.map((item) => item && item.metadata && item.metadata.name || "").filter(Boolean).join(" "));',
    '  process.exit(0);',
    '}',
    'if (output.includes(".items[0].metadata.name") && output.includes(".items[0].metadata.uid")) {',
    '  const item = filtered[0];',
    '  if (item) process.stdout.write(`${item.metadata?.name || ""}\\n${item.metadata?.uid || ""}`);',
    '  process.exit(0);',
    '}',
    'if (output.includes(".items[0].metadata.name")) {',
    '  const item = filtered[0];',
    '  if (item) process.stdout.write(item.metadata?.name || "");',
    '  process.exit(0);',
    '}',
  ].join('\n');

  await writeFile(kubectlPath, script, { mode: 0o755 });
  process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.KUBECTL_ARG_LOG = argLogPath;
  process.env.KUBECTL_STATE_PATH = statePath;
  process.env.INTERNAL_AGENT_K8S_NAMESPACE = 'agentsmith-sandbox';

  try {
    return await run({ argLogPath });
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousNamespace === undefined) delete process.env.INTERNAL_AGENT_K8S_NAMESPACE;
    else process.env.INTERNAL_AGENT_K8S_NAMESPACE = previousNamespace;
    if (previousKubectlArgLog === undefined) delete process.env.KUBECTL_ARG_LOG;
    else process.env.KUBECTL_ARG_LOG = previousKubectlArgLog;
    if (previousKubectlStatePath === undefined) delete process.env.KUBECTL_STATE_PATH;
    else process.env.KUBECTL_STATE_PATH = previousKubectlStatePath;
    await rm(binDir, { recursive: true, force: true });
  }
}

afterEach(async () => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
  const servers = terminalTestServers.splice(0);
  await Promise.all(servers.map((server) => server.close()));
});

describe('integration-real-helpers', () => {
  const okResponse = <T,>(body: T) => ({
    ok: () => true,
    status: () => 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

  it('bounds spawned diagnostic commands with an explicit timeout', async () => {
    const result = await spawnAndCapture(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      {
        timeoutMs: 50,
        timeoutLabel: 'unit_spawn_timeout',
        killGraceMs: 50,
      },
    );

    expect(result.code).toBe(124);
    expect(result.stderr).toContain('spawn_timeout:unit_spawn_timeout:timeout_ms=50');
  });

  describe('terminal session API helper', () => {
    const terminalSessionRecord = (
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> => ({
      terminal_session_id: 'term_canonical',
      runner_id: 'runner_1',
      runner_session_id: 'task_1',
      status: 'running',
      ws_url: 'ws://127.0.0.1:20000/terminal/term_canonical',
      close_reason: null,
      created_at: '2026-05-05T00:00:00.000Z',
      last_activity_at: '2026-05-05T00:00:00.000Z',
      ended_at: null,
      exit_code: null,
      cols: 120,
      rows: 40,
      ...overrides,
    });

    it('uses canonical terminal_session_id from create-session payloads', async () => {
      const post = vi.fn().mockResolvedValue(okResponse({
        terminal_session_id: 'term_canonical',
        session_id: 'term_legacy',
        runner_id: 'runner_1',
        runner_session_id: 'task_1',
        ws_url: 'ws://127.0.0.1:20000/terminal/term_canonical',
      }));
      const page = {
        evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
        request: { post },
      } as unknown as Parameters<typeof createTerminalSessionViaApi>[0]['page'];

      await expect(createTerminalSessionViaApi({
        page,
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
      })).resolves.toEqual({
        sessionId: 'term_canonical',
        wsUrl: 'ws://127.0.0.1:20000/terminal/term_canonical',
        runnerId: 'runner_1',
        runnerSessionId: 'task_1',
      });
      expect(post).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_1/terminal/sessions'),
        expect.objectContaining({
          timeout: 300_000,
          data: {
            cols: 120,
            rows: 40,
          },
        }),
      );
    });

    it('keeps terminal create request timeout aligned with managed runner startup SLA', async () => {
      expect(resolveTerminalSessionCreateTimeoutMs({})).toBe(300_000);
      expect(resolveTerminalSessionCreateTimeoutMs({
        INTEGRATION_TERMINAL_SESSION_CREATE_TIMEOUT_MS: '90000',
      })).toBe(90_000);

      const post = vi.fn().mockRejectedValue(new Error('apiRequestContext.post: Timeout 15000ms exceeded'));
      const page = {
        evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
        request: { post },
      } as unknown as Parameters<typeof createTerminalSessionViaApi>[0]['page'];

      await expect(createTerminalSessionViaApi({
        page,
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
      })).rejects.toThrow('create_terminal_session_request_failed:task_1:timeout_ms=300000');
      expect(post).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_1/terminal/sessions'),
        expect.objectContaining({
          timeout: 300_000,
        }),
      );
    });

    it('rejects create-session payloads that only expose legacy session_id', async () => {
      const post = vi.fn().mockResolvedValue(okResponse({
        session_id: 'term_legacy',
        ws_url: 'ws://127.0.0.1:20000/terminal/term_legacy',
      }));
      const page = {
        evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
        request: { post },
      } as unknown as Parameters<typeof createTerminalSessionViaApi>[0]['page'];

      await expect(createTerminalSessionViaApi({
        page,
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
      })).rejects.toThrow('terminal_session_payload_incomplete');
    });

    it('matches terminal runner evidence against listed terminal_session_id only', async () => {
      const get = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/terminal/sessions')) {
          return okResponse({
            total: 2,
            items: [
              terminalSessionRecord({
                terminal_session_id: 'term_shadow',
                id: 'term_canonical',
                session_id: 'term_canonical',
                runner_id: 'runner_shadow',
                runner_session_id: 'task_shadow',
              }),
              terminalSessionRecord(),
            ],
          });
        }
        if (url.endsWith('/terminal/sessions/term_canonical')) {
          return okResponse(terminalSessionRecord());
        }
        throw new Error(`unexpected_get:${url}`);
      });
      const page = {
        evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
        request: { get },
      } as unknown as Parameters<typeof expectTerminalSessionRunnerEvidenceViaApi>[0]['page'];

      await expect(expectTerminalSessionRunnerEvidenceViaApi({
        page,
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        sessionId: 'term_canonical',
        runnerId: 'runner_1',
        timeoutMs: 50,
      })).resolves.toMatchObject({
        terminal_session_id: 'term_canonical',
        runner_id: 'runner_1',
        runner_session_id: 'task_1',
      });
    });

    it('rejects terminal runner evidence list entries that only expose legacy id/session_id', async () => {
      const get = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/terminal/sessions')) {
          return okResponse({
            total: 1,
            items: [
              terminalSessionRecord({
                terminal_session_id: undefined,
                id: 'term_canonical',
                session_id: 'term_canonical',
              }),
            ],
          });
        }
        if (url.endsWith('/terminal/sessions/term_canonical')) {
          return okResponse(terminalSessionRecord());
        }
        throw new Error(`unexpected_get:${url}`);
      });
      const page = {
        evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
        request: { get },
      } as unknown as Parameters<typeof expectTerminalSessionRunnerEvidenceViaApi>[0]['page'];

      await expect(expectTerminalSessionRunnerEvidenceViaApi({
        page,
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        sessionId: 'term_canonical',
        runnerId: 'runner_1',
        timeoutMs: 50,
      })).rejects.toThrow();
    });

    it('polls terminal close final truth from session get and list instead of browser socket state', async () => {
      let sessionReadCount = 0;
      const get = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/terminal/sessions')) {
          return okResponse({
            total: 1,
            items: [
              terminalSessionRecord({
                terminal_session_id: 'term_canonical',
                status: 'closing',
                close_state: 'delivered',
                close_deadline_at: '2026-05-05T00:01:00.000Z',
              }),
            ],
          });
        }
        if (url.endsWith('/terminal/sessions/term_canonical')) {
          sessionReadCount += 1;
          return okResponse(terminalSessionRecord({
            status: sessionReadCount === 1 ? 'closing' : 'closed',
            close_state: sessionReadCount === 1 ? 'delivered' : 'closed',
            close_attempt_id: 'close_attempt_1',
            close_ack_status: sessionReadCount === 1 ? null : 'closed',
          }));
        }
        throw new Error(`unexpected_get:${url}`);
      });
      const page = {
        evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
        request: { get },
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Parameters<typeof waitForTerminalSessionFinalTruthViaApi>[0]['page'];

      await expect(waitForTerminalSessionFinalTruthViaApi({
        page,
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        sessionId: 'term_canonical',
        timeoutMs: 1_000,
        pollIntervalMs: 1,
      })).resolves.toMatchObject({
        sessionId: 'term_canonical',
        outcome: 'closed',
        closeState: 'closed',
        closeAttemptId: 'close_attempt_1',
        closeAckStatus: 'closed',
      });
      expect(page.waitForTimeout).toHaveBeenCalled();
    });

    it('uses terminal_session_id, not legacy id, when deciding whether a closed session is still listed', async () => {
      const get = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/terminal/sessions')) {
          return okResponse({
            total: 1,
            items: [
              terminalSessionRecord({
                terminal_session_id: 'term_different',
                id: 'term_canonical',
                session_id: 'term_canonical',
                status: 'active',
              }),
            ],
          });
        }
        if (url.endsWith('/terminal/sessions/term_canonical')) {
          return {
            ok: () => false,
            status: () => 404,
            json: async () => ({ message: 'not found' }),
            text: async () => JSON.stringify({ message: 'not found' }),
          };
        }
        throw new Error(`unexpected_get:${url}`);
      });
      const page = {
        evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
        request: { get },
        waitForTimeout: vi.fn(),
      } as unknown as Parameters<typeof waitForTerminalSessionFinalTruthViaApi>[0]['page'];

      await expect(waitForTerminalSessionFinalTruthViaApi({
        page,
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        sessionId: 'term_canonical',
        timeoutMs: 50,
      })).resolves.toMatchObject({
        sessionId: 'term_canonical',
        outcome: 'closed',
        listedSession: null,
        getStatus: 404,
      });
      expect(page.waitForTimeout).not.toHaveBeenCalled();
    });

    it('includes close ack and diagnostic fields when terminal close truth does not converge', async () => {
      const get = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/terminal/sessions')) {
          return okResponse({
            total: 1,
            items: [
              terminalSessionRecord({
                terminal_session_id: 'term_canonical',
                status: 'closing',
                close_state: 'delivered',
                close_deadline_at: '2026-05-05T00:01:00.000Z',
                close_attempt_id: 'close_attempt_timeout',
                close_ack_status: 'error',
                close_diagnostic_code: 'process_tree_still_alive',
                close_diagnostic: { remaining_pid_count: 1 },
                diagnostics: { close: 'runner_ack_error' },
              }),
            ],
          });
        }
        if (url.endsWith('/terminal/sessions/term_canonical')) {
          return okResponse(terminalSessionRecord({
            status: 'closing',
            close_state: 'delivered',
            close_deadline_at: '2026-05-05T00:01:00.000Z',
            close_attempt_id: 'close_attempt_timeout',
            close_ack_status: 'error',
            close_diagnostic_code: 'process_tree_still_alive',
            close_diagnostic: { remaining_pid_count: 1 },
            diagnostics: { close: 'runner_ack_error' },
          }));
        }
        throw new Error(`unexpected_get:${url}`);
      });
      const page = {
        evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
        request: { get },
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Parameters<typeof waitForTerminalSessionFinalTruthViaApi>[0]['page'];

      await expect(waitForTerminalSessionFinalTruthViaApi({
        page,
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        sessionId: 'term_canonical',
        timeoutMs: 1,
        pollIntervalMs: 1,
      })).rejects.toThrow(
        /terminal_session_close_truth_timeout:[\s\S]*close_state[\s\S]*close_deadline_at[\s\S]*close_attempt_id[\s\S]*close_ack_status[\s\S]*close_diagnostic_code[\s\S]*close_diagnostic[\s\S]*diagnostics/,
      );
    });
  });

  describe('terminal websocket command helper', () => {
    it('sends terminal.reconnect before resize/stdin and collects terminal.output chunks', async () => {
      const clientFrames: Record<string, unknown>[] = [];
      const server = await startTerminalWsTestServer((socket) => {
        socket.on('message', (raw) => {
          const frame = parseClientFrame(raw as Buffer);
          clientFrames.push(frame);
          if (frame.type === 'terminal.reconnect') {
            socket.send(JSON.stringify({
              type: 'terminal.replay_start',
              terminal_session_id: 'term_1',
              status: 'complete',
              gap: false,
              earliest_seq: 1,
              latest_seq: 1,
            }));
            socket.send(JSON.stringify({
              type: 'terminal.output',
              terminal_session_id: 'term_1',
              seq: 1,
              chunk: 'boot\n',
            }));
            socket.send(JSON.stringify({
              type: 'terminal.replay_end',
              terminal_session_id: 'term_1',
              status: 'complete',
              gap: false,
              latest_seq: 1,
              input_enabled: true,
            }));
            return;
          }
          if (frame.type === 'terminal.stdin') {
            socket.send(JSON.stringify({
              type: 'terminal.output',
              terminal_session_id: 'term_1',
              seq: 2,
              chunk: 'READY\n',
            }));
          }
        });
      });

      const output = await runTerminalCommandViaWs({
        wsUrl: server.url,
        terminalSessionId: 'term_1',
        command: 'echo READY',
        waitFor: ['boot', 'READY'],
        timeoutMs: 2_000,
      });

      expect(output).toContain('boot');
      expect(output).toContain('READY');
      expect(clientFrames.map((frame) => frame.type)).toEqual([
        'terminal.reconnect',
        'terminal.resize',
        'terminal.stdin',
      ]);
      expect(clientFrames[0]).toMatchObject({
        type: 'terminal.reconnect',
        terminal_session_id: 'term_1',
        cols: 120,
        rows: 40,
      });
      expect(clientFrames[0]).not.toHaveProperty('view');
    });

    it('does not send resize/stdin until terminal input is enabled', async () => {
      const clientFrames: Record<string, unknown>[] = [];
      let resolvePreReadyFrames: (types: unknown[]) => void = () => undefined;
      const preReadyFrames = new Promise<unknown[]>((resolve) => {
        resolvePreReadyFrames = resolve;
      });
      const server = await startTerminalWsTestServer((socket) => {
        socket.on('message', (raw) => {
          const frame = parseClientFrame(raw as Buffer);
          clientFrames.push(frame);
          if (frame.type === 'terminal.reconnect') {
            socket.send(JSON.stringify({
              type: 'terminal.replay_start',
              terminal_session_id: 'term_1',
              status: 'complete',
              gap: false,
              earliest_seq: 1,
              latest_seq: 1,
            }));
            socket.send(JSON.stringify({
              type: 'terminal.replay_end',
              terminal_session_id: 'term_1',
              status: 'complete',
              gap: false,
              latest_seq: 1,
              input_enabled: false,
            }));
            setTimeout(() => {
              resolvePreReadyFrames(clientFrames.map((seenFrame) => seenFrame.type));
              socket.send(JSON.stringify({
                type: 'terminal.state',
                terminal_session_id: 'term_1',
                state: 'ready',
                input_enabled: true,
              }));
            }, 25);
            return;
          }
          if (frame.type === 'terminal.stdin') {
            socket.send(JSON.stringify({
              type: 'terminal.output',
              terminal_session_id: 'term_1',
              seq: 1,
              chunk: 'STATE_READY_DONE\n',
            }));
          }
        });
      });

      const commandPromise = runTerminalCommandViaWs({
        wsUrl: server.url,
        terminalSessionId: 'term_1',
        command: 'printf STATE_READY_DONE',
        waitFor: ['STATE_READY_DONE'],
        timeoutMs: 2_000,
      });

      await expect(preReadyFrames).resolves.toEqual(['terminal.reconnect']);
      await expect(commandPromise).resolves.toContain('STATE_READY_DONE');
      expect(clientFrames.map((frame) => frame.type)).toEqual([
        'terminal.reconnect',
        'terminal.resize',
        'terminal.stdin',
      ]);
    });

    it('treats terminal.state recovering as live wait and still waits for input_enabled=true', async () => {
      const clientFrames: Record<string, unknown>[] = [];
      let resolvePreReadyFrames: (types: unknown[]) => void = () => undefined;
      const preReadyFrames = new Promise<unknown[]>((resolve) => {
        resolvePreReadyFrames = resolve;
      });
      const server = await startTerminalWsTestServer((socket) => {
        socket.on('message', (raw) => {
          const frame = parseClientFrame(raw as Buffer);
          clientFrames.push(frame);
          if (frame.type === 'terminal.reconnect') {
            socket.send(JSON.stringify({
              type: 'terminal.state',
              terminal_session_id: 'term_recovering',
              state: 'recovering',
              status: 'recovering',
              input_enabled: false,
            }));
            setTimeout(() => {
              resolvePreReadyFrames(clientFrames.map((seenFrame) => seenFrame.type));
              socket.send(JSON.stringify({
                type: 'terminal.state',
                terminal_session_id: 'term_recovering',
                state: 'ready',
                status: 'active',
                input_enabled: true,
              }));
            }, 25);
            return;
          }
          if (frame.type === 'terminal.stdin') {
            socket.send(JSON.stringify({
              type: 'terminal.output',
              terminal_session_id: 'term_recovering',
              seq: 1,
              chunk: 'RECOVERED_DONE\n',
            }));
          }
        });
      });

      const commandPromise = runTerminalCommandViaWs({
        wsUrl: server.url,
        terminalSessionId: 'term_recovering',
        command: 'printf RECOVERED_DONE',
        waitFor: ['RECOVERED_DONE'],
        timeoutMs: 2_000,
      });

      await expect(preReadyFrames).resolves.toEqual(['terminal.reconnect']);
      await expect(commandPromise).resolves.toContain('RECOVERED_DONE');
      expect(clientFrames.map((frame) => frame.type)).toEqual([
        'terminal.reconnect',
        'terminal.resize',
        'terminal.stdin',
      ]);
    });

    it('fails explicitly on terminal.error with error code and message', async () => {
      const server = await startTerminalWsTestServer((socket) => {
        socket.on('message', () => {
          socket.send(JSON.stringify({
            type: 'terminal.error',
            terminal_session_id: 'term_1',
            error_code: 'handshake_required',
            error_message: 'terminal.reconnect must be sent first',
          }));
          socket.close();
        });
      });

      await expect(runTerminalCommandViaWs({
        wsUrl: server.url,
        terminalSessionId: 'term_1',
        command: 'echo never',
        waitFor: ['never'],
        timeoutMs: 1_000,
      })).rejects.toThrow('terminal_ws_error:handshake_required:terminal.reconnect must be sent first');
    });

    it('rejects terminal websocket frames that only carry legacy session_id', async () => {
      const server = await startTerminalWsTestServer((socket) => {
        socket.on('message', (raw) => {
          const frame = parseClientFrame(raw as Buffer);
          if (frame.type === 'terminal.reconnect') {
            socket.send(JSON.stringify({
              type: 'terminal.output',
              session_id: 'term_1',
              chunk: 'legacy session frame\n',
            }));
          }
        });
      });

      await expect(runTerminalCommandViaWs({
        wsUrl: server.url,
        terminalSessionId: 'term_1',
        command: 'echo never',
        waitFor: ['never'],
        timeoutMs: 1_000,
      })).rejects.toThrow('legacy_terminal_ws_session_id_not_supported');
    });

    it('rejects legacy generic terminal websocket error frames', async () => {
      const server = await startTerminalWsTestServer((socket) => {
        socket.on('message', (raw) => {
          const frame = parseClientFrame(raw as Buffer);
          if (frame.type === 'terminal.reconnect') {
            socket.send(JSON.stringify({
              type: 'error',
              terminal_session_id: 'term_1',
              code: 'legacy_error',
              message: 'legacy error frame',
            }));
          }
        });
      });

      await expect(runTerminalCommandViaWs({
        wsUrl: server.url,
        terminalSessionId: 'term_1',
        command: 'echo never',
        waitFor: ['never'],
        timeoutMs: 1_000,
      })).rejects.toThrow('legacy_terminal_ws_error_frame_not_supported');
    });

    it('gets a fresh ws_url before retrying a not-ready terminal websocket connection', async () => {
      const connections: string[] = [];
      const server = await startTerminalWsTestServer((socket, requestUrl) => {
        connections.push(requestUrl);
        if (requestUrl === '/ticket-1') {
          socket.close();
          return;
        }
        socket.on('message', (raw) => {
          const frame = parseClientFrame(raw as Buffer);
          if (frame.type === 'terminal.reconnect') {
            socket.send(JSON.stringify({
              type: 'terminal.replay_end',
              terminal_session_id: 'term_1',
              status: 'complete',
              gap: false,
              latest_seq: 0,
              input_enabled: true,
            }));
            return;
          }
          if (frame.type === 'terminal.stdin') {
            socket.send(JSON.stringify({
              type: 'terminal.output',
              terminal_session_id: 'term_1',
              seq: 1,
              chunk: 'FRESH_TICKET_DONE\n',
            }));
          }
        });
      });
      let sessionReadCount = 0;
      const get = vi.fn().mockImplementation(async () => {
        sessionReadCount += 1;
        return okResponse({ ws_url: `${server.url}/ticket-${sessionReadCount}` });
      });
      const page = {
        evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
        request: { get },
      } as unknown as Parameters<typeof runTerminalCommandInSession>[0]['page'];

      const output = await runTerminalCommandInSession({
        page,
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        sessionId: 'term_1',
        command: 'printf FRESH_TICKET_DONE',
        waitFor: ['FRESH_TICKET_DONE'],
        timeoutMs: 3_000,
      });

      expect(output).toContain('FRESH_TICKET_DONE');
      expect(get).toHaveBeenCalledTimes(2);
      expect(connections).toEqual(['/ticket-1', '/ticket-2']);
    });

    it('limits terminal websocket auth failures to one fresh-ticket retry', async () => {
      const server = await startRejectedUpgradeServer(401);
      const get = vi.fn().mockResolvedValue(okResponse({ ws_url: server.url }));
      const page = {
        evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
        request: { get },
      } as unknown as Parameters<typeof runTerminalCommandInSession>[0]['page'];

      await expect(runTerminalCommandInSession({
        page,
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        sessionId: 'term_1',
        command: 'echo never',
        waitFor: ['never'],
        timeoutMs: 3_000,
      })).rejects.toThrow('terminal_ws_auth_failed:Unexpected server response: 401');
      expect(get).toHaveBeenCalledTimes(2);
    });
  });

  it('keeps workspace landing path builders sourced from the shared helper instead of the app boundary', async () => {
    const source = await readFile(path.resolve('e2e/integration-real-helpers.ts'), 'utf8');

    expect(source).toMatch(/from ["']@mbos\/contracts\/src\/auth-handoff-paths["']/);
    expect(source).not.toContain("from '../src/lib/auth/invite-handoff'");
  });

  it('creates an external connection through the API without mutating page state', async () => {
    const post = vi.fn().mockResolvedValue({
      ok: () => true,
      status: 201,
      json: async () => ({ id: 'uec_seed_1' }),
    });
    const request = { post } as unknown as APIRequestContext;

    const id = await createExternalConnectionViaApi({
      request,
      token: 'mock_token_user_001_12345',
      provider: 'custom',
      kind: 'secret_bundle',
      customDomain: 'custom.local',
      displayName: 'Seeded Connection',
      note: 'seeded via api',
      fields: [
        { key: 'base_url', value: 'https://api.visual.example.com', description: 'Base URL', secret: false },
      ],
    });

    expect(id).toBe('uec_seed_1');
    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/me/external-connections'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer mock_token_user_001_12345',
        }),
        data: expect.objectContaining({
          custom_domain: 'custom.local',
        }),
      }),
    );
  });

  it('fails when the explicit token is missing', async () => {
    const request = { post: vi.fn() } as unknown as APIRequestContext;

    await expect(createExternalConnectionViaApi({
      request,
      token: '   ',
      provider: 'custom',
      kind: 'secret_bundle',
      displayName: 'Seeded Connection',
      fields: [],
    })).rejects.toThrow('auth_token_not_found_for_external_connection_seed');
  });

  it('creates project request bodies without duplicating URL workspace truth', () => {
    const payload = buildCreateProjectRequestBody('Agent Task Project', {
      visibility: 'private',
      joinPolicy: 'approval_required',
    });

    expect(payload).toEqual({
      name: 'Agent Task Project',
      visibility: 'private',
      join_policy: 'approval_required',
    });
    expect(payload).not.toHaveProperty('workspace_id');
  });

  it('posts project creation with workspace only in the URL', async () => {
    let currentUrl = 'about:blank';
    const post = vi.fn().mockResolvedValue(okResponse({ id: 'proj_created' }));
    const page = {
      constructor: { name: 'Page' },
      context: vi.fn(() => ({ _options: {} })),
      evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
      goto: vi.fn(async (url: string) => {
        currentUrl = url;
      }),
      locator: vi.fn(() => ({
        textContent: vi.fn().mockResolvedValue('project overview loaded'),
      })),
      mainFrame: vi.fn(() => ({
        _expect: vi.fn(async () => ({
          log: [],
          matches: true,
          received: currentUrl,
        })),
      })),
      request: { post },
      url: vi.fn(() => currentUrl),
      waitForFunction: vi.fn(),
      waitForTimeout: vi.fn(),
    } as unknown as Parameters<typeof createProjectInWorkspace>[0];
    const options = {
      visibility: 'public',
      joinPolicy: 'open',
      workspace_id: 'ws_body_regression',
    } as const;

    await createProjectInWorkspace(
      page,
      'ws_url_truth',
      'Agent Task Project',
      options,
    );

    expect(post).toHaveBeenCalledWith(
      `${API_BASE}/api/v1/workspaces/ws_url_truth/projects`,
      expect.objectContaining({
        data: {
          name: expect.stringMatching(/^Agent Task Project \d+$/),
          visibility: 'public',
          join_policy: 'open',
        },
      }),
    );
    const [, requestOptions] = post.mock.calls[0] ?? [];
    expect(requestOptions?.data).not.toHaveProperty('workspace_id');
    expect(requestOptions?.data).not.toHaveProperty('workspaceId');
  });

  it('extracts the prepared task workspace cwd from Agent task runner debug logs', () => {
    const logText = [
      '[agent-task-runner][debug] received start {"task_id":"task_123"}',
      '[agent-task-runner][debug] prepared task workspace {"cwd":"/home/task_123/workspace","codex_config":"/home/task_123/.codex/config.toml"}',
    ].join('\n');

    expect(findPreparedTaskWorkspaceRootInRunnerLog(logText)).toBe('/home/task_123/workspace');
  });

  it('prefers the latest prepared task workspace entry when a runner reconnects across tasks', () => {
    const logText = [
      '[agent-task-runner][debug] prepared task workspace {"cwd":"/home/task_old/workspace"}',
      '[agent-task-runner][debug] prepared task workspace {"cwd":"/home/task_new/workspace"}',
    ].join('\n');

    expect(findPreparedTaskWorkspaceRootInRunnerLog(logText)).toBe('/home/task_new/workspace');
  });

  it('returns null when the runner log has not yet declared a prepared task workspace', () => {
    expect(findPreparedTaskWorkspaceRootInRunnerLog('[agent-task-runner] connected')).toBeNull();
  });

  it('parses workload pod readiness truth from kubernetes pod list payloads', () => {
    const payload = JSON.stringify({
      items: [
        {
          metadata: { name: 'workload-pod-1', uid: 'pod-uid-1' },
          status: {
            phase: 'Running',
            conditions: [
              { type: 'Ready', status: 'True' },
            ],
            containerStatuses: [
              { ready: true, state: { running: {} } },
            ],
          },
        },
      ],
    });

    expect(parseWorkloadPodSnapshot(payload)).toMatchObject({
      name: 'workload-pod-1',
      uid: 'pod-uid-1',
      phase: 'Running',
      ready: true,
      containerReadyCount: 1,
      containerCount: 1,
    });
  });

  it('retains waiting reasons when a workload pod exists but is not ready yet', () => {
    const payload = JSON.stringify({
      items: [
        {
          metadata: { name: 'workload-pod-2', uid: 'pod-uid-2' },
          status: {
            phase: 'Pending',
            conditions: [
              { type: 'Ready', status: 'False', reason: 'ContainersNotReady' },
            ],
            containerStatuses: [
              {
                ready: false,
                state: { waiting: { reason: 'ContainerCreating' } },
              },
            ],
          },
        },
      ],
    });

    expect(parseWorkloadPodSnapshot(payload)).toMatchObject({
      name: 'workload-pod-2',
      uid: 'pod-uid-2',
      phase: 'Pending',
      ready: false,
      readyReason: 'ContainersNotReady',
      reason: 'ContainerCreating',
      containerReadyCount: 0,
      containerCount: 1,
    });
  });

  it('parses init container readiness and failure reasons from workload pods', () => {
    const failedPayload = JSON.stringify({
      items: [
        {
          metadata: { name: 'workload-pod-init-failed', uid: 'pod-uid-init-failed' },
          status: {
            phase: 'Failed',
            reason: 'PodInitializing',
            initContainerStatuses: [
              {
                ready: false,
                state: { terminated: { reason: 'Error', exitCode: 1 } },
              },
            ],
            containerStatuses: [
              {
                ready: false,
                state: { waiting: { reason: 'PodInitializing' } },
              },
            ],
          },
        },
      ],
    });

    expect(parseWorkloadPodSnapshot(failedPayload)).toMatchObject({
      name: 'workload-pod-init-failed',
      phase: 'Failed',
      initContainerReadyCount: 0,
      initContainerCount: 1,
      initReason: 'Error',
      initExitCode: 1,
      reason: 'PodInitializing',
    });

    const waitingPayload = JSON.stringify({
      items: [
        {
          metadata: { name: 'workload-pod-init-waiting', uid: 'pod-uid-init-waiting' },
          status: {
            phase: 'Pending',
            initContainerStatuses: [
              {
                ready: false,
                state: { terminated: { reason: 'Completed', exitCode: 0 } },
              },
              {
                ready: false,
                state: { waiting: { reason: 'ImagePullBackOff' } },
              },
            ],
            containerStatuses: [
              {
                ready: false,
                state: { waiting: { reason: 'PodInitializing' } },
              },
            ],
          },
        },
      ],
    });

    expect(parseWorkloadPodSnapshot(waitingPayload)).toMatchObject({
      name: 'workload-pod-init-waiting',
      phase: 'Pending',
      initContainerReadyCount: 1,
      initContainerCount: 2,
      initReason: 'ImagePullBackOff',
      initExitCode: 0,
      reason: 'PodInitializing',
    });
  });

  it('summarizes recent workload pod events with conservative secret redaction', () => {
    const payload = JSON.stringify({
      items: Array.from({ length: 10 }, (_, index) => ({
        type: index % 2 === 0 ? 'Warning' : 'Normal',
        reason: `Reason${index}`,
        message: [
          `event ${index}`,
          'Authorization: Bearer abc.def.secret',
          'OPENAI sk-testsecret123',
          'token=plain-token-value',
          'api_key=plain-api-key-value',
          'password=plain-password-value',
          'secret=plain-secret-value',
          'MBOS_AGENT_KEY=agent-key-value',
          'ASBCP_SERVICE_KEY=service-key-value',
        ].join(' '),
        count: index + 1,
        lastTimestamp: `2026-05-12T12:${String(index).padStart(2, '0')}:00Z`,
      })),
    });

    const summary = summarizeWorkloadPodEvents(payload);
    const serialized = summary.join('\n');

    expect(summary).toHaveLength(8);
    expect(summary[0]).toContain('Warning/Reason2 count=3 last=2026-05-12T12:02:00Z');
    expect(summary[7]).toContain('Normal/Reason9 count=10 last=2026-05-12T12:09:00Z');
    expect(serialized).not.toContain('Reason0');
    expect(serialized).not.toContain('Reason1');
    expect(serialized).not.toContain('abc.def.secret');
    expect(serialized).not.toContain('sk-testsecret123');
    expect(serialized).not.toContain('plain-token-value');
    expect(serialized).not.toContain('plain-api-key-value');
    expect(serialized).not.toContain('plain-password-value');
    expect(serialized).not.toContain('plain-secret-value');
    expect(serialized).not.toContain('agent-key-value');
    expect(serialized).not.toContain('service-key-value');
    expect(serialized).toContain('Bearer <redacted>');
    expect(serialized).toContain('sk-<redacted>');
    expect(serialized).toContain('token=<redacted>');
    expect(serialized).toContain('api_key=<redacted>');
    expect(serialized).toContain('password=<redacted>');
    expect(serialized).toContain('secret=<redacted>');
    expect(serialized).toContain('MBOS_AGENT_KEY=<redacted>');
    expect(serialized).toContain('ASBCP_SERVICE_KEY=<redacted>');
  });

  it('selects expired workload pods for manager-mediated release using raw annotations and expires_at', () => {
    const payload = JSON.stringify({
      items: [
        {
          metadata: {
            name: 'asbcp-ws-default-proj-1-task-target-15772034fcfa',
            labels: {
              app: 'managed-workload',
              workspace_id: 'ws_default',
              project_id: 'proj_1',
              workload_id: 'task-target-15772034fcfa',
            },
            annotations: {
              'mbos.io/workspace-id': 'ws_default',
              'mbos.io/project-id': 'proj_1',
              'mbos.io/workload-id': 'task-target',
              expires_at: '2026-05-12T12:00:00Z',
            },
            finalizers: ['example.com/finalizer'],
          },
        },
        {
          metadata: {
            name: 'workload-active',
            labels: {
              app: 'managed-workload',
              workspace_id: 'ws_default',
              project_id: 'proj_1',
              workload_id: 'task-target-15772034fcfa',
            },
            annotations: {
              'mbos.io/workspace-id': 'ws_default',
              'mbos.io/project-id': 'proj_1',
              'mbos.io/workload-id': 'task-target',
              expires_at: '2026-05-12T12:10:00Z',
            },
          },
        },
        {
          metadata: {
            name: 'workload-other',
            labels: {
              app: 'managed-workload',
              workspace_id: 'ws_default',
              project_id: 'proj_1',
              workload_id: 'task-other-15772034fcfa',
            },
            annotations: {
              'mbos.io/workspace-id': 'ws_default',
              'mbos.io/project-id': 'proj_1',
              'mbos.io/workload-id': 'task-other',
              expires_at: '2026-05-12T11:00:00Z',
            },
          },
        },
        {
          metadata: {
            name: 'workload-prefix-conflict',
            labels: {
              app: 'managed-workload',
              workspace_id: 'ws_default',
              project_id: 'proj_1',
              workload_id: 'task-target-extra-15772034fcfa',
            },
            annotations: {
              'mbos.io/workspace-id': 'ws_default',
              'mbos.io/project-id': 'proj_1',
              'mbos.io/workload-id': 'task-target-extra',
              expires_at: '2026-05-12T11:30:00Z',
            },
          },
        },
        {
          metadata: {
            name: 'workload-labels-only',
            labels: {
              app: 'managed-workload',
              workspace_id: 'ws_default',
              project_id: 'proj_1',
              workload_id: 'task-target-15772034fcfa',
            },
            annotations: {
              expires_at: '2026-05-12T11:45:00Z',
            },
          },
        },
      ],
    });

    expect(selectExpiredWorkloadReleaseTargets({
      payload,
      now: new Date('2026-05-12T12:05:00Z'),
      workloadId: 'task-target',
    })).toEqual([
      {
        podName: 'asbcp-ws-default-proj-1-task-target-15772034fcfa',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        workloadId: 'task-target',
        expiresAt: '2026-05-12T12:00:00Z',
        finalizers: ['example.com/finalizer'],
      },
    ]);
  });

  it('releases expired managed workload through ASBCP with raw spec identity instead of derived pod labels', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const previousBaseUrl = process.env.ASBCP_INTERNAL_BASE_URL;
    const previousServiceKey = process.env.ASBCP_SERVICE_KEY;
    process.env.ASBCP_INTERNAL_BASE_URL = 'http://asbcp.test/';
    process.env.ASBCP_SERVICE_KEY = 'service-key';

    try {
      await withMockKubectlPodSnapshot({
        items: [
          {
            metadata: {
              name: 'workload-task-release-identity',
              labels: {
                app: 'managed-workload',
                workspace_id: 'ws-default-9f642c763af7',
                project_id: 'proj-raw-e04b05f9bca4',
                workload_id: 'task-release-identity-15772034fcfa',
              },
              annotations: {
                'mbos.io/workspace-id': 'ws_default',
                'mbos.io/project-id': 'proj_raw',
                'mbos.io/workload-id': 'task-release-identity',
                expires_at: '2026-05-12T12:00:00Z',
              },
            },
          },
        ],
      }, async ({ argLogPath }) => {
        await expect(releaseExpiredWorkloadsViaAsbcp({
          namespace: 'agentsmith-sandbox',
          workspaceId: 'ws_default',
          projectId: 'proj_raw',
          workloadId: 'task-release-identity',
          now: new Date('2026-05-12T12:05:00Z'),
        })).resolves.toMatchObject({
          released: 1,
          targets: [
            expect.objectContaining({
              podName: 'workload-task-release-identity',
              workspaceId: 'ws_default',
              projectId: 'proj_raw',
              workloadId: 'task-release-identity',
            }),
          ],
        });

        expect(fetchMock).toHaveBeenCalledWith(
          'http://asbcp.test/v1/workspaces/ws_default/projects/proj_raw/workloads/task-release-identity',
          expect.objectContaining({ method: 'DELETE' }),
        );
        const requestedUrl = String(fetchMock.mock.calls[0]?.[0] ?? '');
        expect(requestedUrl).not.toContain('ws-default-9f642c763af7');
        expect(requestedUrl).not.toContain('proj-raw-e04b05f9bca4');
        expect(requestedUrl).not.toContain('task-release-identity-15772034fcfa');
        expect(await readFile(argLogPath, 'utf8')).toContain(
          'get pods -n agentsmith-sandbox -l app=managed-workload -o json',
        );
      });
    } finally {
      if (previousBaseUrl === undefined) delete process.env.ASBCP_INTERNAL_BASE_URL;
      else process.env.ASBCP_INTERNAL_BASE_URL = previousBaseUrl;
      if (previousServiceKey === undefined) delete process.env.ASBCP_SERVICE_KEY;
      else process.env.ASBCP_SERVICE_KEY = previousServiceKey;
    }
  });

  it('does not count ASBCP 404 as expired workload release success while the pod still exists', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 404 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const previousBaseUrl = process.env.ASBCP_INTERNAL_BASE_URL;
    const previousServiceKey = process.env.ASBCP_SERVICE_KEY;
    process.env.ASBCP_INTERNAL_BASE_URL = 'http://asbcp.test';
    process.env.ASBCP_SERVICE_KEY = 'service-key';

    try {
      await withMockKubectlPodSnapshot({
        items: [
          {
            metadata: {
              name: 'workload-task-release-404',
              labels: {
                app: 'managed-workload',
                workspace_id: 'ws-default-9f642c763af7',
                project_id: 'proj-raw-e04b05f9bca4',
                workload_id: 'task-release-404-15772034fcfa',
              },
              annotations: {
                'mbos.io/workspace-id': 'ws_default',
                'mbos.io/project-id': 'proj_raw',
                'mbos.io/workload-id': 'task-release-404',
                expires_at: '2026-05-12T12:00:00Z',
              },
            },
          },
        ],
      }, async () => {
        await expect(releaseExpiredWorkloadsViaAsbcp({
          namespace: 'agentsmith-sandbox',
          workspaceId: 'ws_default',
          projectId: 'proj_raw',
          workloadId: 'task-release-404',
          now: new Date('2026-05-12T12:05:00Z'),
        })).resolves.toMatchObject({
          released: 0,
          targets: [
            expect.objectContaining({
              podName: 'workload-task-release-404',
              workspaceId: 'ws_default',
              projectId: 'proj_raw',
              workloadId: 'task-release-404',
            }),
          ],
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
      });
    } finally {
      if (previousBaseUrl === undefined) delete process.env.ASBCP_INTERNAL_BASE_URL;
      else process.env.ASBCP_INTERNAL_BASE_URL = previousBaseUrl;
      if (previousServiceKey === undefined) delete process.env.ASBCP_SERVICE_KEY;
      else process.env.ASBCP_SERVICE_KEY = previousServiceKey;
    }
  });

  it('does not count ASBCP 404 as expired workload release success when the pod is already absent', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 404 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const previousBaseUrl = process.env.ASBCP_INTERNAL_BASE_URL;
    const previousServiceKey = process.env.ASBCP_SERVICE_KEY;
    process.env.ASBCP_INTERNAL_BASE_URL = 'http://asbcp.test';
    process.env.ASBCP_SERVICE_KEY = 'service-key';

    try {
      await withMockKubectlPodSnapshot([
        {
          items: [
            {
              metadata: {
                name: 'workload-task-release-404-absent',
                labels: {
                  app: 'managed-workload',
                  workspace_id: 'ws-default-9f642c763af7',
                  project_id: 'proj-raw-e04b05f9bca4',
                  workload_id: 'task-release-404-absent-15772034fcfa',
                },
                annotations: {
                  'mbos.io/workspace-id': 'ws_default',
                  'mbos.io/project-id': 'proj_raw',
                  'mbos.io/workload-id': 'task-release-404-absent',
                  expires_at: '2026-05-12T12:00:00Z',
                },
              },
            },
          ],
        },
        { items: [] },
      ], async ({ argLogPath }) => {
        await expect(releaseExpiredWorkloadsViaAsbcp({
          namespace: 'agentsmith-sandbox',
          workspaceId: 'ws_default',
          projectId: 'proj_raw',
          workloadId: 'task-release-404-absent',
          now: new Date('2026-05-12T12:05:00Z'),
        })).resolves.toMatchObject({
          released: 0,
          targets: [
            expect.objectContaining({
              podName: 'workload-task-release-404-absent',
              workspaceId: 'ws_default',
              projectId: 'proj_raw',
              workloadId: 'task-release-404-absent',
            }),
          ],
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(await readFile(argLogPath, 'utf8')).toContain(
          'get pods -n agentsmith-sandbox -l app=managed-workload -o json',
        );
      });
    } finally {
      if (previousBaseUrl === undefined) delete process.env.ASBCP_INTERNAL_BASE_URL;
      else process.env.ASBCP_INTERNAL_BASE_URL = previousBaseUrl;
      if (previousServiceKey === undefined) delete process.env.ASBCP_SERVICE_KEY;
      else process.env.ASBCP_SERVICE_KEY = previousServiceKey;
    }
  });

  it('does not let expired workload wait signoff use pod absence after ASBCP 404', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 404 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const previousBaseUrl = process.env.ASBCP_INTERNAL_BASE_URL;
    const previousServiceKey = process.env.ASBCP_SERVICE_KEY;
    process.env.ASBCP_INTERNAL_BASE_URL = 'http://asbcp.test';
    process.env.ASBCP_SERVICE_KEY = 'service-key';

    try {
      await withMockKubectlPodSnapshot([
        {
          items: [
            {
              metadata: {
                name: 'workload-task-wait-404-absent',
                labels: {
                  app: 'managed-workload',
                  workspace_id: 'ws-default-9f642c763af7',
                  project_id: 'proj-raw-e04b05f9bca4',
                  workload_id: 'task-wait-404-absent-15772034fcfa',
                },
                annotations: {
                  'mbos.io/workspace-id': 'ws_default',
                  'mbos.io/project-id': 'proj_raw',
                  'mbos.io/workload-id': 'task-wait-404-absent',
                  expires_at: '2026-05-12T12:00:00Z',
                },
              },
            },
          ],
        },
        { items: [] },
      ], async () => {
        await expect(waitForExpiredWorkloadReleasedViaAsbcp({
          namespace: 'agentsmith-sandbox',
          workspaceId: 'ws_default',
          projectId: 'proj_raw',
          workloadId: 'task-wait-404-absent',
          timeoutMs: 500,
        })).rejects.toThrow();
      });
    } finally {
      if (previousBaseUrl === undefined) delete process.env.ASBCP_INTERNAL_BASE_URL;
      else process.env.ASBCP_INTERNAL_BASE_URL = previousBaseUrl;
      if (previousServiceKey === undefined) delete process.env.ASBCP_SERVICE_KEY;
      else process.env.ASBCP_SERVICE_KEY = previousServiceKey;
    }
  });

  it('scopes Agent Task execution outcome polling to the current runner output activity boundary', async () => {
    const source = await readFile(path.resolve('e2e/integration-real-helpers.ts'), 'utf8');

    expect(source).toContain('runnerOutputActivityId');
    expect(source).toContain('message_id=');
  });

  it('keeps internal runner runtime state under the task HOME path fields', async () => {
    const source = await readFile(path.resolve('e2e/integration-real-helpers.ts'), 'utf8');
    const legacyCodexStateRootEnv = ['MBOS_AGENT_CODEX', 'STATE_ROOT'].join('_');
    const legacyRuntimeBuilder = ['buildRunner', 'RuntimeRootPathPart'].join('');
    const legacyRuntimePathPart = ['runtime', 'root', 'path', 'part'].join('_');

    expect(source).not.toContain(legacyCodexStateRootEnv);
    expect(source).not.toContain(legacyRuntimeBuilder);
    expect(source).not.toContain(legacyRuntimePathPart);
    expect(source).toContain('task_home="$1"');
    expect(source).toContain('config="$task_home/.codex/config.toml"');
    expect(source).toContain('"MBOS_AGENT_WORKSPACE_ROOT=/home"');
  });

  it('prefers KEYCLOAK_BASE_URL over every other integration keycloak env source', () => {
    expect(resolveIntegrationKeycloakBaseUrl({
      KEYCLOAK_BASE_URL: 'http://auth.example.test:39090/',
      RUNTIME_HOST_KEYCLOAK_BASE_URL: 'http://runtime-host.example.test:39091',
      RUNTIME_BROWSER_KEYCLOAK_BASE_URL: 'http://runtime-browser.example.test:39092',
      PUBLIC_KEYCLOAK_BASE_URL: 'http://public.example.test:39093',
      INTERNAL_KEYCLOAK_BASE_URL: 'http://internal.example.test:39094',
      KEYCLOAK_PORT: '39095',
      INTEGRATION_KEYCLOAK_PORT: '39096',
    })).toBe('http://auth.example.test:39090');
  });

  it('prefers RUNTIME_HOST_KEYCLOAK_BASE_URL before browser and public/internal fallbacks', () => {
    expect(resolveIntegrationKeycloakBaseUrl({
      RUNTIME_HOST_KEYCLOAK_BASE_URL: 'http://runtime-host.example.test:39091/',
      RUNTIME_BROWSER_KEYCLOAK_BASE_URL: 'http://runtime-browser.example.test:39092',
      PUBLIC_KEYCLOAK_BASE_URL: 'http://public.example.test:39093',
      INTERNAL_KEYCLOAK_BASE_URL: 'http://internal.example.test:39094',
      KEYCLOAK_PORT: '39095',
    })).toBe('http://runtime-host.example.test:39091');
  });

  it('prefers RUNTIME_BROWSER_KEYCLOAK_BASE_URL before public/internal fallbacks', () => {
    expect(resolveIntegrationKeycloakBaseUrl({
      RUNTIME_BROWSER_KEYCLOAK_BASE_URL: 'http://runtime-browser.example.test:39092/',
      PUBLIC_KEYCLOAK_BASE_URL: 'http://public.example.test:39093',
      INTERNAL_KEYCLOAK_BASE_URL: 'http://internal.example.test:39094',
      KEYCLOAK_PORT: '39095',
    })).toBe('http://runtime-browser.example.test:39092');
  });

  it('uses browser runtime truth for browser-facing flows when host and browser urls diverge', () => {
    expect(resolveIntegrationKeycloakBaseUrl({
      RUNTIME_HOST_KEYCLOAK_BASE_URL: 'http://runtime-host.example.test:39091',
      RUNTIME_BROWSER_KEYCLOAK_BASE_URL: 'http://runtime-browser.example.test:39092/',
      PUBLIC_KEYCLOAK_BASE_URL: 'http://public.example.test:39093',
      INTERNAL_KEYCLOAK_BASE_URL: 'http://internal.example.test:39094',
    }, { target: 'browser' })).toBe('http://runtime-browser.example.test:39092');
  });

  it('prefers PUBLIC_KEYCLOAK_BASE_URL before INTERNAL_KEYCLOAK_BASE_URL', () => {
    expect(resolveIntegrationKeycloakBaseUrl({
      PUBLIC_KEYCLOAK_BASE_URL: 'http://public.example.test:39093/',
      INTERNAL_KEYCLOAK_BASE_URL: 'http://internal.example.test:39094',
      KEYCLOAK_PORT: '39095',
    })).toBe('http://public.example.test:39093');
  });

  it('falls back to INTERNAL_KEYCLOAK_BASE_URL before constructing loopback from a port', () => {
    expect(resolveIntegrationKeycloakBaseUrl({
      INTERNAL_KEYCLOAK_BASE_URL: 'http://internal.example.test:39094/',
      KEYCLOAK_PORT: '39095',
      INTEGRATION_KEYCLOAK_PORT: '39096',
    })).toBe('http://internal.example.test:39094');
  });

  it('constructs a loopback base url from KEYCLOAK_PORT when no base url env is declared', () => {
    expect(resolveIntegrationKeycloakBaseUrl({
      KEYCLOAK_PORT: '39095',
      INTEGRATION_KEYCLOAK_PORT: '39096',
    })).toBe('http://127.0.0.1:39095');
  });

  it('falls back to INTEGRATION_KEYCLOAK_PORT when KEYCLOAK_PORT is absent', () => {
    expect(resolveIntegrationKeycloakBaseUrl({
      INTEGRATION_KEYCLOAK_PORT: '39096',
    })).toBe('http://127.0.0.1:39096');
  });

  it('fails fast when the integration runtime does not declare any keycloak base url truth', () => {
    expect(() => resolveIntegrationKeycloakBaseUrl({})).toThrow('integration_keycloak_base_url_missing');
  });

  it('binds Agent Task execution sockets to the task runner session while preserving other query params', () => {
    expect(
      bindAgentTaskExecutionSocketToTask({
        wsUrl: 'ws://localhost:20000/api/v1/agent-execution/ws?agent_runner_id=runner_1&foo=bar',
        taskId: 'task_123',
      }),
    ).toBe('ws://localhost:20000/api/v1/agent-execution/ws?agent_runner_id=runner_1&foo=bar&runner_session_id=task_123');
  });

  it('rejects legacy session_id in Agent Task runner socket URLs', () => {
    expect(() =>
      bindAgentTaskExecutionSocketToTask({
        wsUrl: 'wss://runner.example.com/api/v1/agent-execution/ws?agent_runner_id=runner_1&session_id=task_old&runner_session_id=task_older',
        taskId: 'task_new',
      }),
    ).toThrow('legacy_session_id_not_supported_for_agent_task_runner_socket');
  });

  it('keeps Agent Runner presence sockets runner-scoped before task creation', () => {
    expect(
      resolveAgentTaskRunnerSocketUrl({
        wsUrl: 'ws://localhost:20000/api/v1/agent-execution/ws?agent_runner_id=runner_1',
        scope: 'runner_presence',
      }),
    ).toBe('ws://localhost:20000/api/v1/agent-execution/ws?agent_runner_id=runner_1');
  });

  it('requires a task id when resolving a task-bound Agent task runner socket', () => {
    expect(() =>
      resolveAgentTaskRunnerSocketUrl({
        wsUrl: 'ws://localhost:20000/api/v1/agent-execution/ws?agent_runner_id=runner_1',
        scope: 'task_execution',
      }),
    ).toThrow('task_id_required_for_task_bound_agent_task_runner');
  });

  it('returns pod-reachable mock external HTTP service URLs derived from the Agent execution websocket host', async () => {
    const previousWsBaseUrl = process.env.AGENT_EXECUTION_WS_BASE_URL;
    const previousGateway = process.env.INTEGRATION_POD_HOST_GATEWAY;
    process.env.AGENT_EXECUTION_WS_BASE_URL = 'ws://172.19.0.1:20075';
    delete process.env.INTEGRATION_POD_HOST_GATEWAY;
    const server = await startMockExternalHttpService({
      expectedToken: 'external-service-token',
    });
    try {
      expect(server.baseUrl).toMatch(/^http:\/\/172\.19\.0\.1:\d+$/);
    } finally {
      await server.stop();
      if (previousWsBaseUrl === undefined) {
        delete process.env.AGENT_EXECUTION_WS_BASE_URL;
      } else {
        process.env.AGENT_EXECUTION_WS_BASE_URL = previousWsBaseUrl;
      }
      if (previousGateway === undefined) {
        delete process.env.INTEGRATION_POD_HOST_GATEWAY;
      } else {
        process.env.INTEGRATION_POD_HOST_GATEWAY = previousGateway;
      }
    }
  });

  it('uses the explicit pod host gateway override for mock external MCP endpoints', async () => {
    const previousWsBaseUrl = process.env.AGENT_EXECUTION_WS_BASE_URL;
    const previousGateway = process.env.INTEGRATION_POD_HOST_GATEWAY;
    process.env.AGENT_EXECUTION_WS_BASE_URL = 'ws://127.0.0.1:20076';
    process.env.INTEGRATION_POD_HOST_GATEWAY = '10.88.0.1';
    const server = await startMockExternalMcpService({
      expectedToken: 'external-mcp-token',
      toolName: 'mock_tool',
    });
    try {
      expect(server.endpoint).toMatch(/^http:\/\/10\.88\.0\.1:\d+\/mcp$/);
    } finally {
      await server.stop();
      if (previousWsBaseUrl === undefined) {
        delete process.env.AGENT_EXECUTION_WS_BASE_URL;
      } else {
        process.env.AGENT_EXECUTION_WS_BASE_URL = previousWsBaseUrl;
      }
      if (previousGateway === undefined) {
        delete process.env.INTEGRATION_POD_HOST_GATEWAY;
      } else {
        process.env.INTEGRATION_POD_HOST_GATEWAY = previousGateway;
      }
    }
  });

  it('creates a managed Agent Runner without legacy runner selectors or chat session side effects', async () => {
    const previousMongoUrl = process.env.MONGO_URL;
    const previousMongoDbName = process.env.MONGO_DB_NAME;
    process.env.MONGO_URL = 'mongodb://mbos:mbos_dev_password@localhost:17017/admin';
    process.env.MONGO_DB_NAME = 'mbos';
    upsertManagedRunner.mockResolvedValue({
      runnerId: 'ag_runner_1',
      runnerName: 'agent-task-runner',
      status: 'ready',
      isDefault: true,
      defaultEndpointId: 'ep_task',
      capabilities: {},
      diagnostics: { presence: 'managed' },
      wsUrl: 'ws://127.0.0.1:20000/agent-runner/ws',
    });
    const get = vi.fn().mockResolvedValue(okResponse({
      readiness: { state: 'not_configured' },
    }));
    const patch = vi.fn().mockResolvedValue(okResponse({
      setting: {
        endpoint_id: 'ep_task',
        default_model: 'seed-model',
        setting_revision: 'set_seed_1',
      },
    }));
    const page = {
      evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
      request: {
        get,
        patch,
      },
    } as unknown as Parameters<typeof createManagedAgentRunnerViaApi>[0];

    try {
      const runner = await createManagedAgentRunnerViaApi(page, {
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        endpointId: 'ep_task',
        title: 'agent-task-runner',
      });

      expect(runner).toMatchObject({
        runnerId: 'ag_runner_1',
        runnerName: 'agent-task-runner',
        status: 'ready',
        isDefault: true,
        defaultEndpointId: 'ep_task',
      });
      expect(upsertManagedRunner).toHaveBeenCalledTimes(1);
      expect(upsertManagedRunner).toHaveBeenCalledWith(expect.objectContaining({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        endpointId: 'ep_task',
        runnerName: 'agent-task-runner',
        isDefault: true,
      }));
      expect(patch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/workspaces/ws_default/projects/proj_1/agent-task-model-setting'),
        expect.objectContaining({
          data: {
            endpoint_id: 'ep_task',
            expected_setting_revision: null,
          },
        }),
      );
    } finally {
      if (previousMongoUrl === undefined) {
        delete process.env.MONGO_URL;
      } else {
        process.env.MONGO_URL = previousMongoUrl;
      }
      if (previousMongoDbName === undefined) {
        delete process.env.MONGO_DB_NAME;
      } else {
        process.env.MONGO_DB_NAME = previousMongoDbName;
      }
    }
  });

  it('forwards internal Agent Task runner sandbox lifecycle overrides to the managed runner seed', async () => {
    const previousMongoUrl = process.env.MONGO_URL;
    const previousMongoDbName = process.env.MONGO_DB_NAME;
    process.env.MONGO_URL = 'mongodb://mbos:mbos_dev_password@localhost:17017/admin';
    process.env.MONGO_DB_NAME = 'mbos';
    upsertManagedRunner.mockResolvedValue({
      runnerId: 'ag_runner_internal',
      runnerName: 'internal-sandbox-reclaim',
      status: 'ready',
      isDefault: true,
      defaultEndpointId: 'ep_task',
      capabilities: {},
      diagnostics: { presence: 'managed' },
      wsUrl: 'ws://127.0.0.1:20000/agent-runner/ws',
    });
    const get = vi.fn().mockResolvedValue(okResponse({
      readiness: { state: 'not_configured' },
    }));
    const patch = vi.fn().mockResolvedValue(okResponse({
      setting: {
        endpoint_id: 'ep_task',
        default_model: 'seed-model',
        setting_revision: 'set_seed_1',
      },
    }));
    const page = {
      evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
      request: {
        get,
        patch,
      },
    } as unknown as Parameters<typeof createInternalAgentTaskRunnerViaApi>[0];

    try {
      await createInternalAgentTaskRunnerViaApi(page, {
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        endpointId: 'ep_task',
        title: 'internal-sandbox-reclaim',
        image: 'internal-runner:test',
        idleTimeoutSec: 180,
        maxLifetimeSec: 3600,
      });

      expect(upsertManagedRunner).toHaveBeenCalledWith(expect.objectContaining({
        image: 'internal-runner:test',
        idleTimeoutSec: 180,
        maxLifetimeSec: 3600,
      }));
    } finally {
      if (previousMongoUrl === undefined) {
        delete process.env.MONGO_URL;
      } else {
        process.env.MONGO_URL = previousMongoUrl;
      }
      if (previousMongoDbName === undefined) {
        delete process.env.MONGO_DB_NAME;
      } else {
        process.env.MONGO_DB_NAME = previousMongoDbName;
      }
    }
  });

  it('bypasses reusable managed runner state when internal sandbox lifecycle overrides must be applied', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'internal-runner-lifecycle-state-'));
    const summaryFile = path.join(tempRoot, 'summary.env');
    const previousSummaryFile = process.env.BACKEND_REAL_SUMMARY_FILE;
    const previousRunnerId = process.env.AGENT_RUNNER_ID;
    const previousMongoUrl = process.env.MONGO_URL;
    const previousMongoDbName = process.env.MONGO_DB_NAME;
    await writeFile(summaryFile, [
      'AGENT_RUNNER_ID=ag_reusable_but_wrong_lifecycle',
      'AGENT_RUNNER_PROVIDER=managed',
      '',
    ].join('\n'));
    process.env.BACKEND_REAL_SUMMARY_FILE = summaryFile;
    process.env.MONGO_URL = 'mongodb://mbos:mbos_dev_password@localhost:17017/admin';
    process.env.MONGO_DB_NAME = 'mbos';
    delete process.env.AGENT_RUNNER_ID;
    upsertManagedRunner.mockResolvedValue({
      runnerId: 'ag_runner_internal_reseeded',
      runnerName: 'internal-sandbox-reclaim',
      status: 'ready',
      isDefault: true,
      defaultEndpointId: 'ep_task',
      capabilities: {},
      diagnostics: { presence: 'managed' },
      wsUrl: 'ws://127.0.0.1:20000/agent-runner/ws',
    });
    const get = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/agent-runners/ag_reusable_but_wrong_lifecycle')) {
        throw new Error(`lifecycle_override_should_not_reuse_summary_runner:${url}`);
      }
      if (url.endsWith('/agent-task-model-setting')) {
        return okResponse({ readiness: { state: 'not_configured' } });
      }
      throw new Error(`unexpected_get:${url}`);
    });
    const patch = vi.fn().mockResolvedValue(okResponse({
      setting: {
        endpoint_id: 'ep_task',
        default_model: 'seed-model',
        setting_revision: 'set_seed_1',
      },
    }));
    const page = {
      evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
      request: { get, patch },
    } as unknown as Parameters<typeof createInternalAgentTaskRunnerViaApi>[0];

    try {
      await createInternalAgentTaskRunnerViaApi(page, {
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        endpointId: 'ep_task',
        title: 'internal-sandbox-reclaim',
        idleTimeoutSec: 180,
        maxLifetimeSec: 3600,
      });

      expect(upsertManagedRunner).toHaveBeenCalledWith(expect.objectContaining({
        idleTimeoutSec: 180,
        maxLifetimeSec: 3600,
      }));
      expect(get).not.toHaveBeenCalledWith(
        expect.stringContaining('/agent-runners/ag_reusable_but_wrong_lifecycle'),
        expect.any(Object),
      );
    } finally {
      if (previousSummaryFile === undefined) {
        delete process.env.BACKEND_REAL_SUMMARY_FILE;
      } else {
        process.env.BACKEND_REAL_SUMMARY_FILE = previousSummaryFile;
      }
      if (previousRunnerId === undefined) {
        delete process.env.AGENT_RUNNER_ID;
      } else {
        process.env.AGENT_RUNNER_ID = previousRunnerId;
      }
      if (previousMongoUrl === undefined) {
        delete process.env.MONGO_URL;
      } else {
        process.env.MONGO_URL = previousMongoUrl;
      }
      if (previousMongoDbName === undefined) {
        delete process.env.MONGO_DB_NAME;
      } else {
        process.env.MONGO_DB_NAME = previousMongoDbName;
      }
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('reuses managed runner summary/state source before falling back to seed upsert', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'managed-runner-helper-state-'));
    const stateFile = path.join(tempRoot, 'state.json');
    const summaryFile = path.join(tempRoot, 'summary.env');
    const previousStateFile = process.env.BACKEND_REAL_STATE_FILE;
    const previousSummaryFile = process.env.BACKEND_REAL_SUMMARY_FILE;
    const previousRunnerId = process.env.AGENT_RUNNER_ID;
    const previousMongoUrl = process.env.MONGO_URL;

    await writeFile(summaryFile, [
      'AGENT_RUNNER_ID=ag_summary_managed',
      'WS_URL=ws://127.0.0.1:20000/api/v1/agent-execution/ws?agent_runner_id=ag_summary_managed',
      '',
    ].join('\n'));
    await writeFile(stateFile, JSON.stringify({
      agent_runner: {
        id: 'ag_state_managed',
        ws_url: 'ws://127.0.0.1:20000/api/v1/agent-execution/ws?agent_runner_id=ag_state_managed',
      },
    }, null, 2));
    process.env.BACKEND_REAL_STATE_FILE = stateFile;
    process.env.BACKEND_REAL_SUMMARY_FILE = summaryFile;
    delete process.env.AGENT_RUNNER_ID;
    delete process.env.MONGO_URL;

    const get = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/agent-runners/ag_summary_managed')) {
        return okResponse({
          id: 'ag_summary_managed',
          project_id: 'proj_1',
          name: 'Summary managed runner',
          kind: 'system_managed',
          runner_provider: 'managed',
          runner_status: 'ready',
          status: 'enabled',
          is_default: true,
          default_endpoint_id: 'ep_summary',
          capabilities: { terminal: true },
          diagnostics: { source: 'summary' },
        });
      }
      if (url.endsWith('/agent-task-model-setting')) {
        return okResponse({
          readiness: { state: 'not_configured' },
        });
      }
      throw new Error(`unexpected_get:${url}`);
    });
    const patch = vi.fn().mockResolvedValue(okResponse({
      setting: {
        endpoint_id: 'ep_fallback',
        default_model: 'seed-model',
        setting_revision: 'set_summary_1',
      },
    }));
    const page = {
      evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
      request: { get, patch },
    } as unknown as Parameters<typeof createManagedAgentRunnerViaApi>[0];

    try {
      await expect(createManagedAgentRunnerViaApi(page, {
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        endpointId: 'ep_fallback',
        title: 'Requested managed runner',
      })).resolves.toMatchObject({
        runnerId: 'ag_summary_managed',
        runnerName: 'Summary managed runner',
        status: 'ready',
        isDefault: true,
        defaultEndpointId: 'ep_summary',
        capabilities: { terminal: true },
        diagnostics: { source: 'summary' },
      });

      expect(get).toHaveBeenCalledWith(
        expect.stringContaining('/agent-runners/ag_summary_managed'),
        expect.any(Object),
      );
      expect(patch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/workspaces/ws_default/projects/proj_1/agent-task-model-setting'),
        expect.objectContaining({
          data: {
            endpoint_id: 'ep_fallback',
            expected_setting_revision: null,
          },
        }),
      );
      expect(upsertManagedRunner).not.toHaveBeenCalled();
    } finally {
      if (previousStateFile === undefined) {
        delete process.env.BACKEND_REAL_STATE_FILE;
      } else {
        process.env.BACKEND_REAL_STATE_FILE = previousStateFile;
      }
      if (previousSummaryFile === undefined) {
        delete process.env.BACKEND_REAL_SUMMARY_FILE;
      } else {
        process.env.BACKEND_REAL_SUMMARY_FILE = previousSummaryFile;
      }
      if (previousRunnerId === undefined) {
        delete process.env.AGENT_RUNNER_ID;
      } else {
        process.env.AGENT_RUNNER_ID = previousRunnerId;
      }
      if (previousMongoUrl === undefined) {
        delete process.env.MONGO_URL;
      } else {
        process.env.MONGO_URL = previousMongoUrl;
      }
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('does not reuse developer runner state as the managed Agent Runner seed', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'developer-runner-helper-state-'));
    const stateFile = path.join(tempRoot, 'state.json');
    const summaryFile = path.join(tempRoot, 'summary.env');
    const ambientCurrentRoot = path.join(tempRoot, 'artifacts', 'backend-real', 'current');
    const previousStateFile = process.env.BACKEND_REAL_STATE_FILE;
    const previousSummaryFile = process.env.BACKEND_REAL_SUMMARY_FILE;
    const previousRunnerId = process.env.AGENT_RUNNER_ID;
    const previousRunnerProvider = process.env.AGENT_RUNNER_PROVIDER;
    const previousMongoUrl = process.env.MONGO_URL;
    const previousMongoDbName = process.env.MONGO_DB_NAME;
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempRoot);

    await writeFile(summaryFile, [
      'AGENT_RUNNER_ID=ag_developer_summary',
      'AGENT_RUNNER_PROVIDER=developer',
      'WS_URL=ws://127.0.0.1:20000/api/v1/agent-execution/ws?agent_runner_id=ag_developer_summary',
      '',
    ].join('\n'));
    await writeFile(stateFile, JSON.stringify({
      agent_runner: {
        id: 'ag_developer_state',
        runner_provider: 'developer',
        managed: false,
        ws_url: 'ws://127.0.0.1:20000/api/v1/agent-execution/ws?agent_runner_id=ag_developer_state',
      },
    }, null, 2));
    await mkdir(ambientCurrentRoot, { recursive: true });
    await writeFile(path.join(ambientCurrentRoot, 'summary.env'), [
      'AGENT_RUNNER_ID=ag_ambient_managed_should_not_be_used',
      'AGENT_RUNNER_PROVIDER=managed',
      '',
    ].join('\n'));
    await writeFile(path.join(ambientCurrentRoot, 'state.json'), JSON.stringify({
      agent_runner: {
        id: 'ag_ambient_state_should_not_be_used',
        runner_provider: 'managed',
      },
    }, null, 2));
    process.env.BACKEND_REAL_STATE_FILE = stateFile;
    process.env.BACKEND_REAL_SUMMARY_FILE = summaryFile;
    process.env.MONGO_URL = 'mongodb://mbos:mbos_dev_password@localhost:17017/admin';
    process.env.MONGO_DB_NAME = 'mbos';
    delete process.env.AGENT_RUNNER_ID;
    delete process.env.AGENT_RUNNER_PROVIDER;

    upsertManagedRunner.mockResolvedValue({
      runnerId: 'ag_managed_created',
      runnerName: 'Requested managed runner',
      status: 'ready',
      isDefault: true,
      defaultEndpointId: 'ep_fallback',
      capabilities: { terminal: true },
      diagnostics: { source: 'managed-upsert' },
      wsUrl: 'ws://127.0.0.1:20000/api/v1/agent-execution/ws?agent_runner_id=ag_managed_created',
    });

    const get = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/agent-runners/ag_developer_summary') || url.endsWith('/agent-runners/ag_developer_state')) {
        throw new Error(`developer_runner_state_should_not_be_read_as_managed:${url}`);
      }
      if (
        url.endsWith('/agent-runners/ag_ambient_managed_should_not_be_used')
        || url.endsWith('/agent-runners/ag_ambient_state_should_not_be_used')
      ) {
        throw new Error(`ambient_current_should_not_be_read_when_explicit_state_is_set:${url}`);
      }
      if (url.endsWith('/agent-task-model-setting')) {
        return okResponse({
          readiness: { state: 'not_configured' },
        });
      }
      throw new Error(`unexpected_get:${url}`);
    });
    const patch = vi.fn().mockResolvedValue(okResponse({
      setting: {
        endpoint_id: 'ep_fallback',
        default_model: 'seed-model',
        setting_revision: 'set_provider_aware_1',
      },
    }));
    const page = {
      evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
      request: { get, patch },
    } as unknown as Parameters<typeof createManagedAgentRunnerViaApi>[0];

    try {
      await expect(createManagedAgentRunnerViaApi(page, {
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        endpointId: 'ep_fallback',
        title: 'Requested managed runner',
      })).resolves.toMatchObject({
        runnerId: 'ag_managed_created',
        runnerName: 'Requested managed runner',
        status: 'ready',
        isDefault: true,
        defaultEndpointId: 'ep_fallback',
      });

      expect(upsertManagedRunner).toHaveBeenCalledTimes(1);
      expect(get).not.toHaveBeenCalledWith(
        expect.stringContaining('/agent-runners/ag_developer_summary'),
        expect.any(Object),
      );
      expect(get).not.toHaveBeenCalledWith(
        expect.stringContaining('/agent-runners/ag_developer_state'),
        expect.any(Object),
      );
    } finally {
      if (previousStateFile === undefined) {
        delete process.env.BACKEND_REAL_STATE_FILE;
      } else {
        process.env.BACKEND_REAL_STATE_FILE = previousStateFile;
      }
      if (previousSummaryFile === undefined) {
        delete process.env.BACKEND_REAL_SUMMARY_FILE;
      } else {
        process.env.BACKEND_REAL_SUMMARY_FILE = previousSummaryFile;
      }
      if (previousRunnerId === undefined) {
        delete process.env.AGENT_RUNNER_ID;
      } else {
        process.env.AGENT_RUNNER_ID = previousRunnerId;
      }
      if (previousRunnerProvider === undefined) {
        delete process.env.AGENT_RUNNER_PROVIDER;
      } else {
        process.env.AGENT_RUNNER_PROVIDER = previousRunnerProvider;
      }
      if (previousMongoUrl === undefined) {
        delete process.env.MONGO_URL;
      } else {
        process.env.MONGO_URL = previousMongoUrl;
      }
      if (previousMongoDbName === undefined) {
        delete process.env.MONGO_DB_NAME;
      } else {
        process.env.MONGO_DB_NAME = previousMongoDbName;
      }
      cwdSpy.mockRestore();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('falls back to managed upsert when a legacy seeded runner id resolves to a Developer runner payload', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'legacy-developer-runner-helper-state-'));
    const summaryFile = path.join(tempRoot, 'summary.env');
    const previousSummaryFile = process.env.BACKEND_REAL_SUMMARY_FILE;
    const previousRunnerId = process.env.AGENT_RUNNER_ID;
    const previousRunnerProvider = process.env.AGENT_RUNNER_PROVIDER;
    const previousMongoUrl = process.env.MONGO_URL;
    const previousMongoDbName = process.env.MONGO_DB_NAME;

    await writeFile(summaryFile, [
      'AGENT_RUNNER_ID=ag_legacy_developer',
      'WS_URL=ws://127.0.0.1:20000/api/v1/agent-execution/ws?agent_runner_id=ag_legacy_developer',
      '',
    ].join('\n'));
    process.env.BACKEND_REAL_SUMMARY_FILE = summaryFile;
    process.env.MONGO_URL = 'mongodb://mbos:mbos_dev_password@localhost:17017/admin';
    process.env.MONGO_DB_NAME = 'mbos';
    delete process.env.AGENT_RUNNER_ID;
    delete process.env.AGENT_RUNNER_PROVIDER;

    upsertManagedRunner.mockResolvedValue({
      runnerId: 'ag_managed_from_legacy_payload',
      runnerName: 'Payload-aware managed runner',
      status: 'ready',
      isDefault: true,
      defaultEndpointId: 'ep_fallback',
      capabilities: { terminal: true },
      diagnostics: { source: 'payload-aware-upsert' },
      wsUrl: 'ws://127.0.0.1:20000/api/v1/agent-execution/ws?agent_runner_id=ag_managed_from_legacy_payload',
    });

    const get = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/agent-runners/ag_legacy_developer')) {
        return okResponse({
          id: 'ag_legacy_developer',
          project_id: 'proj_1',
          name: 'Legacy Developer runner',
          kind: 'developer',
          runner_provider: 'developer',
          managed: false,
          runner_status: 'ready',
          status: 'enabled',
          is_default: true,
          default_endpoint_id: 'ep_developer',
          capabilities: { terminal: true },
          diagnostics: { source: 'developer' },
        });
      }
      if (url.endsWith('/agent-task-model-setting')) {
        return okResponse({
          readiness: { state: 'not_configured' },
        });
      }
      throw new Error(`unexpected_get:${url}`);
    });
    const patch = vi.fn().mockResolvedValue(okResponse({
      setting: {
        endpoint_id: 'ep_fallback',
        default_model: 'seed-model',
        setting_revision: 'set_payload_provider_aware_1',
      },
    }));
    const page = {
      evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
      request: { get, patch },
    } as unknown as Parameters<typeof createManagedAgentRunnerViaApi>[0];

    try {
      await expect(createManagedAgentRunnerViaApi(page, {
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        endpointId: 'ep_fallback',
        title: 'Payload-aware managed runner',
      })).resolves.toMatchObject({
        runnerId: 'ag_managed_from_legacy_payload',
        runnerName: 'Payload-aware managed runner',
        status: 'ready',
        isDefault: true,
        defaultEndpointId: 'ep_fallback',
      });

      expect(get).toHaveBeenCalledWith(
        expect.stringContaining('/agent-runners/ag_legacy_developer'),
        expect.any(Object),
      );
      expect(upsertManagedRunner).toHaveBeenCalledTimes(1);
    } finally {
      if (previousSummaryFile === undefined) {
        delete process.env.BACKEND_REAL_SUMMARY_FILE;
      } else {
        process.env.BACKEND_REAL_SUMMARY_FILE = previousSummaryFile;
      }
      if (previousRunnerId === undefined) {
        delete process.env.AGENT_RUNNER_ID;
      } else {
        process.env.AGENT_RUNNER_ID = previousRunnerId;
      }
      if (previousRunnerProvider === undefined) {
        delete process.env.AGENT_RUNNER_PROVIDER;
      } else {
        process.env.AGENT_RUNNER_PROVIDER = previousRunnerProvider;
      }
      if (previousMongoUrl === undefined) {
        delete process.env.MONGO_URL;
      } else {
        process.env.MONGO_URL = previousMongoUrl;
      }
      if (previousMongoDbName === undefined) {
        delete process.env.MONGO_DB_NAME;
      } else {
        process.env.MONGO_DB_NAME = previousMongoDbName;
      }
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('creates Agent Tasks without binding agent_id at task creation time', async () => {
    const post = vi.fn().mockImplementation(async (url: string, options?: { data?: Record<string, unknown> }) => {
      if (url.endsWith('/tasks')) {
        return okResponse({
          id: 'task_1',
          title: options?.data?.title,
          workspace_file_library_id: options?.data?.workspace_file_library_id,
        });
      }
      throw new Error(`unexpected_post:${url}:${JSON.stringify(options?.data ?? null)}`);
    });
    const page = {
      evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
      request: { post },
    } as unknown as Parameters<typeof createAgentTaskViaApi>[0]['page'];

    await expect(createAgentTaskViaApi({
      page,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      title: 'Agent Task without explicit runner',
      fileLibraryId: 'fl_1',
    })).resolves.toBe('task_1');

    const payload = post.mock.calls[0]?.[1]?.data as Record<string, unknown>;
    expect(payload).toMatchObject({
      title: 'Agent Task without explicit runner',
      workspace_file_library_id: 'fl_1',
    });
    expect(payload).not.toHaveProperty('agent_id');
    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/workspaces/ws_default/projects/proj_1/tasks'),
      expect.objectContaining({
        timeout: 90_000,
      }),
    );
  });

  it('fails fast by default when Agent Task creation reports pending project storage', async () => {
    const previousRetries = process.env.INTEGRATION_AGENT_TASK_CREATE_STORAGE_PENDING_RETRIES;
    const response = <T,>(status: number, body: T) => ({
      ok: () => status >= 200 && status < 300,
      status: () => status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
    const post = vi.fn().mockResolvedValue(response(409, {
      error_code: 'PROJECT_STORAGE_PENDING',
      message: 'project_storage_pending',
    }));
    const page = {
      evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
      request: { post },
    } as unknown as Parameters<typeof createAgentTaskViaApi>[0]['page'];

    try {
      delete process.env.INTEGRATION_AGENT_TASK_CREATE_STORAGE_PENDING_RETRIES;
      expect(resolveAgentTaskCreateStoragePendingRetries({})).toBe(0);
      expect(resolveAgentTaskCreateStoragePendingRetries({
        INTEGRATION_AGENT_TASK_CREATE_STORAGE_PENDING_RETRIES: '0',
      })).toBe(0);

      await expect(createAgentTaskViaApi({
        page,
        workspaceId: 'ws_default',
        projectId: 'proj_pending',
        title: 'Agent Task with pending storage',
      })).rejects.toThrow(
        'create_agent_task_failed:409:PROJECT_STORAGE_PENDING:storage_pending_retries=0:storage_pending_attempts=1',
      );
    } finally {
      if (previousRetries === undefined) {
        delete process.env.INTEGRATION_AGENT_TASK_CREATE_STORAGE_PENDING_RETRIES;
      } else {
        process.env.INTEGRATION_AGENT_TASK_CREATE_STORAGE_PENDING_RETRIES = previousRetries;
      }
    }

    expect(post).toHaveBeenCalledTimes(1);
  });

  it('retries Agent Task creation while project storage is still converging when explicitly enabled', async () => {
    const previousRetries = process.env.INTEGRATION_AGENT_TASK_CREATE_STORAGE_PENDING_RETRIES;
    const previousDelay = process.env.INTEGRATION_AGENT_TASK_CREATE_STORAGE_PENDING_RETRY_DELAY_MS;
    process.env.INTEGRATION_AGENT_TASK_CREATE_STORAGE_PENDING_RETRIES = '1';
    process.env.INTEGRATION_AGENT_TASK_CREATE_STORAGE_PENDING_RETRY_DELAY_MS = '1';
    const response = <T,>(status: number, body: T) => ({
      ok: () => status >= 200 && status < 300,
      status: () => status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
    const post = vi.fn()
      .mockResolvedValueOnce(response(409, {
        error_code: 'PROJECT_STORAGE_PENDING',
        message: 'project_storage_pending',
      }))
      .mockResolvedValueOnce(response(201, {
        id: 'task_after_storage_ready',
        title: 'Agent Task after storage wait',
      }));
    const page = {
      evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
      request: { post },
    } as unknown as Parameters<typeof createAgentTaskViaApi>[0]['page'];

    try {
      expect(resolveAgentTaskCreateStoragePendingRetries()).toBe(1);
      expect(resolveAgentTaskCreateStoragePendingRetryDelayMs()).toBe(1);
      await expect(createAgentTaskViaApi({
        page,
        workspaceId: 'ws_default',
        projectId: 'proj_pending',
        title: 'Agent Task after storage wait',
      })).resolves.toBe('task_after_storage_ready');
    } finally {
      if (previousRetries === undefined) {
        delete process.env.INTEGRATION_AGENT_TASK_CREATE_STORAGE_PENDING_RETRIES;
      } else {
        process.env.INTEGRATION_AGENT_TASK_CREATE_STORAGE_PENDING_RETRIES = previousRetries;
      }
      if (previousDelay === undefined) {
        delete process.env.INTEGRATION_AGENT_TASK_CREATE_STORAGE_PENDING_RETRY_DELAY_MS;
      } else {
        process.env.INTEGRATION_AGENT_TASK_CREATE_STORAGE_PENDING_RETRY_DELAY_MS = previousDelay;
      }
    }

    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1]?.[1]?.data).toEqual(post.mock.calls[0]?.[1]?.data);
  });

  it('keeps Agent Task create request timeout aligned above project storage bootstrap wait', async () => {
    expect(resolveAgentTaskCreateTimeoutMs({})).toBe(90_000);
    expect(resolveAgentTaskCreateTimeoutMs({
      INTEGRATION_AGENT_TASK_CREATE_TIMEOUT_MS: '120000',
    })).toBe(120_000);

    const post = vi.fn().mockRejectedValue(new Error('apiRequestContext.post: Timeout 15000ms exceeded'));
    const page = {
      evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
      request: { post },
    } as unknown as Parameters<typeof createAgentTaskViaApi>[0]['page'];

    await expect(createAgentTaskViaApi({
      page,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      title: 'Agent Task with cold project storage',
    })).rejects.toThrow('create_agent_task_request_failed:timeout_ms=90000');
    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/workspaces/ws_default/projects/proj_1/tasks'),
      expect.objectContaining({
        timeout: 90_000,
      }),
    );
  });

  it('starts Agent Task runs through the public runs API with intent and without message roles', async () => {
    const post = vi.fn().mockImplementation(async (url: string, options?: { data?: Record<string, unknown> }) => {
      if (url.endsWith('/tasks/task_1/runs')) {
        return okResponse({
          id: 'activity_runner_1',
          task_id: 'task_1',
          kind: 'runner_output',
          actor: 'runner',
          content: '',
          run_id: 'run_1',
        });
      }
      throw new Error(`unexpected_post:${url}:${JSON.stringify(options?.data ?? null)}`);
    });
    const page = {
      evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
      request: { post },
    } as unknown as Parameters<typeof startAgentTaskRunViaApi>[0]['page'];

    await expect(startAgentTaskRunViaApi({
      page,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      intent: 'run task',
    })).resolves.toEqual({
      runnerOutputActivityId: 'activity_runner_1',
      runId: 'run_1',
    });

    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_1/runs'),
      expect.objectContaining({
        data: {
          intent: 'run task',
        },
      }),
    );
    const payload = post.mock.calls[0]?.[1]?.data as Record<string, unknown>;
    expect(payload).not.toHaveProperty('role');
    expect(payload).not.toHaveProperty('content');
    expect(payload).not.toHaveProperty('agent_id');
    expect(payload).not.toHaveProperty('runner_id');
  });

  it('evaluates completed current-run runner output when the activity projection id differs from the run response id', () => {
    const outcome = evaluateAgentTaskExecutionSnapshot({
      token: 'MANAGED_T2_OK',
      runnerOutputActivityId: 'activity_from_run_response',
      runId: 'run_current',
      minRunnerOutputs: 2,
      activity: [
        { id: 'activity_user_1', kind: 'user_intent', actor: 'user', content: 'first request' },
        {
          id: 'activity_runner_1',
          kind: 'runner_output',
          actor: 'runner',
          content: 'first answer MANAGED_T1_OK',
          run_id: 'run_previous',
        },
        { id: 'activity_user_2', kind: 'user_intent', actor: 'user', content: 'second request' },
        {
          id: 'activity_projected_current',
          kind: 'runner_output',
          actor: 'runner',
          content: 'final answer MANAGED_T2_OK',
          run_id: 'run_current',
        },
      ],
      traces: [
        {
          message_id: 'activity_projected_current',
          run_id: 'run_current',
          category: 'progress',
          phase: 'completed',
          status: 'completed',
          name: 'run.completed',
          summary: 'codex exited with code 0',
        },
      ],
      task: {
        run_state: 'idle',
        active_run: null,
        run_status: 'completed',
      },
    });

    expect(outcome).toMatchObject({
      success: true,
      failure: false,
      activityHasToken: true,
      artifactHasToken: false,
      latestRunnerOutput: 'final answer MANAGED_T2_OK',
      latestTraceSummary: 'codex exited with code 0',
    });
  });

  it('keeps terminal trace failures scoped to the current run when activity ids differ', () => {
    const outcome = evaluateAgentTaskExecutionSnapshot({
      token: 'EXPECTED_TOKEN',
      runnerOutputActivityId: 'activity_from_run_response',
      runId: 'run_current',
      activity: [
        {
          id: 'activity_projected_current',
          kind: 'runner_output',
          actor: 'runner',
          content: '',
          run_id: 'run_current',
        },
      ],
      traces: [
        {
          message_id: 'activity_projected_current',
          run_id: 'run_current',
          category: 'error',
          phase: 'end',
          status: 'error',
          name: 'execution.terminal',
          summary: 'agent_task_runner_mode_invalid:missing',
        },
      ],
      task: { run_state: 'running' },
    });

    expect(outcome).toMatchObject({
      success: false,
      failure: true,
      reason: 'terminal_trace_failure',
      activityHasToken: false,
    });
  });

  it('does not mark a current-run completed output successful when the token is absent', () => {
    const outcome = evaluateAgentTaskExecutionSnapshot({
      token: 'EXPECTED_TOKEN',
      runnerOutputActivityId: 'activity_from_run_response',
      runId: 'run_current',
      activity: [
        {
          id: 'activity_projected_current',
          kind: 'runner_output',
          actor: 'runner',
          content: 'completed without the expected marker',
          run_id: 'run_current',
        },
      ],
      traces: [
        {
          message_id: 'activity_projected_current',
          run_id: 'run_current',
          category: 'progress',
          phase: 'completed',
          status: 'completed',
          name: 'run.completed',
          summary: 'codex exited with code 0',
        },
      ],
      task: {
        run_state: 'idle',
        active_run: null,
        run_status: 'completed',
      },
    });

    expect(outcome).toMatchObject({
      success: false,
      failure: false,
      activityHasToken: false,
    });
  });

  it('does not accept a runner output id match from a different run when run_id identifies the current run', () => {
    const outcome = evaluateAgentTaskExecutionSnapshot({
      token: 'EXPECTED_TOKEN',
      runnerOutputActivityId: 'activity_from_run_response',
      runId: 'run_current',
      minRunnerOutputs: 2,
      activity: [
        {
          id: 'activity_from_run_response',
          kind: 'runner_output',
          actor: 'runner',
          content: 'historical EXPECTED_TOKEN',
          run_id: 'run_previous',
        },
        {
          id: 'activity_projected_current',
          kind: 'runner_output',
          actor: 'runner',
          content: 'current run completed without marker',
          run_id: 'run_current',
        },
      ],
      traces: [
        {
          message_id: 'activity_projected_current',
          run_id: 'run_current',
          category: 'progress',
          phase: 'completed',
          status: 'completed',
          name: 'run.completed',
          summary: 'codex exited with code 0',
        },
      ],
      task: {
        run_state: 'idle',
        active_run: null,
        run_status: 'completed',
      },
    });

    expect(outcome).toMatchObject({
      success: false,
      failure: false,
      activityHasToken: false,
      latestRunnerOutput: 'current run completed without marker',
    });
  });

  it('does not accept scoped final-state success from task-level run_status alone', () => {
    const finalState = resolveAgentTaskRunFinalState({
      activity: [],
      task: {
        id: 'task_1',
        run_state: 'idle',
        active_run: null,
        run_status: 'completed',
      },
      traces: [],
      runnerOutputActivityId: 'activity_from_run_response',
      runId: 'run_current',
    });

    expect(finalState).toBeNull();
  });

  it('accepts scoped final-state success from the current run terminal trace after active_run is cleared', () => {
    const finalState = resolveAgentTaskRunFinalState({
      activity: [],
      task: {
        id: 'task_1',
        run_state: 'idle',
        active_run: null,
        run_status: 'completed',
      },
      traces: [
        {
          message_id: 'activity_projected_current',
          run_id: 'run_current',
          category: 'progress',
          phase: 'completed',
          status: 'completed',
          name: 'run.completed',
          summary: 'codex exited with code 0',
        },
      ],
      runnerOutputActivityId: 'activity_from_run_response',
      runId: 'run_current',
    });

    expect(finalState).toMatchObject({
      runState: 'idle',
      runStatus: 'completed',
      activeRunId: null,
      activeRunStatus: null,
      terminalTraceSummary: 'codex exited with code 0',
    });
  });

  it('accepts scoped final-state success from current-run activity when projection id differs from the run response id', () => {
    const finalState = resolveAgentTaskRunFinalState({
      activity: [
        {
          id: 'activity_projected_current',
          kind: 'runner_output',
          actor: 'runner',
          content: 'final answer for the current run',
          run_id: 'run_current',
        },
      ],
      task: {
        id: 'task_1',
        run_state: 'idle',
        active_run: null,
        run_status: 'completed',
      },
      traces: [],
      runnerOutputActivityId: 'activity_from_run_response',
      runId: 'run_current',
    });

    expect(finalState).toMatchObject({
      runState: 'idle',
      runStatus: 'completed',
      activeRunId: null,
      activeRunStatus: null,
    });
  });

  it('does not accept old trace or activity evidence for scoped final-state success', () => {
    const finalState = resolveAgentTaskRunFinalState({
      activity: [
        {
          id: 'activity_from_run_response',
          kind: 'runner_output',
          actor: 'runner',
          content: 'old final answer',
          run_id: 'run_previous',
        },
      ],
      task: {
        id: 'task_1',
        run_state: 'idle',
        active_run: null,
        run_status: 'completed',
      },
      traces: [
        {
          message_id: 'activity_previous',
          run_id: 'run_previous',
          category: 'progress',
          phase: 'completed',
          status: 'completed',
          name: 'run.completed',
          summary: 'previous run completed',
        },
      ],
      runnerOutputActivityId: 'activity_from_run_response',
      runId: 'run_current',
    });

    expect(finalState).toBeNull();
  });

  it('waits for runner output tokens using run_id when the activity projection id differs from the run response id', async () => {
    const traceRequests: string[] = [];
    const get = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/activity')) {
        return okResponse([
          { id: 'activity_user_1', kind: 'user_intent', actor: 'user', content: 'first request' },
          {
            id: 'activity_runner_1',
            kind: 'runner_output',
            actor: 'runner',
            content: 'first answer MANAGED_T1_OK',
            run_id: 'run_previous',
          },
          { id: 'activity_user_2', kind: 'user_intent', actor: 'user', content: 'second request' },
          {
            id: 'activity_projected_current',
            kind: 'runner_output',
            actor: 'runner',
            content: 'final answer MANAGED_T2_OK',
            run_id: 'run_current',
          },
        ]);
      }
      if (url.includes('/traces?')) {
        traceRequests.push(url);
        return okResponse({
          items: [
            {
              message_id: 'activity_projected_current',
              run_id: 'run_current',
              category: 'progress',
              phase: 'completed',
              status: 'completed',
              name: 'run.completed',
              summary: 'codex exited with code 0',
            },
          ],
        });
      }
      if (url.endsWith('/tasks/task_1')) {
        return okResponse({
          id: 'task_1',
          run_state: 'idle',
          active_run: null,
          run_status: 'completed',
        });
      }
      throw new Error(`unexpected_get:${url}`);
    });
    const page = {
      evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
      request: { get },
      waitForTimeout: vi.fn().mockImplementation(
        () => new Promise<void>((resolve) => setTimeout(resolve, 1)),
      ),
    } as unknown as Parameters<typeof waitForRunnerOutputToken>[0]['page'];

    await expect(waitForRunnerOutputToken({
      page,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      token: 'MANAGED_T2_OK',
      runnerOutputActivityId: 'activity_from_run_response',
      runId: 'run_current',
      minRunnerOutputs: 2,
      timeoutMs: 5,
    })).resolves.toBeUndefined();

    expect(page.waitForTimeout).not.toHaveBeenCalled();
    expect(traceRequests[0]).toContain('run_id=run_current');
    expect(traceRequests[0]).not.toContain('message_id=activity_from_run_response');
  });

  it('fast-fails runner output token waits on runner error traces with trace summary context', async () => {
    const get = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/activity')) {
        return okResponse([
          { id: 'activity_user', kind: 'user_intent', actor: 'user', content: 'run task' },
          { id: 'activity_runner', kind: 'runner_output', actor: 'runner', content: '' },
        ]);
      }
      if (url.includes('/traces?')) {
        return okResponse({
          items: [
            {
              message_id: 'activity_runner',
              category: 'error',
              phase: 'end',
              status: 'error',
              name: 'execution.terminal',
              summary: 'agent_task_runner_mode_invalid:missing',
            },
          ],
        });
      }
      if (url.endsWith('/tasks/task_1')) {
        return okResponse({ id: 'task_1', run_state: 'running' });
      }
      throw new Error(`unexpected_get:${url}`);
    });
    const page = {
      evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
      request: { get },
      waitForTimeout: vi.fn(),
    } as unknown as Parameters<typeof waitForRunnerOutputToken>[0]['page'];

    let thrown: Error | null = null;
    try {
      await waitForRunnerOutputToken({
        page,
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        token: 'EXPECTED_TOKEN',
      });
    } catch (error) {
      thrown = error instanceof Error ? error : new Error(String(error));
    }

    expect(thrown?.message).toContain('runner_output_token_failed:terminal_trace_failure');
    expect(thrown?.message).toContain('traces:');
    expect(thrown?.message).toContain('error/error execution.terminal: agent_task_runner_mode_invalid:missing');
    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });

  it('keeps waiting after non-terminal codex command error traces so the model can recover', async () => {
    let activityReadCount = 0;
    const get = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/activity')) {
        activityReadCount += 1;
        return okResponse(activityReadCount === 1
          ? [
              { id: 'activity_user', kind: 'user_intent', actor: 'user', content: 'run task' },
              { id: 'activity_runner', kind: 'runner_output', actor: 'runner', content: '' },
            ]
          : [
              { id: 'activity_user', kind: 'user_intent', actor: 'user', content: 'run task' },
              { id: 'activity_runner', kind: 'runner_output', actor: 'runner', content: 'Recovered with EXPECTED_TOKEN' },
            ]);
      }
      if (url.includes('/traces?')) {
        return okResponse({
          items: [
            {
              message_id: 'activity_runner',
              category: 'error',
              phase: 'end',
              status: 'error',
              name: 'codex.command',
              summary: 'Command failed (exit 1)',
            },
          ],
        });
      }
      if (url.endsWith('/tasks/task_1')) {
        return okResponse({ id: 'task_1', run_state: 'running' });
      }
      throw new Error(`unexpected_get:${url}`);
    });
    const page = {
      evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
      request: { get },
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof waitForRunnerOutputToken>[0]['page'];

    await expect(waitForRunnerOutputToken({
      page,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      token: 'EXPECTED_TOKEN',
      timeoutMs: 10_000,
    })).resolves.toBeUndefined();
    expect(activityReadCount).toBe(2);
    expect(page.waitForTimeout).toHaveBeenCalledTimes(1);
  });

  it('fast-fails runner output token waits on synthesized runner output errors', async () => {
    const get = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/activity')) {
        return okResponse([
          {
            id: 'activity_runner',
            kind: 'runner_output',
            actor: 'runner',
            content: 'Execution failed before any visible output was produced.\nError code: AGENT_UPSTREAM_ERROR',
          },
        ]);
      }
      if (url.includes('/traces?')) {
        return okResponse({ items: [] });
      }
      if (url.endsWith('/tasks/task_1')) {
        return okResponse({ id: 'task_1', run_state: 'idle' });
      }
      throw new Error(`unexpected_get:${url}`);
    });
    const page = {
      evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
      request: { get },
      waitForTimeout: vi.fn(),
    } as unknown as Parameters<typeof waitForRunnerOutputToken>[0]['page'];

    await expect(waitForRunnerOutputToken({
      page,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      token: 'EXPECTED_TOKEN',
    })).rejects.toThrow('runner_output_token_failed:runner_output_error');
    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });

  it('adds derived workload pod context when runner output token waits fast-fail', async () => {
    const taskId = 'task_6d3e6b9c5a6444988cf15bc1eb9663c9';
    const workloadId = 'task-6d3e6b9c5a6444988cf15bc1eb9663c9';
    const podName = `workload-${workloadId}`;

    await withMockKubectlPodSnapshot({
      items: [
        {
          metadata: {
            name: podName,
            uid: 'pod-uid-derived',
            labels: {
              app: 'managed-workload',
              workspace_id: 'ws-default-9f642c763af7',
              project_id: 'proj-1-e04b05f9bca4',
              workload_id: `${workloadId}-15772034fcfa`,
            },
            annotations: {
              'mbos.io/workspace-id': 'ws_default',
              'mbos.io/project-id': 'proj_1',
              'mbos.io/workload-id': workloadId,
            },
          },
          status: {
            phase: 'Running',
            conditions: [{ type: 'Ready', status: 'True' }],
            containerStatuses: [{ ready: true, state: { running: {} } }],
          },
        },
      ],
    }, async ({ argLogPath }) => {
      const get = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/activity')) {
          return okResponse([
            {
              id: 'activity_runner',
              kind: 'runner_output',
              actor: 'runner',
              content: 'Execution failed before any visible output was produced.\nError code: AGENT_UPSTREAM_ERROR',
            },
          ]);
        }
        if (url.includes('/traces?')) {
          return okResponse({ items: [] });
        }
        if (url.endsWith(`/tasks/${taskId}`)) {
          return okResponse({ id: taskId, run_state: 'idle' });
        }
        throw new Error(`unexpected_get:${url}`);
      });
      const page = {
        evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
        request: { get },
        waitForTimeout: vi.fn(),
      } as unknown as Parameters<typeof waitForRunnerOutputToken>[0]['page'];

      let thrown: Error | null = null;
      try {
        await waitForRunnerOutputToken({
          page,
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId,
          token: 'EXPECTED_TOKEN',
        });
      } catch (error) {
        thrown = error instanceof Error ? error : new Error(String(error));
      }

      expect(thrown?.message).toContain('runner_output_token_failed:runner_output_error');
      expect(thrown?.message).toContain(`pod=${podName}`);
      expect(thrown?.message).toContain('uid=pod-uid-derived');
      expect(thrown?.message).toContain('ready=true');
      expect(thrown?.message).not.toContain('pod: <missing>');
      expect(await readFile(argLogPath, 'utf8')).toContain(
        'get pods -n agentsmith-sandbox -l app=managed-workload -o json',
      );
      expect(await readFile(argLogPath, 'utf8')).not.toContain(`workload_id=${workloadId}`);
      expect(page.waitForTimeout).not.toHaveBeenCalled();
    });
  });

  it('adds derived workload pod context when runner output token waits time out', async () => {
    const taskId = 'task_timeout_diag';
    const workloadId = 'task-timeout-diag';
    const podName = `workload-${workloadId}`;

    await withMockKubectlPodSnapshot({
      items: [
        {
          metadata: {
            name: podName,
            uid: 'pod-uid-timeout',
            labels: {
              app: 'managed-workload',
              workspace_id: 'ws-default-9f642c763af7',
              project_id: 'proj-1-e04b05f9bca4',
              workload_id: `${workloadId}-15772034fcfa`,
            },
            annotations: {
              'mbos.io/workspace-id': 'ws_default',
              'mbos.io/project-id': 'proj_1',
              'mbos.io/workload-id': workloadId,
            },
          },
          status: {
            phase: 'Pending',
            conditions: [{ type: 'Ready', status: 'False', reason: 'ContainersNotReady' }],
            containerStatuses: [
              {
                ready: false,
                state: { waiting: { reason: 'ContainerCreating' } },
              },
            ],
          },
        },
      ],
    }, async ({ argLogPath }) => {
      const get = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/activity')) {
          return okResponse([]);
        }
        if (url.includes('/traces?')) {
          return okResponse({ items: [] });
        }
        if (url.endsWith(`/tasks/${taskId}`)) {
          return okResponse({ id: taskId, run_state: 'running' });
        }
        throw new Error(`unexpected_get:${url}`);
      });
      const page = {
        evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
        request: { get },
        waitForTimeout: vi.fn(),
      } as unknown as Parameters<typeof waitForRunnerOutputToken>[0]['page'];

      let thrown: Error | null = null;
      try {
        await waitForRunnerOutputToken({
          page,
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId,
          token: 'EXPECTED_TOKEN',
          timeoutMs: 0,
        });
      } catch (error) {
        thrown = error instanceof Error ? error : new Error(String(error));
      }

      expect(thrown?.message).toContain(`runner_output_token_timeout:${taskId}`);
      expect(thrown?.message).toContain(`pod=${podName}`);
      expect(thrown?.message).toContain('uid=pod-uid-timeout');
      expect(thrown?.message).toContain('ready=false');
      expect(thrown?.message).toContain('ready_reason=ContainersNotReady');
      expect(thrown?.message).not.toContain('pod: <missing>');
      expect(await readFile(argLogPath, 'utf8')).toContain(
        'get pods -n agentsmith-sandbox -l app=managed-workload -o json',
      );
      expect(await readFile(argLogPath, 'utf8')).not.toContain(`workload_id=${workloadId}`);
      expect(page.waitForTimeout).not.toHaveBeenCalled();
    });
  });

  it('observes managed workload pod presence and identity by raw ASBCP annotation truth', async () => {
    const workloadId = 'task-presence-diag';
    const podName = `asbcp-ws-default-proj-1-${workloadId}-15772034fcfa`;

    await withMockKubectlPodSnapshot({
      items: [
        {
          metadata: {
            name: 'workload-task-presence-diag-extra',
            uid: 'pod-uid-other',
            labels: {
              app: 'managed-workload',
              workspace_id: 'ws-default-9f642c763af7',
              project_id: 'proj-1-e04b05f9bca4',
              workload_id: `${workloadId}-extra-15772034fcfa`,
            },
            annotations: {
              'mbos.io/workspace-id': 'ws_default',
              'mbos.io/project-id': 'proj_1',
              'mbos.io/workload-id': `${workloadId}-extra`,
            },
          },
        },
        {
          metadata: {
            name: podName,
            uid: 'pod-uid-presence',
            labels: {
              app: 'managed-workload',
              workspace_id: 'ws-default-9f642c763af7',
              project_id: 'proj-1-e04b05f9bca4',
              workload_id: `${workloadId}-15772034fcfa`,
            },
            annotations: {
              'mbos.io/workspace-id': 'ws_default',
              'mbos.io/project-id': 'proj_1',
              'mbos.io/workload-id': workloadId,
            },
          },
        },
      ],
    }, async ({ argLogPath }) => {
      await expect(waitForWorkloadPodPresent({
        namespace: 'agentsmith-sandbox',
        workloadId,
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        timeoutMs: 1_000,
      })).resolves.toBe(podName);

      await expect(waitForWorkloadPodIdentity({
        namespace: 'agentsmith-sandbox',
        workloadId,
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        timeoutMs: 1_000,
      })).resolves.toEqual({
        name: podName,
        uid: 'pod-uid-presence',
      });

      await expect(waitForWorkloadPodDeleted({
        namespace: 'agentsmith-sandbox',
        workloadId,
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        timeoutMs: 10,
      })).rejects.toThrow();

      const argLog = await readFile(argLogPath, 'utf8');
      expect(argLog).toContain('get pods -n agentsmith-sandbox -l app=managed-workload -o json');
      expect(argLog).not.toContain(`workload_id=${workloadId}`);
    });
  });

  it('creates Agent Task runner bundles without external mode, legacy selectors, or chat session side effects', async () => {
    const previousMongoUrl = process.env.MONGO_URL;
    const previousMongoDbName = process.env.MONGO_DB_NAME;
    process.env.MONGO_URL = 'mongodb://mbos:mbos_dev_password@localhost:17017/admin';
    process.env.MONGO_DB_NAME = 'mbos';
    upsertManagedRunner.mockResolvedValue({
      runnerId: 'runner_1',
      runnerName: 'agent-task-runner',
      status: 'ready',
      isDefault: true,
      defaultEndpointId: 'ep_task',
      capabilities: {},
      diagnostics: { presence: 'managed' },
      wsUrl: 'ws://127.0.0.1:20000/agent-runner/ws',
    });
    const post = vi.fn().mockImplementation(async (url: string, options?: { data?: Record<string, unknown> }) => {
      if (url.endsWith('/tasks')) {
        return okResponse({
          id: 'task_1',
          title: options?.data?.title,
          active_run: null,
        });
      }
      throw new Error(`unexpected_post:${url}:${JSON.stringify(options?.data ?? null)}`);
    });
    const get = vi.fn().mockResolvedValue(okResponse({
      readiness: { state: 'not_configured' },
    }));
    const patch = vi.fn().mockResolvedValue(okResponse({
      setting: {
        endpoint_id: 'ep_task',
        default_model: 'seed-model',
        setting_revision: 'set_bundle_1',
      },
    }));
    const page = {
      evaluate: vi.fn().mockResolvedValue(JSON.stringify({ state: { token: 'mock_token' } })),
      request: {
        get,
        patch,
        post,
      },
    } as unknown as Parameters<typeof createAgentTaskRunnerBundleViaApi>[0];

    try {
      const bundle = await createAgentTaskRunnerBundleViaApi(page, {
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        endpointId: 'ep_task',
        runnerTitle: 'agent-task-runner',
        taskTitle: 'agent-task',
        workspaceName: 'Agent Task Workspace',
      });

      expect(bundle).toMatchObject({
        runnerId: 'runner_1',
        runnerName: 'agent-task-runner',
        taskId: 'task_1',
      });
      expect(upsertManagedRunner).toHaveBeenCalledTimes(1);
      expect(upsertManagedRunner).toHaveBeenCalledWith(expect.objectContaining({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        endpointId: 'ep_task',
        runnerName: 'agent-task-runner',
        isDefault: true,
      }));
      expect(patch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/workspaces/ws_default/projects/proj_1/agent-task-model-setting'),
        expect.objectContaining({
          data: {
            endpoint_id: 'ep_task',
            expected_setting_revision: null,
          },
        }),
      );
      expect(post).toHaveBeenCalledTimes(1);
      expect(post).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/workspaces/ws_default/projects/proj_1/tasks'),
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'agent-task',
            workspace_name: 'Agent Task Workspace',
          }),
        }),
      );
      const taskPayload = post.mock.calls[0]?.[1]?.data as Record<string, unknown>;
      expect(taskPayload).not.toHaveProperty('agent_id');
      expect(taskPayload).not.toHaveProperty('runner_id');
      expect(taskPayload).not.toHaveProperty('agent_name');
      expect(taskPayload).not.toHaveProperty('endpoint_id');
      expect(taskPayload).not.toHaveProperty('default_endpoint_id');
      expect(taskPayload).not.toHaveProperty('model');
    } finally {
      if (previousMongoUrl === undefined) {
        delete process.env.MONGO_URL;
      } else {
        process.env.MONGO_URL = previousMongoUrl;
      }
      if (previousMongoDbName === undefined) {
        delete process.env.MONGO_DB_NAME;
      } else {
        process.env.MONGO_DB_NAME = previousMongoDbName;
      }
    }
  });
});
