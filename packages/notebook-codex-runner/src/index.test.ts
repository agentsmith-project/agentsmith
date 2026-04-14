import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockTerminalChild = {
  exitCode: number | null;
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  onExit: ReturnType<typeof vi.fn>;
};

type MockTerminalProcessResult = {
  child: MockTerminalChild;
  cwd: string;
};

const {
  assertNotebookExecutionContextMock,
  buildCodexExecArgsMock,
  buildTaskCodexConfigMock,
  buildTaskCodexModelCatalogMock,
  buildNotebookHeadlessPreambleMock,
  buildTaskUserInstallEnvMock,
  diffWorkspaceFileSnapshotsMock,
  ensureCodexSessionStateCompatibleMock,
  filterNewArtifactsForRunMock,
  inspectBuiltinSkillsMock,
  mkdirMock,
  prepareLaunchCommandMock,
  prepareNotebookWorkspaceAssetsMock,
  prepareTaskWorkspaceMock,
  releaseAllPreparedTaskWorkspacesMock,
  resolveBuiltinSkillsConfigMock,
  resolveCodexTerminalOutcomeMock,
  resolveRunnerSuccessPolicyMock,
  scanArtifactsDirectoryMock,
  scanWorkspaceFilesSnapshotMock,
  selectLatestInstructionMock,
  seedBuiltinSkillsMock,
  sanitizeAgentDeltaChunkMock,
  sanitizeStderrChunkMock,
  startTerminalProcessMock,
  spawnMock,
  websocketInstances,
  WebSocketMock,
  writeFileMock,
} = vi.hoisted(() => {
  const websocketInstances: Array<EventEmitter & { send: ReturnType<typeof vi.fn> }> = [];
  return {
    assertNotebookExecutionContextMock: vi.fn((value: unknown) => value),
    buildCodexExecArgsMock: vi.fn(() => ['--exec']),
    buildTaskCodexConfigMock: vi.fn(() => 'task-config'),
    buildTaskCodexModelCatalogMock: vi.fn(() => 'model-catalog'),
    buildNotebookHeadlessPreambleMock: vi.fn(() => 'PREAMBLE'),
    buildTaskUserInstallEnvMock: vi.fn((homeDir: string, env: NodeJS.ProcessEnv) => ({
      ...env,
      HOME: homeDir,
    })),
    diffWorkspaceFileSnapshotsMock: vi.fn(() => ({ added: [], modified: [], deleted: [] })),
    ensureCodexSessionStateCompatibleMock: vi.fn(async () => ({ resetPerformed: false, reason: 'missing' as const })),
    filterNewArtifactsForRunMock: vi.fn(() => []),
    inspectBuiltinSkillsMock: vi.fn(async () => ({
      sourceDir: '/seed-skills',
      available: [],
      missing: [],
    })),
    mkdirMock: vi.fn(async () => undefined),
    prepareLaunchCommandMock: vi.fn(async (input: { file: string; args: string[]; env: NodeJS.ProcessEnv }) => ({
      file: input.file,
      args: input.args,
      env: input.env,
    })),
    prepareNotebookWorkspaceAssetsMock: vi.fn(async () => ({ artifactsDir: '/workspace/.artifacts' })),
    prepareTaskWorkspaceMock: vi.fn(async () => ({
      cwd: '/workspace/task_1',
      source: 'file_library_mount' as const,
      paths: {
        mode: 'docker_external' as const,
        mountRoot: '/workspace/task_1',
        taskRoot: '/workspace/task_1',
        homeDir: '/workspace/task_1',
        codexDir: '/workspace/task_1/.codex',
        artifactsDir: '/workspace/task_1/.artifacts',
        mbosDir: '/workspace/task_1/.mbos',
        skillsDir: '/workspace/task_1/.agents/skills',
      },
      release: vi.fn(async () => undefined),
    })),
    releaseAllPreparedTaskWorkspacesMock: vi.fn(async () => undefined),
    resolveBuiltinSkillsConfigMock: vi.fn(() => ({
      sourceDir: '/seed-skills',
      required: false,
      skills: [],
    })),
    resolveCodexTerminalOutcomeMock: vi.fn(() => ({
      finalStatus: 'success' as const,
      codexTraceStatus: 'success' as const,
      errorCode: null,
      errorMessage: null,
    })),
    resolveRunnerSuccessPolicyMock: vi.fn(() => ({ ok: true as const })),
    scanArtifactsDirectoryMock: vi.fn(async () => []),
    scanWorkspaceFilesSnapshotMock: vi.fn(async () => undefined),
    selectLatestInstructionMock: vi.fn(() => 'latest user instruction'),
    seedBuiltinSkillsMock: vi.fn(async () => ({
      targetDir: '/workspace/task_1/.agents/skills',
      seeded: [],
      manifestPath: '/workspace/task_1/.mbos/builtin-skills-manifest.json',
    })),
    sanitizeAgentDeltaChunkMock: vi.fn((chunk: string) => chunk),
    sanitizeStderrChunkMock: vi.fn((chunk: string) => chunk),
    startTerminalProcessMock: vi.fn(async (): Promise<MockTerminalProcessResult> => ({
      child: {
        exitCode: null as number | null,
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
        onData: vi.fn(),
        onExit: vi.fn(),
      },
      cwd: '/workspace/task_1',
    })),
    spawnMock: vi.fn(),
    websocketInstances,
    WebSocketMock: vi.fn(function WebSocketMock(this: unknown) {
      const socket = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn> };
      socket.send = vi.fn();
      websocketInstances.push(socket);
      return socket;
    }),
    writeFileMock: vi.fn(async () => undefined),
  };
});

vi.mock('ws', () => ({
  WebSocket: WebSocketMock,
}));

vi.mock('@mbos/agent-runner', () => ({
  assertNotebookExecutionContext: assertNotebookExecutionContextMock,
  NOTEBOOK_RUNNER_SPEC: {
    app_family: 'notebook_runner',
    interaction_kind: 'notebook',
  },
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  default: {
    spawn: spawnMock,
  },
}));

vi.mock('node:fs/promises', () => ({
  mkdir: mkdirMock,
  writeFile: writeFileMock,
  default: {
    mkdir: mkdirMock,
    writeFile: writeFileMock,
  },
}));

vi.mock('./agent-runtime-env.js', () => ({
  buildAgentRuntimeEnv: vi.fn(() => ({})),
}));

vi.mock('./artifact-scan.js', () => ({
  diffWorkspaceFileSnapshots: diffWorkspaceFileSnapshotsMock,
  filterNewArtifactsForRun: filterNewArtifactsForRunMock,
  rememberArtifactsForRun: vi.fn(),
  scanArtifactsDirectory: scanArtifactsDirectoryMock,
  scanWorkspaceFilesSnapshot: scanWorkspaceFilesSnapshotMock,
}));

vi.mock('./builtin-skills.js', () => ({
  inspectBuiltinSkills: inspectBuiltinSkillsMock,
  resolveBuiltinSkillsConfig: resolveBuiltinSkillsConfigMock,
  seedBuiltinSkills: seedBuiltinSkillsMock,
}));

vi.mock('./child-launcher.js', () => ({
  prepareLaunchCommand: prepareLaunchCommandMock,
}));

vi.mock('./codex-command-builder.js', () => ({
  buildCodexExecArgs: buildCodexExecArgsMock,
  buildTaskCodexConfig: buildTaskCodexConfigMock,
  buildTaskCodexModelCatalog: buildTaskCodexModelCatalogMock,
}));

vi.mock('./codex-output-filter.js', () => ({
  sanitizeAgentDeltaChunk: sanitizeAgentDeltaChunkMock,
  sanitizeStderrChunk: sanitizeStderrChunkMock,
}));

vi.mock('./notebook-assets.js', () => ({
  buildNotebookHeadlessPreamble: buildNotebookHeadlessPreambleMock,
  prepareNotebookWorkspaceAssets: prepareNotebookWorkspaceAssetsMock,
}));

vi.mock('./prompt-selection.js', () => ({
  selectLatestInstruction: selectLatestInstructionMock,
}));

vi.mock('./run-result-policy.js', () => ({
  resolveRunnerSuccessPolicy: resolveRunnerSuccessPolicyMock,
}));

vi.mock('./session-state.js', () => ({
  ensureCodexSessionStateCompatible: ensureCodexSessionStateCompatibleMock,
}));

vi.mock('./task-workspace.js', () => ({
  prepareTaskWorkspace: prepareTaskWorkspaceMock,
  releaseAllPreparedTaskWorkspaces: releaseAllPreparedTaskWorkspacesMock,
}));

vi.mock('./terminal-outcome.js', () => ({
  resolveCodexTerminalOutcome: resolveCodexTerminalOutcomeMock,
}));

vi.mock('./terminal-runtime.js', () => ({
  startTerminalProcess: startTerminalProcessMock,
}));

vi.mock('./user-install-env.js', () => ({
  buildTaskUserInstallEnv: buildTaskUserInstallEnvMock,
}));

function readSentFrames(socket: EventEmitter & { send: ReturnType<typeof vi.fn> }): Array<Record<string, unknown>> {
  return socket.send.mock.calls.map(([frame]) => JSON.parse(String(frame)) as Record<string, unknown>);
}

describe('notebook-codex-runner entry lifecycle', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    websocketInstances.length = 0;
    process.env.MBOS_AGENT_WS_URL = 'ws://127.0.0.1:12345';
    process.env.MBOS_AGENT_KEY = 'ask_test';
    process.env.MBOS_AGENT_RUNNER_DEBUG = '0';
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((() => undefined) as never));
  });

  afterEach(() => {
    exitSpy.mockRestore();
    delete process.env.MBOS_AGENT_WS_URL;
    delete process.env.MBOS_AGENT_KEY;
    delete process.env.MBOS_AGENT_RUNNER_DEBUG;
  });

  it('emits terminal error without started when terminal start rejects with invalid_shell', async () => {
    startTerminalProcessMock.mockRejectedValueOnce(new Error('invalid_shell'));

    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"agent.ready"'));

    socket.emit('message', Buffer.from(JSON.stringify({
      type: 'server.terminal.start',
      terminal_session_id: 'terminal_invalid_shell',
      timestamp: new Date().toISOString(),
      payload: {
        shell: '/definitely/not/a/shell',
        execution_context: {
          interaction_kind: 'notebook',
          task_id: 'task_1',
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          username: 'alice',
          api_base: 'http://127.0.0.1:20000/api/v1',
          execution_ticket: 'ticket_1',
        },
      },
    })));

    await vi.waitFor(() => {
      const frames = readSentFrames(socket);
      expect(frames.some((frame) => (
        frame.type === 'agent.terminal.error'
        && frame.terminal_session_id === 'terminal_invalid_shell'
        && typeof frame.payload === 'object'
        && frame.payload !== null
        && (frame.payload as { error_message?: unknown }).error_message === 'invalid_shell'
      ))).toBe(true);
    });

    const frames = readSentFrames(socket);
    expect(frames.some((frame) => (
      frame.type === 'agent.terminal.started'
      && frame.terminal_session_id === 'terminal_invalid_shell'
    ))).toBe(false);
  });

  it('terminates the runner and releases tracked workspaces when the websocket closes', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    const codexChild = new EventEmitter() as EventEmitter & {
      exitCode: number | null;
      stdout: EventEmitter & { on: typeof EventEmitter.prototype.on };
      stderr: EventEmitter & { on: typeof EventEmitter.prototype.on };
      kill: ReturnType<typeof vi.fn>;
    };
    codexChild.exitCode = null;
    codexChild.stdout = new EventEmitter() as typeof codexChild.stdout;
    codexChild.stderr = new EventEmitter() as typeof codexChild.stderr;
    codexChild.kill = vi.fn();
    spawnMock.mockReturnValue(codexChild);

    const terminalChild = {
      exitCode: null as number | null,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
    } satisfies MockTerminalChild;
    startTerminalProcessMock.mockResolvedValueOnce({
      child: terminalChild,
      cwd: '/workspace/task_1',
    });

    socket.emit('open');
    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"agent.ready"'));

    socket.emit('message', Buffer.from(JSON.stringify({
      type: 'server.hello',
      timestamp: new Date().toISOString(),
      payload: {
        resource_proxy: {
          base_url: 'http://127.0.0.1:20000/api/v1',
        },
      },
    })));

    socket.emit('message', Buffer.from(JSON.stringify({
      type: 'server.request.start',
      request_id: 'req_disconnect_test',
      timestamp: new Date().toISOString(),
      payload: {
        messages: [
          { role: 'user', content: 'please keep running' },
        ],
        execution_context: {
          interaction_kind: 'notebook',
          task_id: 'task_1',
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          username: 'alice',
          api_base: 'http://127.0.0.1:20000/api/v1',
          execution_ticket: 'ticket_1',
        },
      },
    })));

    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalled();
    });

    socket.emit('message', Buffer.from(JSON.stringify({
      type: 'server.terminal.start',
      terminal_session_id: 'terminal_1',
      timestamp: new Date().toISOString(),
      payload: {
        execution_context: {
          interaction_kind: 'notebook',
          task_id: 'task_1',
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          username: 'alice',
          api_base: 'http://127.0.0.1:20000/api/v1',
          execution_ticket: 'ticket_1',
        },
      },
    })));

    await vi.waitFor(() => {
      expect(startTerminalProcessMock).toHaveBeenCalled();
    });

    socket.emit('close');

    await vi.waitFor(() => {
      expect(codexChild.kill).toHaveBeenCalledWith('SIGTERM');
    });
    await vi.waitFor(() => {
      expect(terminalChild.kill).toHaveBeenCalledWith('SIGTERM');
    });
    await vi.waitFor(() => {
      expect(releaseAllPreparedTaskWorkspacesMock).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  it('emits a terminal error frame immediately when terminal startup rejects', async () => {
    startTerminalProcessMock.mockRejectedValueOnce(new Error('invalid_shell'));

    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    socket.emit('message', Buffer.from(JSON.stringify({
      type: 'server.terminal.start',
      terminal_session_id: 'terminal_1',
      timestamp: new Date().toISOString(),
      payload: {
        shell: '/definitely/not/a/real/shell',
        execution_context: {
          interaction_kind: 'notebook',
          task_id: 'task_1',
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          username: 'alice',
          api_base: 'http://127.0.0.1:20000/api/v1',
          execution_ticket: 'ticket_1',
        },
      },
    })));

    await vi.waitFor(() => {
      expect(startTerminalProcessMock).toHaveBeenCalledWith(expect.objectContaining({
        shell: '/definitely/not/a/real/shell',
      }));
    });

    await vi.waitFor(() => {
      const sentFrames = socket.send.mock.calls.map(([message]) => JSON.parse(message as string) as {
        type?: string;
        terminal_session_id?: string;
        payload?: {
          terminal_session_id?: string;
          error_code?: string;
          error_message?: string;
        };
      });
      expect(sentFrames).toContainEqual(expect.objectContaining({
        type: 'agent.terminal.error',
        terminal_session_id: 'terminal_1',
        payload: expect.objectContaining({
          terminal_session_id: 'terminal_1',
          error_code: 'AGENT_UPSTREAM_ERROR',
          error_message: 'invalid_shell',
        }),
      }));
      expect(sentFrames).not.toContainEqual(expect.objectContaining({
        type: 'agent.terminal.started',
        terminal_session_id: 'terminal_1',
      }));
    });
  });
});
