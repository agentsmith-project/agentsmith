import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';

const children: ChildProcessWithoutNullStreams[] = [];
const servers: http.Server[] = [];
const tempRoots: string[] = [];

afterEach(async () => {
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
  children.length = 0;
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  servers.length = 0;
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('chat-llm-runner', () => {
  it('announces a chat runner spec and echoes the latest user text', async () => {
    const server = http.createServer();
    servers.push(server);
    const wss = new WebSocketServer({ noServer: true });
    const upstreamServer = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        expect(req.url).toContain('/workspaces/ws_test/projects/proj_test/endpoints/ep_test/proxy/openai/chat/completions');
        expect(req.headers.authorization).toBe('Bearer exec_test');
        expect(body).toContain('latest turn');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          choices: [
            {
              message: { content: 'latest turn' },
              finish_reason: 'stop',
            },
          ],
          usage: { total_tokens: 11 },
        }));
      });
    });
    servers.push(upstreamServer);
    await new Promise<void>((resolve, reject) => {
      upstreamServer.once('error', reject);
      upstreamServer.listen(0, '127.0.0.1', () => resolve());
    });
    const upstreamAddress = upstreamServer.address();
    if (!upstreamAddress || typeof upstreamAddress === 'string') {
      throw new Error('chat_runner_test_upstream_missing_address');
    }
    const upstreamBaseUrl = `http://127.0.0.1:${upstreamAddress.port}/api/v1`;

    let connection: WebSocket | null = null;
    let readyPayload: Record<string, unknown> | null = null;
    let echoedText = '';

    wss.on('connection', (ws) => {
      connection = ws;
      ws.send(JSON.stringify({
        type: 'server.hello',
        timestamp: new Date().toISOString(),
        payload: {
          protocol_version: '1.0',
          heartbeat_interval_sec: 15,
        },
      }));
      ws.once('message', (raw) => {
        const message = JSON.parse(raw.toString('utf-8')) as {
          type?: string;
          payload?: Record<string, unknown>;
        };
        expect(message.type).toBe('agent.ready');
        readyPayload = message.payload ?? {};
        ws.send(JSON.stringify({
          type: 'server.request.start',
          request_id: 'req_chat_test',
          timestamp: new Date().toISOString(),
          payload: {
            messages: [
              { role: 'system', content: 'ignore' },
              { role: 'user', content: 'first turn' },
              { role: 'assistant', content: 'prior answer' },
              { role: 'user', content: 'latest turn' },
            ],
            execution_context: {
              interaction_kind: 'chat',
              session_id: 'session_chat_test',
              workspace_id: 'ws_test',
              project_id: 'proj_test',
              endpoint_id: 'ep_test',
              execution_ticket: 'exec_test',
              api_base: upstreamBaseUrl,
              username: 'tester',
            },
          },
        }));
      });
      ws.on('message', (raw) => {
        const message = JSON.parse(raw.toString('utf-8')) as {
          type?: string;
          request_id?: string;
          payload?: { delta?: string };
        };
        if (message.type === 'agent.response.delta' && message.payload?.delta) {
          echoedText += message.payload.delta;
        }
        if (message.type === 'agent.response.done') {
          // no-op, the assertion is handled after the socket closes
        }
      });
    });

    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('chat_runner_test_server_missing_address');
    }

    const runner = spawn(
      'node_modules/.bin/tsx',
      [path.resolve('packages/chat-llm-runner/src/index.ts')],
      {
        env: {
          ...process.env,
          MBOS_AGENT_WS_URL: `ws://127.0.0.1:${address.port}/api/v1/agent-execution/ws?agent_id=ag_chat_test`,
          MBOS_AGENT_KEY: 'ask_test',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    children.push(runner);

    const stdout: string[] = [];
    const stderr: string[] = [];
    runner.stdout.on('data', (chunk) => {
      stdout.push(chunk.toString('utf-8'));
    });
    runner.stderr.on('data', (chunk) => {
      stderr.push(chunk.toString('utf-8'));
    });

    await expect
      .poll(
        () => readyPayload?.runner_spec,
        { timeout: 30_000, intervals: [250, 500, 1000] },
      )
      .toMatchObject({
        interaction_kind: 'chat',
        app_family: 'llm_runner',
      });

    await expect
      .poll(
        () => echoedText,
        { timeout: 30_000, intervals: [250, 500, 1000] },
      )
      .toBe('latest turn');

    await new Promise<void>((resolve) => {
      if (!connection) {
        resolve();
        return;
      }
      connection.once('close', () => resolve());
      connection.close();
    });
    await new Promise<void>((resolve) => {
      runner.once('exit', () => resolve());
      runner.kill('SIGTERM');
      setTimeout(() => resolve(), 2_000);
    });

    expect(stdout.join('')).toContain('[chat-llm-runner] connected');
    expect(stderr.join('')).not.toContain('error');
  }, 30_000);

  it('rejects notebook execution context instead of treating it like chat', async () => {
    const server = http.createServer();
    servers.push(server);
    const wss = new WebSocketServer({ noServer: true });

    let connection: WebSocket | null = null;
    let readyPayload: Record<string, unknown> | null = null;
    let errorPayload: Record<string, unknown> | null = null;

    wss.on('connection', (ws) => {
      connection = ws;
      ws.send(JSON.stringify({
        type: 'server.hello',
        timestamp: new Date().toISOString(),
        payload: {
          protocol_version: '1.0',
          heartbeat_interval_sec: 15,
        },
      }));
      ws.once('message', (raw) => {
        const message = JSON.parse(raw.toString('utf-8')) as {
          type?: string;
          payload?: Record<string, unknown>;
        };
        expect(message.type).toBe('agent.ready');
        readyPayload = message.payload ?? {};
        ws.send(JSON.stringify({
          type: 'server.request.start',
          request_id: 'req_chat_invalid_context',
          timestamp: new Date().toISOString(),
          payload: {
            messages: [{ role: 'user', content: 'hello notebook' }],
            execution_context: {
              interaction_kind: 'notebook',
              task_id: 'task_should_fail',
              session_id: 'session_should_fail',
              workspace_id: 'ws_test',
              project_id: 'proj_test',
              endpoint_id: 'ep_test',
              execution_ticket: 'exec_test',
              api_base: 'http://127.0.0.1:65535/api/v1',
              username: 'tester',
            },
          },
        }));
      });
      ws.on('message', (raw) => {
        const message = JSON.parse(raw.toString('utf-8')) as {
          type?: string;
          payload?: Record<string, unknown>;
        };
        if (message.type === 'agent.response.error') {
          errorPayload = message.payload ?? {};
        }
      });
    });

    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('chat_runner_test_server_missing_address');
    }

    const runner = spawn(
      'node_modules/.bin/tsx',
      [path.resolve('packages/chat-llm-runner/src/index.ts')],
      {
        env: {
          ...process.env,
          MBOS_AGENT_WS_URL: `ws://127.0.0.1:${address.port}/api/v1/agent-execution/ws?agent_id=ag_chat_test`,
          MBOS_AGENT_KEY: 'ask_test',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    children.push(runner);

    await expect
      .poll(
        () => readyPayload?.runner_spec,
        { timeout: 30_000, intervals: [250, 500, 1000] },
      )
      .toMatchObject({
        interaction_kind: 'chat',
        app_family: 'llm_runner',
      });

    await expect
      .poll(
        () => errorPayload?.error_message,
        { timeout: 30_000, intervals: [250, 500, 1000] },
      )
      .toBe('chat_execution_context_invalid');

    await new Promise<void>((resolve) => {
      if (!connection) {
        resolve();
        return;
      }
      connection.once('close', () => resolve());
      connection.close();
    });
    await new Promise<void>((resolve) => {
      runner.once('exit', () => resolve());
      runner.kill('SIGTERM');
      setTimeout(() => resolve(), 2_000);
    });
  }, 30_000);

  it('does not synthesize a fallback reply when the upstream returns no text', async () => {
    const server = http.createServer();
    servers.push(server);
    const wss = new WebSocketServer({ noServer: true });
    const upstreamServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: '' }, finish_reason: 'stop' }],
        usage: { total_tokens: 3 },
      }));
    });
    servers.push(upstreamServer);
    await new Promise<void>((resolve, reject) => {
      upstreamServer.once('error', reject);
      upstreamServer.listen(0, '127.0.0.1', () => resolve());
    });
    const upstreamAddress = upstreamServer.address();
    if (!upstreamAddress || typeof upstreamAddress === 'string') {
      throw new Error('chat_runner_test_upstream_missing_address');
    }
    const upstreamBaseUrl = `http://127.0.0.1:${upstreamAddress.port}/api/v1`;

    let connection: WebSocket | null = null;
    let donePayload: Record<string, unknown> | null = null;
    let deltaCount = 0;

    wss.on('connection', (ws) => {
      connection = ws;
      ws.send(JSON.stringify({
        type: 'server.hello',
        timestamp: new Date().toISOString(),
        payload: {
          protocol_version: '1.0',
          heartbeat_interval_sec: 15,
        },
      }));
      ws.once('message', () => {
        ws.send(JSON.stringify({
          type: 'server.request.start',
          request_id: 'req_chat_empty_response',
          timestamp: new Date().toISOString(),
          payload: {
            messages: [{ role: 'user', content: 'should stay empty' }],
            execution_context: {
              interaction_kind: 'chat',
              session_id: 'session_chat_empty',
              workspace_id: 'ws_test',
              project_id: 'proj_test',
              endpoint_id: 'ep_test',
              execution_ticket: 'exec_test',
              api_base: upstreamBaseUrl,
              username: 'tester',
            },
          },
        }));
      });
      ws.on('message', (raw) => {
        const message = JSON.parse(raw.toString('utf-8')) as {
          type?: string;
          payload?: Record<string, unknown>;
        };
        if (message.type === 'agent.response.delta') {
          deltaCount += 1;
        }
        if (message.type === 'agent.response.done') {
          donePayload = message.payload ?? {};
        }
      });
    });

    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('chat_runner_test_server_missing_address');
    }

    const runner = spawn(
      'node_modules/.bin/tsx',
      [path.resolve('packages/chat-llm-runner/src/index.ts')],
      {
        env: {
          ...process.env,
          MBOS_AGENT_WS_URL: `ws://127.0.0.1:${address.port}/api/v1/agent-execution/ws?agent_id=ag_chat_test`,
          MBOS_AGENT_KEY: 'ask_test',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    children.push(runner);

    await expect
      .poll(
        () => donePayload,
        { timeout: 30_000, intervals: [250, 500, 1000] },
      )
      .toEqual({
        finish_reason: 'stop',
        usage_tokens: 3,
      });
    expect(deltaCount).toBe(0);

    await new Promise<void>((resolve) => {
      if (!connection) {
        resolve();
        return;
      }
      connection.once('close', () => resolve());
      connection.close();
    });
    await new Promise<void>((resolve) => {
      runner.once('exit', () => resolve());
      runner.kill('SIGTERM');
      setTimeout(() => resolve(), 2_000);
    });
  }, 30_000);

  it('emits a reclaim warning when a continuation session workspace is missing', async () => {
    const server = http.createServer();
    servers.push(server);
    const wss = new WebSocketServer({ noServer: true });
    const upstreamServer = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: 'continued' }, finish_reason: 'stop' }],
        usage: { total_tokens: 7 },
      }));
    });
    servers.push(upstreamServer);
    await new Promise<void>((resolve, reject) => {
      upstreamServer.once('error', reject);
      upstreamServer.listen(0, '127.0.0.1', () => resolve());
    });
    const upstreamAddress = upstreamServer.address();
    if (!upstreamAddress || typeof upstreamAddress === 'string') {
      throw new Error('chat_runner_test_upstream_missing_address');
    }
    const upstreamBaseUrl = `http://127.0.0.1:${upstreamAddress.port}/api/v1`;

    const sessionRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-runner-session-root-'));
    tempRoots.push(sessionRoot);
    const existingSessionDir = path.join(sessionRoot, encodeURIComponent('session_chat_reclaim'));
    await fs.mkdir(existingSessionDir, { recursive: true });
    await fs.rm(existingSessionDir, { recursive: true, force: true });

    let connection: WebSocket | null = null;
    let warningPayload: Record<string, unknown> | null = null;
    let doneReceived = false;

    wss.on('connection', (ws) => {
      connection = ws;
      ws.send(JSON.stringify({
        type: 'server.hello',
        timestamp: new Date().toISOString(),
        payload: {
          protocol_version: '1.0',
          heartbeat_interval_sec: 15,
        },
      }));
      ws.once('message', () => {
        ws.send(JSON.stringify({
          type: 'server.request.start',
          request_id: 'req_chat_reclaim',
          timestamp: new Date().toISOString(),
          payload: {
            messages: [
              { role: 'user', content: 'first turn' },
              { role: 'assistant', content: 'first answer' },
              { role: 'user', content: 'continue please' },
            ],
            execution_context: {
              interaction_kind: 'chat',
              session_id: 'session_chat_reclaim',
              workspace_id: 'ws_test',
              project_id: 'proj_test',
              endpoint_id: 'ep_test',
              execution_ticket: 'exec_test',
              api_base: upstreamBaseUrl,
              username: 'tester',
            },
          },
        }));
      });
      ws.on('message', (raw) => {
        const message = JSON.parse(raw.toString('utf-8')) as {
          type?: string;
          payload?: Record<string, unknown>;
        };
        if (message.type === 'agent.response.event') {
          warningPayload = message.payload ?? null;
        }
        if (message.type === 'agent.response.done') {
          doneReceived = true;
        }
      });
    });

    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('chat_runner_test_server_missing_address');
    }

    const runner = spawn(
      'node_modules/.bin/tsx',
      [path.resolve('packages/chat-llm-runner/src/index.ts')],
      {
        env: {
          ...process.env,
          MBOS_AGENT_WS_URL: `ws://127.0.0.1:${address.port}/api/v1/agent-execution/ws?agent_id=ag_chat_test`,
          MBOS_AGENT_KEY: 'ask_test',
          MBOS_CHAT_SESSION_ROOT: sessionRoot,
          MBOS_CHAT_SESSION_JANITOR_INTERVAL_MS: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    children.push(runner);

    await expect
      .poll(() => warningPayload, { timeout: 30_000, intervals: [250, 500, 1000] })
      .toMatchObject({
        category: 'warning',
        name: 'session.workspace_recreated',
        summary: 'chat_session_workspace_recreated',
      });

    await expect
      .poll(() => doneReceived, { timeout: 30_000, intervals: [250, 500, 1000] })
      .toBe(true);

    await expect(fs.stat(path.join(sessionRoot, encodeURIComponent('session_chat_reclaim')))).resolves.toBeTruthy();

    await new Promise<void>((resolve) => {
      if (!connection) {
        resolve();
        return;
      }
      connection.once('close', () => resolve());
      connection.close();
    });
    await new Promise<void>((resolve) => {
      runner.once('exit', () => resolve());
      runner.kill('SIGTERM');
      setTimeout(() => resolve(), 2_000);
    });
  }, 30_000);
});
