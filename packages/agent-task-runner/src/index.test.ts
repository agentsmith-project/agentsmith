import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockTerminalChild = {
  exitCode: number | null;
  pidMetadata: {
    ptyPid: number | null;
    rootPid: number | null;
    pgid: number | null;
    sid: number | null;
    platform: NodeJS.Platform;
    diagnostics: string[];
  };
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  onExit: ReturnType<typeof vi.fn>;
  waitForWorkspaceRelease: ReturnType<typeof vi.fn>;
};

type MockTerminalProcessResult = {
  child: MockTerminalChild;
  cwd: string;
};

type MockCodexChild = EventEmitter & {
  exitCode: number | null;
  stdout: EventEmitter & { on: typeof EventEmitter.prototype.on };
  stderr: EventEmitter & { on: typeof EventEmitter.prototype.on };
  kill: ReturnType<typeof vi.fn>;
};

type TerminalExitEvent = { exitCode: number | null; signal?: string | null };
type ProcessSignalListener = (signal: NodeJS.Signals) => void;
type MockWebSocket = EventEmitter & {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  readyState?: number;
};

const TASK_HOME = '/home/task_1';
const TASK_WORKSPACE = `${TASK_HOME}/workspace`;
const TASK_ARTIFACTS = `${TASK_WORKSPACE}/.artifacts`;
const LIBRARY_ROOT_PATH = '.';
const TASK_FILE_LIBRARY_ID = 'flib_1';
const TASK_HOME_SEGMENT = 'task_1';

const {
  assertTaskExecutionContextMock,
  buildCodexExecArgsMock,
  buildTaskCodexConfigMock,
  buildTaskCodexModelCatalogMock,
  buildTaskHeadlessPreambleMock,
  buildTaskUserInstallEnvMock,
  diffWorkspaceFileSnapshotsMock,
  ensureCodexSessionStateCompatibleMock,
  filterNewArtifactsForRunMock,
  inspectBuiltinSkillsMock,
  markCodexSessionStateReusableMock,
  mkdirMock,
  prepareLaunchCommandMock,
  prepareTaskWorkspaceAssetsMock,
  prepareTaskWorkspaceMock,
  releaseTaskWorkspaceMock,
  releaseAllPreparedTaskWorkspacesMock,
  resolveBuiltinSkillsConfigMock,
  resolveCodexTerminalOutcomeMock,
  resolveModelAutoCompactTokenLimitMock,
  resolveRunnerSuccessPolicyMock,
  scanArtifactsDirectoryMock,
  scanWorkspaceFilesSnapshotMock,
  selectLatestInstructionMock,
  seedBuiltinSkillsMock,
  sanitizeAgentDeltaChunkMock,
  sanitizeStderrChunkMock,
  startTerminalProcessMock,
  terminateTerminalProcessTreeMock,
  spawnMock,
  websocketInstances,
  WebSocketMock,
  writeFileMock,
} = vi.hoisted(() => {
  const websocketInstances: MockWebSocket[] = [];
  const WebSocketMock = vi.fn(function WebSocketMock(this: unknown) {
    const socket = new EventEmitter() as MockWebSocket;
    socket.readyState = 1;
    socket.send = vi.fn();
    socket.close = vi.fn(() => {
      socket.readyState = 3;
      socket.emit('close');
    });
    websocketInstances.push(socket);
    return socket;
  });
  Object.assign(WebSocketMock, {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
  });
  const releaseTaskWorkspaceMock = vi.fn(async () => undefined);
  const scrubTaskUserControlEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
    const scrubbed = { ...env };
    delete scrubbed.MBOS_AGENT_WS_URL;
    delete scrubbed.MBOS_AGENT_KEY;
    delete scrubbed.AGENT_WS_URL;
    delete scrubbed.AGENT_KEY;
    return scrubbed;
  };
  return {
    assertTaskExecutionContextMock: vi.fn((value: unknown) => value),
    buildCodexExecArgsMock: vi.fn(() => ['--exec']),
    buildTaskCodexConfigMock: vi.fn(() => 'task-config'),
    buildTaskCodexModelCatalogMock: vi.fn(() => 'model-catalog'),
    buildTaskHeadlessPreambleMock: vi.fn(() => 'PREAMBLE'),
    buildTaskUserInstallEnvMock: vi.fn((homeDir: string, env: NodeJS.ProcessEnv) => ({
      ...scrubTaskUserControlEnv(env),
      HOME: homeDir,
      TASK_HOME: homeDir,
    })),
    diffWorkspaceFileSnapshotsMock: vi.fn(() => ({ added: [], modified: [], deleted: [] })),
    ensureCodexSessionStateCompatibleMock: vi.fn(async (): Promise<{
      resetPerformed: boolean;
      reason: 'missing' | 'unchanged' | 'changed';
      resumeAllowed: boolean;
    }> => ({
      resetPerformed: false,
      reason: 'missing' as const,
      resumeAllowed: false,
    })),
    filterNewArtifactsForRunMock: vi.fn(() => []),
    inspectBuiltinSkillsMock: vi.fn(async () => ({
      sourceDir: '/seed-skills',
      available: [],
      missing: [],
    })),
    markCodexSessionStateReusableMock: vi.fn(async () => undefined),
    mkdirMock: vi.fn(async () => undefined),
    prepareLaunchCommandMock: vi.fn(async (input: { file: string; args: string[]; env: NodeJS.ProcessEnv }) => ({
      file: input.file,
      args: input.args,
      env: input.env,
    })),
    prepareTaskWorkspaceAssetsMock: vi.fn(async () => ({ artifactsDir: '/home/task_1/workspace/.artifacts' })),
    prepareTaskWorkspaceMock: vi.fn(async () => ({
      cwd: '/home/task_1/workspace',
      source: 'file_library_mount' as const,
      paths: {
        mode: 'managed_local' as const,
        taskHome: '/home/task_1',
        visibleRoot: '/home/task_1/workspace',
        libraryRoot: LIBRARY_ROOT_PATH,
        mountRoot: '/home/task_1',
        taskRoot: '/home/task_1',
        runtimeRoot: '/home/task_1',
        homeDir: '/home/task_1',
        workspaceDir: '/home/task_1/workspace',
        codexDir: '/home/task_1/.codex',
        artifactsDir: '/home/task_1/workspace/.artifacts',
        mbosDir: '/home/task_1/.mbos',
        skillsDir: '/home/task_1/.agents/skills',
      },
      release: releaseTaskWorkspaceMock,
    })),
    releaseTaskWorkspaceMock,
    releaseAllPreparedTaskWorkspacesMock: vi.fn(async () => undefined),
    resolveBuiltinSkillsConfigMock: vi.fn(() => ({
      sourceDir: '/seed-skills',
      required: false,
      skills: [],
    })),
    resolveCodexTerminalOutcomeMock: vi.fn((): {
      finalStatus: 'success' | 'error' | 'cancelled';
      codexTraceStatus: 'success' | 'error' | 'cancelled';
      errorCode: 'AGENT_CANCELLED' | 'AGENT_UPSTREAM_ERROR' | null;
      errorMessage: string | null;
    } => ({
      finalStatus: 'success' as const,
      codexTraceStatus: 'success' as const,
      errorCode: null,
      errorMessage: null,
    })),
    resolveModelAutoCompactTokenLimitMock: vi.fn((input: {
      modelContextWindow?: number;
      modelMaxOutputTokens?: number;
      modelAutoCompactTokenLimit?: number;
    }) => {
      const positiveInteger = (value: number | undefined): number | undefined => (
        typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
      );
      const modelContextWindow = positiveInteger(input.modelContextWindow);
      const modelMaxOutputTokens = positiveInteger(input.modelMaxOutputTokens);
      const explicitCompactLimit = positiveInteger(input.modelAutoCompactTokenLimit);
      const derivedCompactLimit = modelContextWindow !== undefined && modelMaxOutputTokens !== undefined
        ? Math.max(1, modelContextWindow - modelMaxOutputTokens)
        : undefined;
      if (
        explicitCompactLimit !== undefined
        && (derivedCompactLimit === undefined || explicitCompactLimit === derivedCompactLimit)
      ) {
        return explicitCompactLimit;
      }
      return derivedCompactLimit ?? explicitCompactLimit;
    }),
    resolveRunnerSuccessPolicyMock: vi.fn((input?: { visibleAgentChars?: number }) => (
      input?.visibleAgentChars === -1
        ? {
          ok: false as const,
          errorCode: 'AGENT_EMPTY_OUTPUT' as const,
          errorMessage: 'agent_empty_output',
        }
        : { ok: true as const }
    )),
    scanArtifactsDirectoryMock: vi.fn(async () => []),
    scanWorkspaceFilesSnapshotMock: vi.fn(async () => undefined),
    selectLatestInstructionMock: vi.fn(() => 'latest user instruction'),
    seedBuiltinSkillsMock: vi.fn(async () => ({
      targetDir: '/home/task_1/.agents/skills',
      seeded: [],
      manifestPath: '/home/task_1/.mbos/builtin-skills-manifest.json',
    })),
    sanitizeAgentDeltaChunkMock: vi.fn((chunk: string) => chunk),
    sanitizeStderrChunkMock: vi.fn((chunk: string) => chunk),
    startTerminalProcessMock: vi.fn(async (): Promise<MockTerminalProcessResult> => ({
      child: {
        exitCode: null as number | null,
        pidMetadata: {
          ptyPid: 12_001,
          rootPid: 12_001,
          pgid: 12_001,
          sid: 12_001,
          platform: 'linux' as NodeJS.Platform,
          diagnostics: [],
        },
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
        onData: vi.fn(),
        onExit: vi.fn(),
        waitForWorkspaceRelease: vi.fn(async () => undefined),
      },
      cwd: '/home/task_1/workspace',
    })),
    terminateTerminalProcessTreeMock: vi.fn(),
    spawnMock: vi.fn(),
    websocketInstances,
    WebSocketMock,
    writeFileMock: vi.fn(async () => undefined),
  };
});

vi.mock('ws', () => ({
  WebSocket: WebSocketMock,
}));

vi.mock('@mbos/agent-runner-contract', () => ({
  assertTaskExecutionContext: assertTaskExecutionContextMock,
  AGENT_TASK_RUNNER_SPEC: {
    app_family: 'agent_task_runner',
    protocol_version: '1.0',
    context_model: 'task',
    workspace_policy: 'persistent_task_workspace',
    supports_terminal: true,
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
  resolveModelAutoCompactTokenLimit: resolveModelAutoCompactTokenLimitMock,
}));

vi.mock('./codex-output-filter.js', () => ({
  sanitizeAgentDeltaChunk: sanitizeAgentDeltaChunkMock,
  sanitizeStderrChunk: sanitizeStderrChunkMock,
}));

vi.mock('./task-assets.js', () => ({
  buildTaskHeadlessPreamble: buildTaskHeadlessPreambleMock,
  prepareTaskWorkspaceAssets: prepareTaskWorkspaceAssetsMock,
}));

vi.mock('./prompt-selection.js', () => ({
  selectLatestInstruction: selectLatestInstructionMock,
}));

vi.mock('./run-result-policy.js', () => ({
  resolveRunnerSuccessPolicy: resolveRunnerSuccessPolicyMock,
}));

vi.mock('./session-state.js', () => ({
  ensureCodexSessionStateCompatible: ensureCodexSessionStateCompatibleMock,
  markCodexSessionStateReusable: markCodexSessionStateReusableMock,
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
  terminateTerminalProcessTree: terminateTerminalProcessTreeMock,
}));

vi.mock('./user-install-env.js', () => ({
  buildTaskUserInstallEnv: buildTaskUserInstallEnvMock,
}));

function readSentFrames(socket: EventEmitter & { send: ReturnType<typeof vi.fn> }): Array<Record<string, unknown>> {
  return socket.send.mock.calls.map(([frame]) => JSON.parse(String(frame)) as Record<string, unknown>);
}

describe('agent-task-runner entry lifecycle', () => {
  const originalAgentWsUrlAlias = process.env.AGENT_WS_URL;
  const originalAgentKeyAlias = process.env.AGENT_KEY;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let baselineSigintListeners: ProcessSignalListener[];
  let baselineSigtermListeners: ProcessSignalListener[];

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    websocketInstances.length = 0;
    baselineSigintListeners = process.listeners('SIGINT') as ProcessSignalListener[];
    baselineSigtermListeners = process.listeners('SIGTERM') as ProcessSignalListener[];
    process.env.MBOS_AGENT_WS_URL = 'ws://127.0.0.1:12345';
    process.env.MBOS_AGENT_KEY = 'ask_test';
    process.env.AGENT_WS_URL = 'ws://127.0.0.1:12345/alias';
    process.env.AGENT_KEY = 'ask_alias_test';
    process.env.MBOS_AGENT_RUNNER_DEBUG = '0';
    resolveRunnerSuccessPolicyMock.mockImplementation(() => ({ ok: true as const }));
    terminateTerminalProcessTreeMock.mockImplementation(async (
      child: MockTerminalChild,
      options: { graceMs?: number; hardKillGraceMs?: number } = {},
    ) => {
      const signalSequence: string[] = [];
      let exitObserved = child.exitCode !== null;
      const killTerminal = child.kill as unknown as (signal: NodeJS.Signals) => void;
      const onTerminalExit = child.onExit as unknown as (listener: (event: TerminalExitEvent) => void) => void;
      const waitForExit = () => {
        if (child.exitCode !== null) return Promise.resolve(true);
        return new Promise<boolean>((resolve) => {
          let timeout: ReturnType<typeof setTimeout> | null = null;
          const finish = () => {
            if (timeout) clearTimeout(timeout);
            exitObserved = true;
            resolve(true);
          };
          onTerminalExit(finish);
          timeout = setTimeout(() => resolve(false), options.graceMs ?? 8_000);
        });
      };
      killTerminal('SIGTERM');
      signalSequence.push('pty:SIGTERM');
      if (!(await waitForExit()) && child.exitCode === null) {
        killTerminal('SIGKILL');
        signalSequence.push('pty:SIGKILL');
      }
      if (!exitObserved && child.exitCode === null) {
        await new Promise((resolve) => {
          setTimeout(resolve, options.hardKillGraceMs ?? options.graceMs ?? 8_000);
        });
      }
      const outcome = !exitObserved && child.exitCode === null ? 'failed' : 'terminated';
      return {
        outcome,
        rootPid: child.pidMetadata.rootPid,
        ptyPid: child.pidMetadata.ptyPid,
        pgid: child.pidMetadata.pgid,
        sid: child.pidMetadata.sid,
        terminatedPids: outcome === 'terminated' && child.pidMetadata.rootPid !== null ? [child.pidMetadata.rootPid] : [],
        remainingPids: outcome === 'failed' && child.pidMetadata.rootPid !== null ? [child.pidMetadata.rootPid] : [],
        signalSequence,
        durationMs: 1,
        diagnosticCode: outcome === 'failed' ? 'terminal_process_tree_remaining' : null,
        diagnostics: [],
      };
    });
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((() => undefined) as never));
  });

  afterEach(() => {
    for (const listener of process.listeners('SIGINT') as ProcessSignalListener[]) {
      if (!baselineSigintListeners.includes(listener)) {
        process.removeListener('SIGINT', listener);
      }
    }
    for (const listener of process.listeners('SIGTERM') as ProcessSignalListener[]) {
      if (!baselineSigtermListeners.includes(listener)) {
        process.removeListener('SIGTERM', listener);
      }
    }
    vi.useRealTimers();
    exitSpy.mockRestore();
    delete process.env.MBOS_AGENT_WS_URL;
    delete process.env.MBOS_AGENT_KEY;
    if (originalAgentWsUrlAlias === undefined) {
      delete process.env.AGENT_WS_URL;
    } else {
      process.env.AGENT_WS_URL = originalAgentWsUrlAlias;
    }
    if (originalAgentKeyAlias === undefined) {
      delete process.env.AGENT_KEY;
    } else {
      process.env.AGENT_KEY = originalAgentKeyAlias;
    }
    delete process.env.MBOS_AGENT_RUNNER_DEBUG;
    delete process.env.MBOS_AGENT_CANCEL_KILL_DELAY_MS;
    delete process.env.MBOS_AGENT_RECONNECT_BASE_MS;
    delete process.env.MBOS_AGENT_RECONNECT_MAX_MS;
    delete process.env.MBOS_AGENT_RUNNER_INSTANCE_ID;
    delete process.env.MBOS_AGENT_RUNNER_SESSION_ID;
    delete process.env.NOTEBOOK_TERMINAL_CLOSE_GRACE_MS;
  });

  function createCodexChild(): MockCodexChild {
    const child = new EventEmitter() as MockCodexChild;
    child.exitCode = null;
    child.stdout = new EventEmitter() as MockCodexChild['stdout'];
    child.stderr = new EventEmitter() as MockCodexChild['stderr'];
    child.kill = vi.fn((signal?: NodeJS.Signals) => {
      if (signal === 'SIGKILL') {
        child.exitCode = 137;
      }
      return true;
    });
    return child;
  }

  function closeCodexChild(child: MockCodexChild, code: number | null, signal: NodeJS.Signals | null = null): void {
    child.exitCode = code;
    child.emit('close', code, signal);
  }

  function createTerminalChild(exitListeners: Array<(event: TerminalExitEvent) => void> = []): MockTerminalChild {
    const terminalPid = 12_000 + startTerminalProcessMock.mock.calls.length + 1;
    const child: MockTerminalChild = {
      exitCode: null,
      pidMetadata: {
        ptyPid: terminalPid,
        rootPid: terminalPid,
        pgid: terminalPid,
        sid: terminalPid,
        platform: 'linux',
        diagnostics: [],
      },
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn((signal?: NodeJS.Signals) => {
        if (signal === 'SIGKILL') {
          child.exitCode = 137;
        }
      }),
      onData: vi.fn(),
      onExit: vi.fn((listener: (event: TerminalExitEvent) => void) => {
        exitListeners.push(listener);
      }),
      waitForWorkspaceRelease: vi.fn(async () => undefined),
    };
    return child;
  }

  function closeTerminalChild(
    child: MockTerminalChild,
    exitListeners: Array<(event: TerminalExitEvent) => void>,
    exitCode: number | null,
    signal: NodeJS.Signals | null = null,
  ): void {
    child.exitCode = exitCode;
    for (const listener of exitListeners) {
      listener({ exitCode, signal });
    }
  }

  function serverHello(resourceProxyBase: string | null = null): Buffer {
    return Buffer.from(JSON.stringify({
      type: 'server.hello',
      timestamp: new Date().toISOString(),
      payload: {
        ...(resourceProxyBase
          ? {
            resource_proxy: {
              base_url: resourceProxyBase,
            },
          }
          : {}),
      },
    }));
  }

  function serverRequestStart(
    requestId: string,
    executionContextOverrides: Record<string, unknown> = {},
    options: { includeResourceProxy?: boolean } = {},
  ): Buffer {
    const includeResourceProxy = options.includeResourceProxy !== false;
    return Buffer.from(JSON.stringify({
      type: 'server.request.start',
      request_id: requestId,
      timestamp: new Date().toISOString(),
      payload: {
        messages: [
          { role: 'user', content: 'please keep running' },
        ],
        execution_context: {
          task_id: 'task_1',
          workspace_file_library_id: TASK_FILE_LIBRARY_ID,
          workspace_binding_mode: 'file_library',
          runtime_profile: 'managed',
          task_home_segment: TASK_HOME_SEGMENT,
          task_home_path: TASK_HOME,
          workspace_path: TASK_WORKSPACE,
          artifacts_path: TASK_ARTIFACTS,
          library_root_path: LIBRARY_ROOT_PATH,
          run_id: 'run_1',
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          username: 'alice',
          api_base: 'http://127.0.0.1:20000/api/v1',
          execution_ticket: 'ticket_1',
          ...(includeResourceProxy
            ? {
              resource_proxy: {
                base_url: 'http://127.0.0.1:20000/api/v1/workspaces/ws_1/projects/proj_1/endpoints/ep_request/proxy/openai',
              },
            }
            : {}),
          ...executionContextOverrides,
        },
      },
    }));
  }

  function serverTerminalStart(
    terminalSessionId: string,
    options: {
      runnerSessionId?: string;
      generation?: number;
      cols?: number;
      rows?: number;
    } = {},
  ): Buffer {
    return Buffer.from(JSON.stringify({
      type: 'server.terminal.start',
      ...(options.runnerSessionId ? { runner_session_id: options.runnerSessionId } : {}),
      terminal_session_id: terminalSessionId,
      timestamp: new Date().toISOString(),
      payload: {
        ...(options.generation !== undefined ? { generation: options.generation } : {}),
        ...(options.cols !== undefined ? { cols: options.cols } : {}),
        ...(options.rows !== undefined ? { rows: options.rows } : {}),
        execution_context: {
          task_id: 'task_1',
          workspace_file_library_id: TASK_FILE_LIBRARY_ID,
          workspace_binding_mode: 'file_library',
          runtime_profile: 'managed',
          task_home_segment: TASK_HOME_SEGMENT,
          task_home_path: TASK_HOME,
          workspace_path: TASK_WORKSPACE,
          artifacts_path: TASK_ARTIFACTS,
          library_root_path: LIBRARY_ROOT_PATH,
          run_id: 'run_1',
          workspace_id: 'ws_1',
          project_id: 'proj_1',
          username: 'alice',
          api_base: 'http://127.0.0.1:20000/api/v1',
          execution_ticket: 'ticket_1',
        },
      },
    }));
  }

  function serverTerminalAdopt(
    terminalSessionId: string,
    options: {
      requestId?: string;
      runnerSessionId?: string;
      adoptAttemptId?: string;
      connectionEpoch?: number;
      generation?: number;
      cols?: number;
      rows?: number;
    } = {},
  ): Buffer {
    const requestId = options.requestId ?? 'adopt_1';
    return Buffer.from(JSON.stringify({
      type: 'server.terminal.adopt',
      request_id: requestId,
      runner_session_id: options.runnerSessionId ?? 'runner_session_1',
      terminal_session_id: terminalSessionId,
      timestamp: new Date().toISOString(),
      payload: {
        adopt_attempt_id: options.adoptAttemptId ?? requestId,
        connection_epoch: options.connectionEpoch ?? 7,
        generation: options.generation ?? 1,
        cols: options.cols ?? 120,
        rows: options.rows ?? 30,
      },
    }));
  }

  function serverTerminalClose(
    terminalSessionId: string,
    options: {
      requestId?: string;
      runnerSessionId?: string;
      closeAttemptId?: string;
      connectionEpoch?: number;
      generation?: number;
      reason?: string;
      includeConnectionEpoch?: boolean;
      includeGeneration?: boolean;
      includeRunnerSessionId?: boolean;
    } = {},
  ): Buffer {
    const requestId = options.requestId ?? 'close_1';
    const includeRunnerSessionId = options.includeRunnerSessionId !== false;
    const includeConnectionEpoch = options.includeConnectionEpoch !== false;
    const includeGeneration = options.includeGeneration !== false;
    return Buffer.from(JSON.stringify({
      type: 'server.terminal.close',
      request_id: requestId,
      ...(includeRunnerSessionId ? { runner_session_id: options.runnerSessionId ?? 'runner_session_1' } : {}),
      terminal_session_id: terminalSessionId,
      timestamp: new Date().toISOString(),
      payload: {
        close_attempt_id: options.closeAttemptId ?? requestId,
        ...(includeConnectionEpoch ? { connection_epoch: options.connectionEpoch ?? 7 } : {}),
        ...(includeGeneration ? { generation: options.generation ?? 1 } : {}),
        reason: options.reason ?? 'user_requested',
      },
    }));
  }

  async function startCodexRun(
    socket: EventEmitter & { send: ReturnType<typeof vi.fn> },
    requestId = 'req_disconnect_test',
    executionContextOverrides: Record<string, unknown> = {},
  ): Promise<MockCodexChild> {
    const expectedSpawnCount = spawnMock.mock.calls.length + 1;
    const child = createCodexChild();
    spawnMock.mockReturnValueOnce(child);
    socket.emit('message', serverHello());
    socket.emit('message', serverRequestStart(requestId, executionContextOverrides));
    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalledTimes(expectedSpawnCount);
    });
    return child;
  }

  it('uses request-scoped resource proxy when server.hello has no proxy', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const child = createCodexChild();
    spawnMock.mockReturnValueOnce(child);
    socket.emit('message', serverHello(null));
    socket.emit('message', serverRequestStart('req_request_proxy_no_hello', {
      resource_proxy: {
        base_url: 'http://fresh.example/api/v1/workspaces/ws_1/projects/proj_1/endpoints/ep_fresh/proxy/openai',
      },
    }));

    await vi.waitFor(() => {
      expect(buildTaskCodexConfigMock).toHaveBeenCalledWith(expect.objectContaining({
        endpointProxyBase: 'http://fresh.example/api/v1/workspaces/ws_1/projects/proj_1/endpoints/ep_fresh/proxy/openai',
      }));
      expect(buildCodexExecArgsMock).toHaveBeenCalledWith(expect.objectContaining({
        endpointProxyBase: 'http://fresh.example/api/v1/workspaces/ws_1/projects/proj_1/endpoints/ep_fresh/proxy/openai',
      }));
    });
    closeCodexChild(child, 0);
  });

  it('prefers fresh request resource proxy over stale server.hello proxy', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const child = createCodexChild();
    spawnMock.mockReturnValueOnce(child);
    socket.emit('message', serverHello('http://stale.example/api/v1/workspaces/ws_1/projects/proj_1/endpoints/ep_stale/proxy/openai'));
    socket.emit('message', serverRequestStart('req_request_proxy_over_stale_hello', {
      resource_proxy: {
        base_url: 'http://fresh.example/api/v1/workspaces/ws_1/projects/proj_1/endpoints/ep_fresh/proxy/openai',
      },
    }));

    await vi.waitFor(() => {
      expect(buildTaskCodexConfigMock).toHaveBeenCalledWith(expect.objectContaining({
        endpointProxyBase: 'http://fresh.example/api/v1/workspaces/ws_1/projects/proj_1/endpoints/ep_fresh/proxy/openai',
      }));
    });
    closeCodexChild(child, 0);
  });

  it('fails fast when request resource proxy is missing even if server.hello has a stale proxy', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    socket.emit('message', serverHello('http://stale.example/api/v1/workspaces/ws_1/projects/proj_1/endpoints/ep_stale/proxy/openai'));
    socket.emit('message', serverRequestStart('req_missing_request_proxy', {}, { includeResourceProxy: false }));

    await vi.waitFor(() => {
      const frames = readSentFrames(socket);
      expect(frames.some((frame) => (
        frame.type === 'agent.response.error'
        && frame.request_id === 'req_missing_request_proxy'
        && typeof frame.payload === 'object'
        && frame.payload !== null
        && (frame.payload as { error_message?: unknown }).error_message === 'resource_proxy_base_missing'
      ))).toBe(true);
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('releases the prepared task workspace when request setup fails before codex child spawn', async () => {
    prepareTaskWorkspaceAssetsMock.mockRejectedValueOnce(new Error('asset_prepare_failed'));

    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    socket.emit('message', serverHello());
    socket.emit('message', serverRequestStart('req_setup_failure_release'));

    await vi.waitFor(() => {
      const frames = readSentFrames(socket);
      expect(frames.some((frame) => (
        frame.type === 'agent.response.error'
        && frame.request_id === 'req_setup_failure_release'
        && typeof frame.payload === 'object'
        && frame.payload !== null
        && (frame.payload as { error_message?: unknown }).error_message === 'asset_prepare_failed'
      ))).toBe(true);
    });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(releaseTaskWorkspaceMock).toHaveBeenCalledTimes(1);
  });

  async function waitForCodexStdoutListener(child: MockCodexChild): Promise<void> {
    await vi.waitFor(() => {
      expect(child.stdout.listenerCount('data')).toBeGreaterThan(0);
    });
  }

  async function waitForCodexLifecycleListeners(child: MockCodexChild): Promise<void> {
    await vi.waitFor(() => {
      expect(child.listenerCount('error')).toBeGreaterThan(0);
      expect(child.listenerCount('close')).toBeGreaterThan(0);
    });
  }

  function codexStdoutLine(payload: Record<string, unknown>): string {
    return `${JSON.stringify(payload)}\n`;
  }

  function readAgentDeltas(
    socket: EventEmitter & { send: ReturnType<typeof vi.fn> },
    requestId: string,
  ): string[] {
    return readSentFrames(socket)
      .filter((frame) => frame.type === 'agent.response.delta' && frame.request_id === requestId)
      .map((frame) => {
        const payload = frame.payload as { delta?: unknown } | undefined;
        return typeof payload?.delta === 'string' ? payload.delta : '';
      })
      .filter((delta) => delta.length > 0);
  }

  function readAgentTraceEvents(
    socket: EventEmitter & { send: ReturnType<typeof vi.fn> },
    requestId: string,
  ): Array<Record<string, unknown>> {
    return readSentFrames(socket)
      .filter((frame) => frame.type === 'agent.response.event' && frame.request_id === requestId);
  }

  async function startTerminalRun(
    socket: MockWebSocket,
    terminalSessionId = 'terminal_1',
    options: {
      runnerSessionId?: string;
      generation?: number;
      cols?: number;
      rows?: number;
    } = {},
  ): Promise<{ child: MockTerminalChild; exitListeners: Array<(event: TerminalExitEvent) => void> }> {
    const exitListeners: Array<(event: TerminalExitEvent) => void> = [];
    const child = createTerminalChild(exitListeners);
    startTerminalProcessMock.mockResolvedValueOnce({
      child,
      cwd: TASK_WORKSPACE,
    });
    socket.emit('message', serverTerminalStart(terminalSessionId, options));
    await vi.waitFor(() => {
      expect(startTerminalProcessMock).toHaveBeenCalled();
    });
    return { child, exitListeners };
  }

  it('advertises stable runner instance and monotonically increasing connection epoch on every ready frame', async () => {
    vi.useFakeTimers();
    process.env.MBOS_AGENT_RECONNECT_BASE_MS = '10';
    process.env.MBOS_AGENT_RECONNECT_MAX_MS = '10';
    process.env.MBOS_AGENT_RUNNER_INSTANCE_ID = 'runner_instance_protocol';
    process.env.MBOS_AGENT_RUNNER_SESSION_ID = 'runner_session_protocol';

    await import('./index.js');
    const firstSocket = websocketInstances.at(-1);
    if (!firstSocket) {
      throw new Error('websocket_instance_missing');
    }

    firstSocket.emit('open');
    const firstReady = readSentFrames(firstSocket).find((frame) => frame.type === 'agent.ready');
    expect(firstReady).toMatchObject({
      payload: expect.objectContaining({
        runner_instance_id: 'runner_instance_protocol',
        connection_epoch: 1,
      }),
    });

    const terminal = await startTerminalRun(firstSocket, 'terminal_epoch_ready', {
      runnerSessionId: 'runner_session_protocol',
      generation: 2,
      cols: 90,
      rows: 25,
    });
    await vi.waitFor(() => {
      expect(readSentFrames(firstSocket)).toContainEqual(expect.objectContaining({
        type: 'agent.terminal.started',
        terminal_session_id: 'terminal_epoch_ready',
        payload: expect.objectContaining({
          runner_session_id: 'runner_session_protocol',
          generation: 2,
          connection_epoch: 1,
        }),
      }));
    });
    firstSocket.emit('close');
    expect(terminal.child.kill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10);
    const secondSocket = websocketInstances.at(-1);
    expect(secondSocket).toBeDefined();
    expect(secondSocket).not.toBe(firstSocket);
    secondSocket?.emit('open');

    const secondReady = readSentFrames(secondSocket!).find((frame) => frame.type === 'agent.ready');
    expect(secondReady).toMatchObject({
      payload: expect.objectContaining({
        runner_instance_id: 'runner_instance_protocol',
        connection_epoch: 2,
        active_terminals: [
          expect.objectContaining({
            terminal_session_id: 'terminal_epoch_ready',
            runner_session_id: 'runner_session_protocol',
            generation: 2,
            connection_epoch: 2,
          }),
        ],
      }),
    });

    secondSocket?.emit('message', serverTerminalAdopt('terminal_epoch_ready', {
      requestId: 'adopt_epoch_ready',
      runnerSessionId: 'runner_session_protocol',
      adoptAttemptId: 'adopt_epoch_ready',
      connectionEpoch: 2,
      generation: 2,
    }));

    await vi.waitFor(() => {
      expect(readSentFrames(secondSocket!)).toContainEqual(expect.objectContaining({
        type: 'agent.terminal.adopted',
        request_id: 'adopt_epoch_ready',
        terminal_session_id: 'terminal_epoch_ready',
        payload: expect.objectContaining({
          connection_epoch: 2,
          generation: 2,
        }),
      }));
    });
  });

  it('streams phase-less standard Responses output_text deltas as visible agent output', async () => {
    const requestId = 'req_standard_output_text_delta';
    resolveRunnerSuccessPolicyMock.mockImplementation((input?: { visibleAgentChars?: number }) => (
      (input?.visibleAgentChars ?? 0) > 0
        ? { ok: true as const }
        : {
          ok: false as const,
          errorCode: 'AGENT_EMPTY_OUTPUT' as const,
          errorMessage: 'agent_empty_output',
        }
    ));

    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const child = await startCodexRun(socket, requestId);
    await waitForCodexStdoutListener(child);

    child.stdout.emit('data', Buffer.from([
      codexStdoutLine({
        type: 'response.output_text.delta',
        delta: 'Standard ',
      }),
      codexStdoutLine({
        type: 'response.output_text.delta',
        delta: 'Responses output.',
      }),
    ].join('')));
    closeCodexChild(child, 0);

    let doneFrame: Record<string, unknown> | undefined;
    await vi.waitFor(() => {
      doneFrame = readSentFrames(socket).find((frame) => (
        frame.type === 'agent.response.done'
        && frame.request_id === requestId
      ));
      expect(doneFrame).toBeDefined();
    });
    expect(doneFrame?.payload).toMatchObject({ finish_reason: 'stop' });
    expect(doneFrame?.payload).not.toHaveProperty('usage_tokens');

    expect(readAgentDeltas(socket, requestId)).toEqual(['Standard ', 'Responses output.']);
    expect(resolveRunnerSuccessPolicyMock).toHaveBeenCalledWith(expect.objectContaining({
      visibleAgentChars: 'Standard Responses output.'.length,
    }));
    expect(readSentFrames(socket).some((frame) => (
      frame.type === 'agent.response.error'
      && frame.request_id === requestId
      && typeof frame.payload === 'object'
      && frame.payload !== null
      && (frame.payload as { error_code?: unknown }).error_code === 'AGENT_EMPTY_OUTPUT'
    ))).toBe(false);
  });

  it('emits phase-less standard Responses output_text done text once when no deltas arrived', async () => {
    const requestId = 'req_standard_output_text_done_only';
    const finalText = 'Final text from standard Responses done.';

    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const child = await startCodexRun(socket, requestId);
    await waitForCodexStdoutListener(child);

    child.stdout.emit('data', Buffer.from([
      codexStdoutLine({
        type: 'response.output_text.done',
        text: finalText,
      }),
      codexStdoutLine({
        type: 'response.output_text.done',
        text: finalText,
      }),
    ].join('')));
    closeCodexChild(child, 0);

    await vi.waitFor(() => {
      expect(readSentFrames(socket).some((frame) => (
        frame.type === 'agent.response.done'
        && frame.request_id === requestId
      ))).toBe(true);
    });

    expect(readAgentDeltas(socket, requestId)).toEqual([finalText]);
  });

  it('does not duplicate output when phase-less standard Responses deltas are followed by done full text', async () => {
    const requestId = 'req_standard_output_text_delta_then_done';

    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const child = await startCodexRun(socket, requestId);
    await waitForCodexStdoutListener(child);

    child.stdout.emit('data', Buffer.from([
      codexStdoutLine({
        type: 'response.output_text.delta',
        delta: 'Delta ',
      }),
      codexStdoutLine({
        type: 'response.output_text.delta',
        delta: 'then done.',
      }),
      codexStdoutLine({
        type: 'response.output_text.done',
        text: 'Delta then done.',
      }),
    ].join('')));
    closeCodexChild(child, 0);

    await vi.waitFor(() => {
      expect(readSentFrames(socket).some((frame) => (
        frame.type === 'agent.response.done'
        && frame.request_id === requestId
      ))).toBe(true);
    });

    expect(readAgentDeltas(socket, requestId)).toEqual(['Delta ', 'then done.']);
  });

  it('redacts function_call apply_patch arguments from codex tool details and raw trace frames', async () => {
    const requestId = 'req_trace_apply_patch_redacted';
    const patchArguments = [
      'Tool call partial arguments',
      '*** Begin Patch',
      '*** Update File: secret.ts',
      '+leaked patch body should not appear',
      '*** End Patch',
    ].join('\n');

    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const child = await startCodexRun(socket, requestId);
    await waitForCodexStdoutListener(child);

    child.stdout.emit('data', Buffer.from([
      codexStdoutLine({
        type: 'item.started',
        item: {
          type: 'function_call',
          name: 'apply_patch',
          call_id: 'call_apply_patch_1',
          arguments: patchArguments,
        },
      }),
      codexStdoutLine({
        type: 'item.updated',
        item: {
          type: 'function_call',
          name: 'apply_patch',
          call_id: 'call_apply_patch_1',
          arguments: patchArguments,
        },
      }),
      codexStdoutLine({
        type: 'item.completed',
        item: {
          type: 'function_call',
          name: 'apply_patch',
          call_id: 'call_apply_patch_1',
          arguments: patchArguments,
        },
      }),
    ].join('')));
    closeCodexChild(child, 0);

    await vi.waitFor(() => {
      expect(readSentFrames(socket).some((frame) => (
        frame.type === 'agent.response.done'
        && frame.request_id === requestId
      ))).toBe(true);
    });

    const traceEvents = readAgentTraceEvents(socket, requestId);
    const toolEvents = traceEvents.filter((frame) => {
      const payload = frame.payload as { name?: unknown } | undefined;
      return payload?.name === 'codex.tool';
    });
    expect(toolEvents).toHaveLength(3);
    for (const frame of toolEvents) {
      const payload = frame.payload as { details?: Record<string, unknown> } | undefined;
      expect(payload?.details).toEqual({
        tool_name: 'apply_patch',
        call_id: 'call_apply_patch_1',
        arguments_present: true,
        arguments_bytes: Buffer.byteLength(patchArguments, 'utf-8'),
        arguments_redacted: true,
      });
      expect(payload?.details).not.toHaveProperty('arguments');
    }

    const serializedTrace = JSON.stringify(traceEvents);
    expect(serializedTrace).not.toContain('*** Begin Patch');
    expect(serializedTrace).not.toContain('partial arguments');
    expect(serializedTrace).not.toContain('leaked patch body should not appear');
  });

  it('keeps command_execution summaries free of full command secrets while preserving details.command', async () => {
    const requestId = 'req_command_summary_redacted';
    const commandSecret = 'runner-command-summary-secret';
    const command = `curl -H "Authorization: Basic ${commandSecret}" https://api.example.test/v1/tasks`;

    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const child = await startCodexRun(socket, requestId);
    await waitForCodexStdoutListener(child);

    child.stdout.emit('data', Buffer.from([
      codexStdoutLine({
        type: 'item.started',
        item: {
          type: 'command_execution',
          command,
        },
      }),
      codexStdoutLine({
        type: 'item.completed',
        item: {
          type: 'command_execution',
          command,
          exit_code: 0,
        },
      }),
    ].join('')));
    closeCodexChild(child, 0);

    await vi.waitFor(() => {
      expect(readSentFrames(socket).some((frame) => (
        frame.type === 'agent.response.done'
        && frame.request_id === requestId
      ))).toBe(true);
    });

    const commandEvents = readAgentTraceEvents(socket, requestId).filter((frame) => {
      const payload = frame.payload as { name?: unknown } | undefined;
      return payload?.name === 'codex.command';
    });
    expect(commandEvents).toHaveLength(2);
    for (const frame of commandEvents) {
      const payload = frame.payload as { summary?: unknown; details?: Record<string, unknown> } | undefined;
      expect(payload?.summary).not.toContain(command);
      expect(payload?.summary).not.toContain(commandSecret);
      expect(payload?.details?.command).toBe(command);
    }
  });

  it('emits one clean final answer delta from Codex final-answer surfaces and ignores phase-null contamination', async () => {
    const cleanFinalAnswer = 'Clean final task answer.';
    const contaminatedMessage = [
      'partial arguments for a tool call',
      '*** Begin Patch',
      '*** Update File: src/example.ts',
    ].join('\n');

    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const child = await startCodexRun(socket, 'req_clean_final_once');
    await waitForCodexStdoutListener(child);

    child.stdout.emit('data', Buffer.from([
      codexStdoutLine({
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          phase: null,
          message: contaminatedMessage,
        },
      }),
      codexStdoutLine({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: null,
          content: [{ type: 'output_text', text: contaminatedMessage }],
        },
      }),
      codexStdoutLine({
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          phase: 'final_answer',
          message: cleanFinalAnswer,
        },
      }),
      codexStdoutLine({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: cleanFinalAnswer }],
        },
      }),
      codexStdoutLine({
        type: 'event_msg',
        payload: {
          type: 'task_complete',
          last_agent_message: cleanFinalAnswer,
        },
      }),
    ].join('')));
    closeCodexChild(child, 0);

    await vi.waitFor(() => {
      const frames = readSentFrames(socket);
      expect(frames.some((frame) => frame.type === 'agent.response.done' && frame.request_id === 'req_clean_final_once')).toBe(true);
    });

    const deltas = readAgentDeltas(socket, 'req_clean_final_once');
    expect(deltas).toEqual([cleanFinalAnswer]);
    expect(deltas.join('\n')).not.toContain('partial arguments');
    expect(deltas.join('\n')).not.toContain('*** Begin Patch');
  });

  it('emits final answers across sequential runs that reuse the same request id after cleanup', async () => {
    const requestId = 'req_reused_after_cleanup';
    const firstAnswer = 'First final answer.';
    const secondAnswer = 'Second final answer.';

    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const firstChild = await startCodexRun(socket, requestId);
    await waitForCodexStdoutListener(firstChild);
    firstChild.stdout.emit('data', Buffer.from(codexStdoutLine({
      type: 'event_msg',
      payload: {
        type: 'agent_message',
        phase: 'final_answer',
        message: firstAnswer,
      },
    })));
    closeCodexChild(firstChild, 0);

    await vi.waitFor(() => {
      const doneFrames = readSentFrames(socket)
        .filter((frame) => frame.type === 'agent.response.done' && frame.request_id === requestId);
      expect(doneFrames).toHaveLength(1);
    });

    const secondChild = await startCodexRun(socket, requestId);
    await waitForCodexStdoutListener(secondChild);
    secondChild.stdout.emit('data', Buffer.from(codexStdoutLine({
      type: 'event_msg',
      payload: {
        type: 'agent_message',
        phase: 'final_answer',
        message: secondAnswer,
      },
    })));
    closeCodexChild(secondChild, 0);

    await vi.waitFor(() => {
      const doneFrames = readSentFrames(socket)
        .filter((frame) => frame.type === 'agent.response.done' && frame.request_id === requestId);
      expect(doneFrames).toHaveLength(2);
    });

    expect(readAgentDeltas(socket, requestId)).toEqual([firstAnswer, secondAnswer]);
  });

  it('uses nested event_msg task_complete last_agent_message as final fallback after phase-null messages', async () => {
    const cleanFinalAnswer = 'Fallback final answer from task_complete.';

    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const child = await startCodexRun(socket, 'req_task_complete_fallback');
    await waitForCodexStdoutListener(child);

    child.stdout.emit('data', Buffer.from([
      codexStdoutLine({
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          phase: null,
          message: 'partial arguments\n*** Begin Patch',
        },
      }),
      codexStdoutLine({
        type: 'event_msg',
        payload: {
          type: 'task_complete',
          last_agent_message: cleanFinalAnswer,
        },
      }),
    ].join('')));
    closeCodexChild(child, 0);

    await vi.waitFor(() => {
      const frames = readSentFrames(socket);
      expect(frames.some((frame) => frame.type === 'agent.response.done' && frame.request_id === 'req_task_complete_fallback')).toBe(true);
    });

    expect(readAgentDeltas(socket, 'req_task_complete_fallback')).toEqual([cleanFinalAnswer]);
  });

  it('releases a clean phase-null assistant candidate once on successful Codex close', async () => {
    const cleanFinalAnswer = 'Phase-null provider final answer.';
    resolveRunnerSuccessPolicyMock.mockImplementation((input?: { visibleAgentChars?: number }) => (
      (input?.visibleAgentChars ?? 0) > 0
        ? { ok: true as const }
        : {
          ok: false as const,
          errorCode: 'AGENT_EMPTY_OUTPUT' as const,
          errorMessage: 'agent_empty_output',
        }
    ));

    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const child = await startCodexRun(socket, 'req_phase_null_candidate_close');
    await waitForCodexStdoutListener(child);

    child.stdout.emit('data', Buffer.from(codexStdoutLine({
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        phase: null,
        content: [{ type: 'output_text', text: cleanFinalAnswer }],
      },
    })));

    expect(readAgentDeltas(socket, 'req_phase_null_candidate_close')).toEqual([]);
    closeCodexChild(child, 0);

    await vi.waitFor(() => {
      const frames = readSentFrames(socket);
      expect(frames.some((frame) => (
        frame.type === 'agent.response.done'
        && frame.request_id === 'req_phase_null_candidate_close'
      ))).toBe(true);
    });

    expect(readAgentDeltas(socket, 'req_phase_null_candidate_close')).toEqual([cleanFinalAnswer]);
    expect(resolveRunnerSuccessPolicyMock).toHaveBeenCalledWith(expect.objectContaining({
      visibleAgentChars: cleanFinalAnswer.length,
    }));
    expect(readSentFrames(socket).some((frame) => (
      frame.type === 'agent.response.error'
      && frame.request_id === 'req_phase_null_candidate_close'
      && typeof frame.payload === 'object'
      && frame.payload !== null
      && (frame.payload as { error_code?: unknown }).error_code === 'AGENT_EMPTY_OUTPUT'
    ))).toBe(false);
  });

  it('keeps phase-null bare patch markers out of the final answer candidate without tool argument text', async () => {
    const requestId = 'req_phase_null_bare_patch_markers';
    resolveRunnerSuccessPolicyMock.mockImplementation((input?: { visibleAgentChars?: number }) => (
      (input?.visibleAgentChars ?? 0) > 0
        ? { ok: true as const }
        : {
          ok: false as const,
          errorCode: 'AGENT_EMPTY_OUTPUT' as const,
          errorMessage: 'agent_empty_output',
        }
    ));

    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const child = await startCodexRun(socket, requestId);
    await waitForCodexStdoutListener(child);

    child.stdout.emit('data', Buffer.from(codexStdoutLine({
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        phase: null,
        content: [{
          type: 'output_text',
          text: [
            '*** Begin Patch',
            '*** Update File: src/example.ts',
            '+export const value = true;',
            '*** End Patch',
          ].join('\n'),
        }],
      },
    })));

    expect(readAgentDeltas(socket, requestId)).toEqual([]);
    closeCodexChild(child, 0);

    await vi.waitFor(() => {
      const frames = readSentFrames(socket);
      expect(frames.some((frame) => (
        frame.type === 'agent.response.error'
        && frame.request_id === requestId
        && typeof frame.payload === 'object'
        && frame.payload !== null
        && (frame.payload as { error_code?: unknown }).error_code === 'AGENT_EMPTY_OUTPUT'
      ))).toBe(true);
    });

    expect(readAgentDeltas(socket, requestId)).toEqual([]);
    expect(readSentFrames(socket).some((frame) => (
      frame.type === 'agent.response.done'
      && frame.request_id === requestId
    ))).toBe(false);
  });

  it('keeps phase-null colon-ended patch marker fragments out of final answer candidates', async () => {
    const markerFragments = [
      ['update', '*** Update File: src/example.ts'],
      ['add', '*** Add File: a.ts'],
      ['delete', '*** Delete File: a.ts'],
      ['move', '*** Move to: b.ts'],
    ] as const;
    resolveRunnerSuccessPolicyMock.mockImplementation((input?: { visibleAgentChars?: number }) => (
      (input?.visibleAgentChars ?? 0) > 0
        ? { ok: true as const }
        : {
          ok: false as const,
          errorCode: 'AGENT_EMPTY_OUTPUT' as const,
          errorMessage: 'agent_empty_output',
        }
    ));

    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');

    for (const [name, marker] of markerFragments) {
      const requestId = `req_phase_null_colon_patch_${name}`;
      const child = await startCodexRun(socket, requestId);
      await waitForCodexStdoutListener(child);

      child.stdout.emit('data', Buffer.from(codexStdoutLine({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: null,
          content: [{ type: 'output_text', text: marker }],
        },
      })));

      expect(readAgentDeltas(socket, requestId)).toEqual([]);
      closeCodexChild(child, 0);

      await vi.waitFor(() => {
        const frames = readSentFrames(socket);
        expect(frames.some((frame) => (
          frame.type === 'agent.response.error'
          && frame.request_id === requestId
          && typeof frame.payload === 'object'
          && frame.payload !== null
          && (frame.payload as { error_code?: unknown }).error_code === 'AGENT_EMPTY_OUTPUT'
        ))).toBe(true);
      });

      expect(readAgentDeltas(socket, requestId)).toEqual([]);
      expect(readSentFrames(socket).some((frame) => (
        frame.type === 'agent.response.done'
        && frame.request_id === requestId
      ))).toBe(false);
    }
  });

  it('allows clean phase-null final answers that mention apply_patch as plain text', async () => {
    const requestId = 'req_phase_null_plain_apply_patch';
    const cleanFinalAnswer = 'I used apply_patch to update the runner filter and verified it.';
    resolveRunnerSuccessPolicyMock.mockImplementation((input?: { visibleAgentChars?: number }) => (
      (input?.visibleAgentChars ?? 0) > 0
        ? { ok: true as const }
        : {
          ok: false as const,
          errorCode: 'AGENT_EMPTY_OUTPUT' as const,
          errorMessage: 'agent_empty_output',
        }
    ));

    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const child = await startCodexRun(socket, requestId);
    await waitForCodexStdoutListener(child);

    child.stdout.emit('data', Buffer.from(codexStdoutLine({
      type: 'event_msg',
      payload: {
        type: 'agent_message',
        phase: null,
        message: cleanFinalAnswer,
      },
    })));

    expect(readAgentDeltas(socket, requestId)).toEqual([]);
    closeCodexChild(child, 0);

    await vi.waitFor(() => {
      const frames = readSentFrames(socket);
      expect(frames.some((frame) => (
        frame.type === 'agent.response.done'
        && frame.request_id === requestId
      ))).toBe(true);
    });

    expect(readAgentDeltas(socket, requestId)).toEqual([cleanFinalAnswer]);
    expect(readSentFrames(socket).some((frame) => (
      frame.type === 'agent.response.error'
      && frame.request_id === requestId
    ))).toBe(false);
  });

  it('suppresses phase-null apply_patch contamination from raw trace frames while keeping clean apply_patch mentions', async () => {
    const requestId = 'req_phase_null_patch_raw_trace';
    const cleanFinalAnswer = 'I used apply_patch to update the runner filter and verified it.';
    const contaminatedText = [
      'Tool call apply_patch with partial arguments',
      '*** Begin Patch',
      '*** Update File: secret.ts',
      '+leaked patch body should not appear',
      '*** End Patch',
    ].join('\n');

    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const child = await startCodexRun(socket, requestId);
    await waitForCodexStdoutListener(child);

    child.stdout.emit('data', Buffer.from([
      codexStdoutLine({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: null,
          content: [{ type: 'output_text', text: contaminatedText }],
        },
      }),
      codexStdoutLine({
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          phase: null,
          message: cleanFinalAnswer,
        },
      }),
    ].join('')));
    closeCodexChild(child, 0);

    await vi.waitFor(() => {
      expect(readSentFrames(socket).some((frame) => (
        frame.type === 'agent.response.done'
        && frame.request_id === requestId
      ))).toBe(true);
    });

    const traceJson = JSON.stringify(readAgentTraceEvents(socket, requestId));
    expect(traceJson).not.toContain('Tool call apply_patch with partial arguments');
    expect(traceJson).not.toContain('*** Begin Patch');
    expect(traceJson).not.toContain('leaked patch body should not appear');
    expect(traceJson).toContain(cleanFinalAnswer);
    expect(readAgentDeltas(socket, requestId)).toEqual([cleanFinalAnswer]);
  });

  it('uses top-level task_complete last_agent_message as final fallback', async () => {
    const cleanFinalAnswer = 'Top-level task complete final answer.';

    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const child = await startCodexRun(socket, 'req_top_level_task_complete');
    await waitForCodexStdoutListener(child);

    child.stdout.emit('data', Buffer.from(codexStdoutLine({
      type: 'task_complete',
      last_agent_message: cleanFinalAnswer,
    })));
    closeCodexChild(child, 0);

    await vi.waitFor(() => {
      const frames = readSentFrames(socket);
      expect(frames.some((frame) => (
        frame.type === 'agent.response.done'
        && frame.request_id === 'req_top_level_task_complete'
      ))).toBe(true);
    });

    expect(readAgentDeltas(socket, 'req_top_level_task_complete')).toEqual([cleanFinalAnswer]);
  });

  it('keeps phase-null apply_patch fragments out of deltas and fails empty-output policy without a clean candidate', async () => {
    resolveRunnerSuccessPolicyMock.mockImplementation((input?: { visibleAgentChars?: number }) => (
      (input?.visibleAgentChars ?? 0) > 0
        ? { ok: true as const }
        : {
          ok: false as const,
          errorCode: 'AGENT_EMPTY_OUTPUT' as const,
          errorMessage: 'agent_empty_output',
        }
    ));

    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const child = await startCodexRun(socket, 'req_phase_null_patch_fragment');
    await waitForCodexStdoutListener(child);

    child.stdout.emit('data', Buffer.from(codexStdoutLine({
      type: 'event_msg',
      payload: {
        type: 'agent_message',
        phase: null,
        message: [
          'Tool call partial arguments',
          'apply_patch <<\'PATCH\'',
          '*** Begin Patch',
          '*** Update File: src/example.ts',
        ].join('\n'),
      },
    })));

    expect(readAgentDeltas(socket, 'req_phase_null_patch_fragment')).toEqual([]);
    closeCodexChild(child, 0);

    await vi.waitFor(() => {
      const frames = readSentFrames(socket);
      expect(frames.some((frame) => (
        frame.type === 'agent.response.error'
        && frame.request_id === 'req_phase_null_patch_fragment'
        && typeof frame.payload === 'object'
        && frame.payload !== null
        && (frame.payload as { error_code?: unknown }).error_code === 'AGENT_EMPTY_OUTPUT'
      ))).toBe(true);
    });

    const deltas = readAgentDeltas(socket, 'req_phase_null_patch_fragment');
    expect(deltas).toEqual([]);
    expect(deltas.join('\n')).not.toContain('apply_patch');
    expect(deltas.join('\n')).not.toContain('*** Begin Patch');
    expect(readSentFrames(socket).some((frame) => (
      frame.type === 'agent.response.done'
      && frame.request_id === 'req_phase_null_patch_fragment'
    ))).toBe(false);
  });

  it('does not emit incomplete JSON stdout buffer as task answer content on close', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const child = await startCodexRun(socket, 'req_incomplete_json_ignored');
    await waitForCodexStdoutListener(child);

    child.stdout.emit('data', Buffer.from(
      '{"type":"response_item","payload":{"type":"message","role":"assistant","phase":null,"content":[{"type":"output_text","text":"Tool call partial arguments *** Begin Patch"',
    ));
    closeCodexChild(child, 0);

    await vi.waitFor(() => {
      const frames = readSentFrames(socket);
      expect(frames.some((frame) => frame.type === 'agent.response.done' && frame.request_id === 'req_incomplete_json_ignored')).toBe(true);
    });

    const deltas = readAgentDeltas(socket, 'req_incomplete_json_ignored');
    expect(deltas).toEqual([]);
    expect(deltas.join('\n')).not.toContain('Tool call');
    expect(deltas.join('\n')).not.toContain('partial arguments');
    expect(deltas.join('\n')).not.toContain('*** Begin Patch');
  });

  it('passes only emitted final answer characters into the runner success policy', async () => {
    const cleanFinalAnswer = 'Final visible chars.';

    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const child = await startCodexRun(socket, 'req_visible_chars_final_only');
    await waitForCodexStdoutListener(child);

    child.stdout.emit('data', Buffer.from([
      codexStdoutLine({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: null,
          content: [{ type: 'output_text', text: 'ignored partial arguments *** Begin Patch' }],
        },
      }),
      codexStdoutLine({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: cleanFinalAnswer }],
        },
      }),
    ].join('')));
    closeCodexChild(child, 0);

    await vi.waitFor(() => {
      expect(resolveRunnerSuccessPolicyMock).toHaveBeenCalledWith(expect.objectContaining({
        visibleAgentChars: cleanFinalAnswer.length,
      }));
    });
    expect(readAgentDeltas(socket, 'req_visible_chars_final_only')).toEqual([cleanFinalAnswer]);
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
          task_id: 'task_1',
          workspace_file_library_id: TASK_FILE_LIBRARY_ID,
          workspace_binding_mode: 'file_library',
          runtime_profile: 'managed',
          task_home_segment: TASK_HOME_SEGMENT,
          task_home_path: TASK_HOME,
          workspace_path: TASK_WORKSPACE,
          artifacts_path: TASK_ARTIFACTS,
          library_root_path: LIBRARY_ROOT_PATH,
          run_id: 'run_1',
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

  it('starts a fresh codex exec when no reusable local codex state was approved', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    spawnMock.mockReturnValueOnce(createCodexChild());
    socket.emit('message', serverHello());
    socket.emit('message', serverRequestStart('req_fresh_exec'));

    await vi.waitFor(() => {
      expect(buildCodexExecArgsMock).toHaveBeenCalledWith(expect.objectContaining({
        resumeSession: false,
      }));
    });
  });

  it('fingerprints canonical execution wire_api while keeping Codex provider config on responses', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const child = await startCodexRun(socket, 'req_canonical_wire_api_mapping', {
      wire_api: 'openai_chat_completions',
    });

    await vi.waitFor(() => {
      expect(ensureCodexSessionStateCompatibleMock).toHaveBeenCalledWith(expect.objectContaining({
        wireApi: 'openai_chat_completions',
      }));
      expect(buildTaskCodexConfigMock).toHaveBeenCalledWith(expect.objectContaining({
        wireApi: 'responses',
      }));
      expect(buildCodexExecArgsMock).toHaveBeenCalledWith(expect.objectContaining({
        wireApi: 'responses',
      }));
    });

    closeCodexChild(child, 0);
  });

  it('writes a custom execution ticket header into codex config and launch env without using Authorization', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    spawnMock.mockReturnValueOnce(createCodexChild());
    socket.emit('message', serverHello());
    socket.emit('message', serverRequestStart('req_execution_ticket_header'));

    await vi.waitFor(() => {
      expect(buildTaskCodexConfigMock).toHaveBeenCalledWith(expect.objectContaining({
        executionTicketHeaderEnvName: 'MBOS_CODEX_PROXY_EXECUTION_TICKET',
      }));
      expect(prepareLaunchCommandMock).toHaveBeenCalled();
    });

    const launchEnv = prepareLaunchCommandMock.mock.calls.at(-1)?.[0]?.env as NodeJS.ProcessEnv | undefined;
    expect(launchEnv?.MBOS_CODEX_PROXY_EXECUTION_TICKET).toBe('ticket_1');
    expect(launchEnv?.MBOS_CODEX_PROXY_AUTH_HEADER).toBeUndefined();
  });

  it('does not carry runner control credentials into Codex launch env', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const child = await startCodexRun(socket, 'req_control_env_scrub');

    const launchEnv = prepareLaunchCommandMock.mock.calls.at(-1)?.[0]?.env as NodeJS.ProcessEnv | undefined;
    expect(launchEnv?.MBOS_AGENT_WS_URL).toBeUndefined();
    expect(launchEnv?.MBOS_AGENT_KEY).toBeUndefined();
    expect(launchEnv?.AGENT_WS_URL).toBeUndefined();
    expect(launchEnv?.AGENT_KEY).toBeUndefined();
    expect(launchEnv?.MBOS_CODEX_PROXY_EXECUTION_TICKET).toBe('ticket_1');
    expect(launchEnv?.WORKSPACE_PATH).toBe(TASK_WORKSPACE);

    closeCodexChild(child, 0);
  });

  it('runs Codex from the visible workspace while HOME and artifact scans use explicit runtime paths', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const child = await startCodexRun(socket, 'req_path_boundaries');

    await vi.waitFor(() => {
      expect(buildCodexExecArgsMock).toHaveBeenCalledWith(expect.objectContaining({
        cwd: TASK_WORKSPACE,
      }));
      expect(prepareLaunchCommandMock).toHaveBeenCalledWith(expect.objectContaining({
        cwd: TASK_WORKSPACE,
        env: expect.objectContaining({
          HOME: TASK_HOME,
          TASK_HOME,
          WORKSPACE_PATH: TASK_WORKSPACE,
          ARTIFACTS_PATH: TASK_ARTIFACTS,
        }),
      }));
      expect(scanWorkspaceFilesSnapshotMock).toHaveBeenCalledWith(TASK_WORKSPACE, {
        runtimeRoot: TASK_HOME,
      });
      expect(scanArtifactsDirectoryMock).toHaveBeenCalledWith(TASK_ARTIFACTS, 'task_1');
    });

    closeCodexChild(child, 0);
  });

  it('passes the same canonical task paths into agent runs and terminals', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const child = await startCodexRun(socket, 'req_shared_task_paths');
    await startTerminalRun(socket, 'terminal_shared_task_paths');

    await vi.waitFor(() => {
      expect(prepareTaskWorkspaceMock).toHaveBeenCalledWith(expect.objectContaining({
        executionContext: expect.objectContaining({
          task_home_path: TASK_HOME,
          workspace_path: TASK_WORKSPACE,
          artifacts_path: TASK_ARTIFACTS,
          library_root_path: LIBRARY_ROOT_PATH,
        }),
      }));
      expect(startTerminalProcessMock).toHaveBeenCalledWith(expect.objectContaining({
        executionContext: expect.objectContaining({
          task_home_path: TASK_HOME,
          workspace_path: TASK_WORKSPACE,
          artifacts_path: TASK_ARTIFACTS,
          library_root_path: LIBRARY_ROOT_PATH,
        }),
      }));
    });

    closeCodexChild(child, 0);
  });

  it('derives compact limit from executionContext.model_limits max output when API compact limit is missing', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const child = await startCodexRun(socket, 'req_model_limits_derived_compact', {
      model_limits: {
        context_window: 200000,
        max_output_tokens: 32000,
      },
    });

    await vi.waitFor(() => {
      expect(buildCodexExecArgsMock).toHaveBeenCalledWith(expect.objectContaining({
        modelContextWindow: 200000,
        modelMaxOutputTokens: 32000,
        modelAutoCompactTokenLimit: 168000,
      }));
      expect(buildTaskCodexConfigMock).toHaveBeenCalledWith(expect.objectContaining({
        modelContextWindow: 200000,
        modelMaxOutputTokens: 32000,
        modelAutoCompactTokenLimit: 168000,
      }));
      expect(buildTaskCodexModelCatalogMock).toHaveBeenCalledWith(expect.objectContaining({
        modelContextWindow: 200000,
        modelMaxOutputTokens: 32000,
        modelAutoCompactTokenLimit: 168000,
      }));
      expect(ensureCodexSessionStateCompatibleMock).toHaveBeenCalledWith(expect.objectContaining({
        modelContextWindow: 200000,
        modelMaxOutputTokens: 32000,
        modelAutoCompactTokenLimit: 168000,
      }));
    });

    closeCodexChild(child, 0);
  });

  it('passes model output limit changes into session compatibility fingerprint input', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const firstChild = await startCodexRun(socket, 'req_output_limit_32k', {
      model_auto_compact_token_limit: 168000,
      model_limits: {
        context_window: 200000,
        max_output_tokens: 32000,
      },
    });
    closeCodexChild(firstChild, 0);

    await vi.waitFor(() => {
      expect(readSentFrames(socket).some((frame) => (
        frame.type === 'agent.response.done'
        && frame.request_id === 'req_output_limit_32k'
      ))).toBe(true);
    });

    const secondChild = await startCodexRun(socket, 'req_output_limit_64k', {
      model_auto_compact_token_limit: 136000,
      model_limits: {
        context_window: 200000,
        max_output_tokens: 64000,
      },
    });

    await vi.waitFor(() => {
      expect(ensureCodexSessionStateCompatibleMock).toHaveBeenCalledWith(expect.objectContaining({
        modelContextWindow: 200000,
        modelMaxOutputTokens: 32000,
        modelAutoCompactTokenLimit: 168000,
      }));
      expect(ensureCodexSessionStateCompatibleMock).toHaveBeenCalledWith(expect.objectContaining({
        modelContextWindow: 200000,
        modelMaxOutputTokens: 64000,
        modelAutoCompactTokenLimit: 136000,
      }));
    });

    closeCodexChild(secondChild, 0);
  });

  it('passes default function and explicit freeform apply_patch tool types into the model catalog', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const defaultChild = await startCodexRun(socket, 'req_catalog_default_apply_patch', {
      model_catalog: {
        input_modalities: ['text'],
      },
    });

    await vi.waitFor(() => {
      expect(buildTaskCodexModelCatalogMock).toHaveBeenLastCalledWith(expect.objectContaining({
        applyPatchToolType: 'function',
      }));
    });
    closeCodexChild(defaultChild, 0);
    await vi.waitFor(() => {
      const frames = readSentFrames(socket);
      expect(frames.some((frame) => (
        frame.type === 'agent.response.done'
        && frame.request_id === 'req_catalog_default_apply_patch'
      ))).toBe(true);
    });

    const freeformChild = await startCodexRun(socket, 'req_catalog_freeform_apply_patch', {
      model_catalog: {
        apply_patch_tool_type: 'freeform',
      },
    });

    await vi.waitFor(() => {
      expect(buildTaskCodexModelCatalogMock).toHaveBeenLastCalledWith(expect.objectContaining({
        applyPatchToolType: 'freeform',
      }));
    });
    closeCodexChild(freeformChild, 0);
    await vi.waitFor(() => {
      const frames = readSentFrames(socket);
      expect(frames.some((frame) => (
        frame.type === 'agent.response.done'
        && frame.request_id === 'req_catalog_freeform_apply_patch'
      ))).toBe(true);
    });
  });

  it('does not inject execution ticket env_http_headers or launch env when no execution ticket is present', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    spawnMock.mockReturnValueOnce(createCodexChild());
    socket.emit('message', serverHello());
    socket.emit('message', serverRequestStart('req_without_execution_ticket', {
      execution_ticket: '',
    }));

    await vi.waitFor(() => {
      expect(buildTaskCodexConfigMock).toHaveBeenCalledWith(expect.objectContaining({
        executionTicketHeaderEnvName: undefined,
      }));
      expect(prepareLaunchCommandMock).toHaveBeenCalled();
    });

    const launchEnv = prepareLaunchCommandMock.mock.calls.at(-1)?.[0]?.env as NodeJS.ProcessEnv | undefined;
    expect(launchEnv?.MBOS_CODEX_PROXY_EXECUTION_TICKET).toBeUndefined();
    expect(launchEnv?.MBOS_CODEX_PROXY_AUTH_HEADER).toBeUndefined();
  });

  it('resumes only when session-state compatibility explicitly allows local codex reuse for this task', async () => {
    ensureCodexSessionStateCompatibleMock.mockResolvedValueOnce({
      resetPerformed: false,
      reason: 'unchanged',
      resumeAllowed: true,
    });

    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    spawnMock.mockReturnValueOnce(createCodexChild());
    socket.emit('message', serverHello());
    socket.emit('message', serverRequestStart('req_resume_allowed'));

    await vi.waitFor(() => {
      expect(buildCodexExecArgsMock).toHaveBeenCalledWith(expect.objectContaining({
        resumeSession: true,
      }));
    });
  });

  it('marks local codex session state reusable only after a successful task run completes', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const child = await startCodexRun(socket, 'req_successful_run');
    closeCodexChild(child, 0);

    await vi.waitFor(() => {
      expect(markCodexSessionStateReusableMock).toHaveBeenCalledWith({
        codexDir: `${TASK_HOME}/.codex`,
        taskId: 'task_1',
      });
    });
  });

  it('does not mark local codex session state reusable when the task run fails', async () => {
    resolveCodexTerminalOutcomeMock.mockReturnValueOnce({
      finalStatus: 'error',
      codexTraceStatus: 'error',
      errorCode: 'AGENT_UPSTREAM_ERROR',
      errorMessage: 'codex_exit_code_1',
    });

    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const child = await startCodexRun(socket, 'req_failed_run');
    closeCodexChild(child, 1);

    await vi.waitFor(() => {
      const frames = readSentFrames(socket);
      expect(frames.some((frame) => frame.type === 'agent.response.error')).toBe(true);
    });
    expect(markCodexSessionStateReusableMock).not.toHaveBeenCalled();
  });

  it('releases the prepared task workspace exactly once when codex emits error and close', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const child = await startCodexRun(socket, 'req_error_then_close_release');
    await waitForCodexLifecycleListeners(child);

    child.emit('error', new Error('spawn transport failed'));
    closeCodexChild(child, 1);

    await vi.waitFor(() => {
      expect(releaseTaskWorkspaceMock).toHaveBeenCalledTimes(1);
    });
  });

  it('releases the prepared task workspace after a cancelled codex run closes', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const child = await startCodexRun(socket, 'req_cancelled_release');
    await waitForCodexLifecycleListeners(child);

    socket.emit('message', Buffer.from(JSON.stringify({
      type: 'server.request.cancel',
      request_id: 'req_cancelled_release',
    })));
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    closeCodexChild(child, null, 'SIGTERM');

    await vi.waitFor(() => {
      expect(releaseTaskWorkspaceMock).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps terminal PTY and active registry on websocket close transport lost while terminating task run child', async () => {
    vi.useFakeTimers();
    process.env.MBOS_AGENT_RECONNECT_BASE_MS = '10';
    process.env.MBOS_AGENT_RECONNECT_MAX_MS = '10';

    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"agent.ready"'));

    const codexChild = await startCodexRun(socket, 'req_transport_lost');
    const terminal = await startTerminalRun(socket, 'terminal_transport_lost', {
      runnerSessionId: 'runner_session_1',
      generation: 3,
      cols: 100,
      rows: 25,
    });

    socket.emit('close');

    await vi.waitFor(() => {
      expect(codexChild.kill).toHaveBeenCalledWith('SIGTERM');
    });
    expect(terminal.child.kill).not.toHaveBeenCalled();
    expect(releaseAllPreparedTaskWorkspacesMock).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10);
    const reconnectSocket = websocketInstances.at(-1);
    expect(reconnectSocket).toBeDefined();
    expect(reconnectSocket).not.toBe(socket);
    reconnectSocket?.emit('open');

    await vi.waitFor(() => {
      const readyFrame = readSentFrames(reconnectSocket!).find((frame) => frame.type === 'agent.ready');
      expect(readyFrame).toEqual(expect.objectContaining({
        payload: expect.objectContaining({
          capabilities: expect.objectContaining({
            terminal_adopt: 'v1',
          }),
          active_terminals: [
            expect.objectContaining({
              terminal_session_id: 'terminal_transport_lost',
              runner_session_id: 'runner_session_1',
              generation: 3,
              cols: 100,
              rows: 25,
              cwd: TASK_WORKSPACE,
            }),
          ],
        }),
      }));
    });

    closeCodexChild(codexChild, null, 'SIGTERM');
  });

  it('emits stable lifecycle state logs for websocket close transport lost without process shutdown', async () => {
    vi.useFakeTimers();
    process.env.MBOS_AGENT_RECONNECT_BASE_MS = '10';
    process.env.MBOS_AGENT_RECONNECT_MAX_MS = '10';
    const stdoutWriteSpy = vi.spyOn(process.stdout, 'write');
    try {
      await import('./index.js');
      const socket = websocketInstances.at(-1);
      if (!socket) {
        throw new Error('websocket_instance_missing');
      }

      socket.emit('open');
      socket.emit('close');

      expect(releaseAllPreparedTaskWorkspacesMock).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();

      const output = stdoutWriteSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
      const connectedIndex = output.indexOf('runner_state=connected reason=websocket_open');
      const reconnectingIndex = output.indexOf('runner_state=reconnecting reason=websocket_close');

      expect(connectedIndex).toBeGreaterThanOrEqual(0);
      expect(reconnectingIndex).toBeGreaterThan(connectedIndex);
      expect(output).not.toContain('runner_state=shutting_down reason=websocket_close');
    } finally {
      stdoutWriteSpy.mockRestore();
    }
  });

  it('keeps unexpected websocket reconnect timer refed so transport loss cannot end runner lifecycle early', async () => {
    process.env.MBOS_AGENT_RECONNECT_BASE_MS = '10';
    process.env.MBOS_AGENT_RECONNECT_MAX_MS = '10';
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const unrefSpy = vi.fn();
    const scheduledReconnect: { callback?: () => void } = {};
    let scheduledDelayMs: number | undefined;
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      callback: (...args: unknown[]) => void,
      delay?: number,
      ...args: unknown[]
    ) => {
      scheduledDelayMs = delay;
      scheduledReconnect.callback = () => callback(...args);
      return { unref: unrefSpy } as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);

    try {
      await import('./index.js');
      const socket = websocketInstances.at(-1);
      if (!socket) {
        throw new Error('websocket_instance_missing');
      }

      socket.emit('open');
      socket.emit('close');

      expect(scheduledDelayMs).toBe(10);
      expect(unrefSpy).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();

      scheduledReconnect.callback?.();

      const reconnectSocket = websocketInstances.at(-1);
      expect(reconnectSocket).toBeDefined();
      expect(reconnectSocket).not.toBe(socket);
    } finally {
      setTimeoutSpy.mockRestore();
      randomSpy.mockRestore();
    }
  });

  it('sends SIGKILL to running children after process shutdown grace expires', async () => {
    vi.useFakeTimers();
    process.env.MBOS_AGENT_CANCEL_KILL_DELAY_MS = '1000';
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const codexChild = await startCodexRun(socket);
    const terminal = await startTerminalRun(socket);

    process.emit('SIGTERM');
    expect(codexChild.kill).toHaveBeenCalledWith('SIGTERM');
    expect(terminal.child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(codexChild.kill).not.toHaveBeenCalledWith('SIGKILL');
    expect(terminal.child.kill).not.toHaveBeenCalledWith('SIGKILL');

    await vi.advanceTimersByTimeAsync(1_000);
    expect(codexChild.kill).toHaveBeenCalledWith('SIGKILL');
    expect(terminal.child.kill).toHaveBeenCalledWith('SIGKILL');

    closeCodexChild(codexChild, null, 'SIGKILL');
    closeTerminalChild(terminal.child, terminal.exitListeners, null, 'SIGKILL');
    await vi.runOnlyPendingTimersAsync();
  });

  it('rejects new codex and terminal work while process shutdown is in progress', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const codexChild = await startCodexRun(socket, 'req_before_shutdown');
    const terminal = await startTerminalRun(socket, 'terminal_before_shutdown');

    process.emit('SIGTERM');
    await vi.waitFor(() => {
      expect(codexChild.kill).toHaveBeenCalledWith('SIGTERM');
      expect(terminal.child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    socket.emit('message', serverRequestStart('req_after_shutdown'));
    socket.emit('message', serverTerminalStart('terminal_after_shutdown'));
    await Promise.resolve();

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(startTerminalProcessMock).toHaveBeenCalledTimes(1);

    closeCodexChild(codexChild, null, 'SIGTERM');
    closeTerminalChild(terminal.child, terminal.exitListeners, null, 'SIGTERM');
    await vi.waitFor(() => {
      expect(releaseAllPreparedTaskWorkspacesMock).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  it('kills terminal PTY and sends shutdown frame on process shutdown', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const codexChild = await startCodexRun(socket);
    const terminal = await startTerminalRun(socket);

    process.emit('SIGTERM');
    socket.emit('close');

    await vi.waitFor(() => {
      expect(codexChild.kill).toHaveBeenCalledTimes(1);
      expect(codexChild.kill).toHaveBeenCalledWith('SIGTERM');
      expect(terminal.child.kill).toHaveBeenCalledTimes(1);
      expect(terminal.child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    closeCodexChild(codexChild, null, 'SIGTERM');
    closeTerminalChild(terminal.child, terminal.exitListeners, null, 'SIGTERM');

    await vi.waitFor(() => {
      expect(releaseAllPreparedTaskWorkspacesMock).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
    expect(readSentFrames(socket)).toContainEqual(expect.objectContaining({
      type: 'agent.shutdown',
      payload: expect.objectContaining({
        reason: 'sigterm',
        terminal_processes_terminated: true,
      }),
    }));
    expect(socket.close).toHaveBeenCalled();
  });

  it('handles terminal adopt idempotently and rejects stale fencing without rebinding', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const terminal = await startTerminalRun(socket, 'terminal_adopt', {
      runnerSessionId: 'runner_session_1',
      generation: 2,
      cols: 100,
      rows: 25,
    });
    const terminalStartsAfterInitialStart = startTerminalProcessMock.mock.calls.length;

    socket.emit('message', serverTerminalAdopt('terminal_adopt', {
      requestId: 'adopt_current',
      runnerSessionId: 'runner_session_1',
      adoptAttemptId: 'adopt_current',
      connectionEpoch: 7,
      generation: 2,
      cols: 132,
      rows: 43,
    }));

    await vi.waitFor(() => {
      expect(readSentFrames(socket)).toContainEqual(expect.objectContaining({
        type: 'agent.terminal.adopted',
        request_id: 'adopt_current',
        terminal_session_id: 'terminal_adopt',
        runner_session_id: 'runner_session_1',
        payload: expect.objectContaining({
          adopt_attempt_id: 'adopt_current',
          connection_epoch: 7,
          generation: 2,
          runner_session_id: 'runner_session_1',
          terminal_session_id: 'terminal_adopt',
        }),
      }));
    });
    expect(startTerminalProcessMock).toHaveBeenCalledTimes(terminalStartsAfterInitialStart);
    expect(terminal.child.resize).toHaveBeenCalledWith(132, 43);

    socket.emit('message', serverTerminalAdopt('terminal_adopt', {
      requestId: 'adopt_duplicate',
      runnerSessionId: 'runner_session_1',
      adoptAttemptId: 'adopt_duplicate',
      connectionEpoch: 8,
      generation: 2,
      cols: 132,
      rows: 43,
    }));

    await vi.waitFor(() => {
      expect(readSentFrames(socket)).toContainEqual(expect.objectContaining({
        type: 'agent.terminal.adopted',
        request_id: 'adopt_duplicate',
        terminal_session_id: 'terminal_adopt',
      }));
    });
    expect(startTerminalProcessMock).toHaveBeenCalledTimes(terminalStartsAfterInitialStart);

    socket.emit('message', serverTerminalAdopt('terminal_adopt', {
      requestId: 'adopt_stale',
      runnerSessionId: 'runner_session_1',
      adoptAttemptId: 'adopt_stale',
      connectionEpoch: 9,
      generation: 999,
      cols: 12,
      rows: 5,
    }));

    await vi.waitFor(() => {
      expect(readSentFrames(socket)).toContainEqual(expect.objectContaining({
        type: 'agent.terminal.error',
        request_id: 'adopt_stale',
        terminal_session_id: 'terminal_adopt',
        payload: expect.objectContaining({
          error_code: 'AGENT_TERMINAL_ADOPT_STALE',
        }),
      }));
    });
    expect(startTerminalProcessMock).toHaveBeenCalledTimes(terminalStartsAfterInitialStart);
    expect(terminal.child.resize).not.toHaveBeenCalledWith(12, 5);
  });

  it('returns terminal adopt not_found or exited without starting a replacement shell', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const terminal = await startTerminalRun(socket, 'terminal_exited_for_adopt', {
      runnerSessionId: 'runner_session_1',
      generation: 1,
    });
    const terminalStartsAfterInitialStart = startTerminalProcessMock.mock.calls.length;
    closeTerminalChild(terminal.child, terminal.exitListeners, 0, null);

    socket.emit('message', serverTerminalAdopt('terminal_missing_for_adopt', {
      requestId: 'adopt_missing',
      runnerSessionId: 'runner_session_1',
    }));
    socket.emit('message', serverTerminalAdopt('terminal_exited_for_adopt', {
      requestId: 'adopt_exited',
      runnerSessionId: 'runner_session_1',
      generation: 1,
    }));

    await vi.waitFor(() => {
      const sentFrames = readSentFrames(socket);
      expect(sentFrames).toContainEqual(expect.objectContaining({
        type: 'agent.terminal.not_found',
        request_id: 'adopt_missing',
        terminal_session_id: 'terminal_missing_for_adopt',
      }));
      expect(sentFrames).toContainEqual(expect.objectContaining({
        type: 'agent.terminal.exited',
        request_id: 'adopt_exited',
        terminal_session_id: 'terminal_exited_for_adopt',
      }));
    });
    expect(startTerminalProcessMock).toHaveBeenCalledTimes(terminalStartsAfterInitialStart);
  });

  it('sends terminal close_ack for server terminal close and keeps terminal exited as separate evidence', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const terminal = await startTerminalRun(socket, 'terminal_close_ack', {
      runnerSessionId: 'runner_session_1',
      generation: 4,
    });
    let resolveWorkspaceRelease: (() => void) | undefined;
    terminal.child.waitForWorkspaceRelease.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveWorkspaceRelease = resolve;
    }));

    socket.emit('message', serverTerminalClose('terminal_close_ack', {
      requestId: 'close_terminal',
      runnerSessionId: 'runner_session_1',
      closeAttemptId: 'close_terminal',
      connectionEpoch: 11,
      generation: 4,
      reason: 'user_requested',
    }));

    expect(terminal.child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(readSentFrames(socket).some((frame) => frame.type === 'agent.terminal.close_ack')).toBe(false);

    await vi.waitFor(() => {
      expect(terminal.child.onExit).toHaveBeenCalledTimes(2);
    });
    closeTerminalChild(terminal.child, terminal.exitListeners, 0, null);
    await vi.waitFor(() => {
      expect(readSentFrames(socket)).toContainEqual(expect.objectContaining({
        type: 'agent.terminal.exited',
        terminal_session_id: 'terminal_close_ack',
        payload: expect.objectContaining({
          exit_code: 0,
        }),
      }));
    });
    expect(readSentFrames(socket).some((frame) => frame.type === 'agent.terminal.close_ack')).toBe(false);
    await vi.waitFor(() => {
      expect(terminal.child.waitForWorkspaceRelease).toHaveBeenCalledTimes(1);
    });
    resolveWorkspaceRelease?.();

    await vi.waitFor(() => {
      const sentFrames = readSentFrames(socket);
      expect(sentFrames).toContainEqual(expect.objectContaining({
        type: 'agent.terminal.exited',
        terminal_session_id: 'terminal_close_ack',
        payload: expect.objectContaining({
          exit_code: 0,
        }),
      }));
      expect(sentFrames).toContainEqual(expect.objectContaining({
        type: 'agent.terminal.close_ack',
        request_id: 'close_terminal',
        terminal_session_id: 'terminal_close_ack',
        runner_session_id: 'runner_session_1',
        payload: expect.objectContaining({
          close_attempt_id: 'close_terminal',
          connection_epoch: 11,
          generation: 4,
          status: 'closed',
          terminal_session_id: 'terminal_close_ack',
          runner_session_id: 'runner_session_1',
          exit_code: 0,
          signal: null,
        }),
      }));
    });
  });

  it.each([
    {
      name: 'zero generation',
      closeOptions: { generation: 0 },
      diagnosticCode: 'non_positive_generation',
      expectedGeneration: 0,
      expectedConnectionEpoch: 11,
    },
    {
      name: 'missing generation',
      closeOptions: { includeGeneration: false },
      diagnosticCode: 'missing_runtime_identity',
      expectedGeneration: null,
      expectedConnectionEpoch: 11,
    },
    {
      name: 'zero connection epoch',
      closeOptions: { connectionEpoch: 0 },
      diagnosticCode: 'non_positive_connection_epoch',
      expectedGeneration: 6,
      expectedConnectionEpoch: 0,
    },
    {
      name: 'missing connection epoch',
      closeOptions: { includeConnectionEpoch: false },
      diagnosticCode: 'missing_runtime_identity',
      expectedGeneration: 6,
      expectedConnectionEpoch: null,
    },
    {
      name: 'missing runner session',
      closeOptions: { includeRunnerSessionId: false },
      diagnosticCode: 'missing_runtime_identity',
      expectedGeneration: 6,
      expectedConnectionEpoch: 11,
    },
  ])('rejects terminal close with $name without fabricating a matching fence', async ({
    closeOptions,
    diagnosticCode,
    expectedConnectionEpoch,
    expectedGeneration,
  }) => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const terminal = await startTerminalRun(socket, 'terminal_invalid_close_fence', {
      runnerSessionId: 'runner_session_1',
      generation: 6,
    });

    socket.emit('message', serverTerminalClose('terminal_invalid_close_fence', {
      requestId: `close_invalid_${diagnosticCode}`,
      runnerSessionId: 'runner_session_1',
      closeAttemptId: `close_invalid_${diagnosticCode}`,
      connectionEpoch: 11,
      generation: 6,
      ...closeOptions,
    }));

    await vi.waitFor(() => {
      expect(readSentFrames(socket)).toContainEqual(expect.objectContaining({
        type: 'agent.terminal.close_ack',
        request_id: `close_invalid_${diagnosticCode}`,
        terminal_session_id: 'terminal_invalid_close_fence',
        payload: expect.objectContaining({
          status: 'error',
          diagnostic_code: diagnosticCode,
          generation: expectedGeneration,
          connection_epoch: expectedConnectionEpoch,
          remaining_pid_count: 1,
        }),
      }));
    });
    expect(terminal.child.kill).not.toHaveBeenCalled();
    expect(terminateTerminalProcessTreeMock).not.toHaveBeenCalled();
  });

  it('logs correlatable observability fields before sending terminal close_ack', async () => {
    process.env.MBOS_AGENT_RUNNER_DEBUG = '1';
    const stdoutWriteSpy = vi.spyOn(process.stdout, 'write');
    try {
      await import('./index.js');
      const socket = websocketInstances.at(-1);
      if (!socket) {
        throw new Error('websocket_instance_missing');
      }

      socket.emit('open');
      const terminal = await startTerminalRun(socket, 'terminal_close_observability', {
        runnerSessionId: 'runner_session_1',
        generation: 7,
      });
      socket.emit('message', serverTerminalClose('terminal_close_observability', {
        requestId: 'close_observability',
        runnerSessionId: 'runner_session_1',
        closeAttemptId: 'close_observability',
        connectionEpoch: 15,
        generation: 7,
      }));
      closeTerminalChild(terminal.child, terminal.exitListeners, 0, null);

      await vi.waitFor(() => {
        const output = stdoutWriteSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
        expect(output).toContain('terminal close ack send');
        expect(output).toContain('"terminal_session_id":"terminal_close_observability"');
        expect(output).toContain('"runner_session_id":"runner_session_1"');
        expect(output).toContain('"request_id":"close_observability"');
        expect(output).toContain('"close_attempt_id":"close_observability"');
        expect(output).toContain('"generation":7');
        expect(output).toContain('"connection_epoch":15');
        expect(output).toContain('"status":"closed"');
        expect(output).toContain('"remaining_pid_count":0');
        expect(output).toContain('"diagnostic_code":null');
      });
    } finally {
      stdoutWriteSpy.mockRestore();
    }
  });

  it('maps process tree not_found to close_ack not_found with diagnostic evidence', async () => {
    terminateTerminalProcessTreeMock.mockResolvedValueOnce({
      outcome: 'not_found',
      rootPid: 12_345,
      ptyPid: 12_345,
      pgid: 12_345,
      sid: 12_345,
      terminatedPids: [],
      remainingPids: [],
      signalSequence: [],
      durationMs: 3,
      diagnosticCode: 'terminal_root_pid_not_found',
      diagnostics: ['terminal_root_pid_not_found'],
    });

    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    await startTerminalRun(socket, 'terminal_close_not_found', {
      runnerSessionId: 'runner_session_1',
      generation: 8,
    });

    socket.emit('message', serverTerminalClose('terminal_close_not_found', {
      requestId: 'close_not_found',
      runnerSessionId: 'runner_session_1',
      closeAttemptId: 'close_not_found',
      connectionEpoch: 16,
      generation: 8,
    }));

    await vi.waitFor(() => {
      expect(readSentFrames(socket)).toContainEqual(expect.objectContaining({
        type: 'agent.terminal.close_ack',
        request_id: 'close_not_found',
        terminal_session_id: 'terminal_close_not_found',
        payload: expect.objectContaining({
          status: 'not_found',
          diagnostic_code: 'terminal_root_pid_not_found',
          remaining_pid_count: 0,
        }),
      }));
    });
  });

  it('sends terminal close_ack error with diagnostic evidence when process tree termination fails', async () => {
    terminateTerminalProcessTreeMock.mockResolvedValueOnce({
      outcome: 'failed',
      rootPid: 12_345,
      ptyPid: 12_345,
      pgid: 12_345,
      sid: 12_345,
      terminatedPids: [],
      remainingPids: [12_345, 12_346],
      signalSequence: ['pty:SIGTERM', 'pty:SIGKILL'],
      durationMs: 2_000,
      diagnosticCode: 'terminal_process_tree_remaining',
      diagnostics: ['descendant_still_alive'],
    });

    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    await startTerminalRun(socket, 'terminal_close_failure', {
      runnerSessionId: 'runner_session_1',
      generation: 5,
    });

    socket.emit('message', serverTerminalClose('terminal_close_failure', {
      requestId: 'close_failure',
      runnerSessionId: 'runner_session_1',
      closeAttemptId: 'close_failure',
      connectionEpoch: 12,
      generation: 5,
    }));

    await vi.waitFor(() => {
      expect(readSentFrames(socket)).toContainEqual(expect.objectContaining({
        type: 'agent.terminal.close_ack',
        request_id: 'close_failure',
        terminal_session_id: 'terminal_close_failure',
        payload: expect.objectContaining({
          status: 'error',
          diagnostic_code: 'terminal_process_tree_remaining',
          remaining_pid_count: 2,
          remaining_pids: [12_345, 12_346],
        }),
      }));
    });
  });

  it('closes only the requested terminal process tree without touching another terminal or task run', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const codexChild = await startCodexRun(socket, 'req_close_isolation');
    const terminalA = await startTerminalRun(socket, 'terminal_close_a', {
      runnerSessionId: 'runner_session_1',
      generation: 1,
    });
    const terminalB = await startTerminalRun(socket, 'terminal_close_b', {
      runnerSessionId: 'runner_session_1',
      generation: 1,
    });

    socket.emit('message', serverTerminalClose('terminal_close_a', {
      requestId: 'close_a',
      runnerSessionId: 'runner_session_1',
      closeAttemptId: 'close_a',
      connectionEpoch: 13,
      generation: 1,
    }));

    expect(terminalA.child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(terminalB.child.kill).not.toHaveBeenCalled();
    expect(codexChild.kill).not.toHaveBeenCalled();

    closeTerminalChild(terminalA.child, terminalA.exitListeners, 0, null);

    await vi.waitFor(() => {
      const sentFrames = readSentFrames(socket);
      expect(sentFrames).toContainEqual(expect.objectContaining({
        type: 'agent.terminal.close_ack',
        request_id: 'close_a',
        terminal_session_id: 'terminal_close_a',
        payload: expect.objectContaining({
          status: 'closed',
        }),
      }));
      expect(sentFrames.some((frame) => (
        frame.type === 'agent.terminal.close_ack'
        && frame.terminal_session_id === 'terminal_close_b'
      ))).toBe(false);
    });

    closeCodexChild(codexChild, 0);
    closeTerminalChild(terminalB.child, terminalB.exitListeners, 0, null);
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
          task_id: 'task_1',
          workspace_file_library_id: TASK_FILE_LIBRARY_ID,
          workspace_binding_mode: 'file_library',
          runtime_profile: 'managed',
          task_home_segment: TASK_HOME_SEGMENT,
          task_home_path: TASK_HOME,
          workspace_path: TASK_WORKSPACE,
          artifacts_path: TASK_ARTIFACTS,
          library_root_path: LIBRARY_ROOT_PATH,
          run_id: 'run_1',
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
