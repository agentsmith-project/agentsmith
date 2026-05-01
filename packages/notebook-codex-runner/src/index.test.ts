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

type MockCodexChild = EventEmitter & {
  exitCode: number | null;
  stdout: EventEmitter & { on: typeof EventEmitter.prototype.on };
  stderr: EventEmitter & { on: typeof EventEmitter.prototype.on };
  kill: ReturnType<typeof vi.fn>;
};

type TerminalExitEvent = { exitCode: number | null; signal?: string | null };
type ProcessSignalListener = (signal: NodeJS.Signals) => void;

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
  markCodexSessionStateReusableMock,
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
}));

vi.mock('./user-install-env.js', () => ({
  buildTaskUserInstallEnv: buildTaskUserInstallEnvMock,
}));

function readSentFrames(socket: EventEmitter & { send: ReturnType<typeof vi.fn> }): Array<Record<string, unknown>> {
  return socket.send.mock.calls.map(([frame]) => JSON.parse(String(frame)) as Record<string, unknown>);
}

describe('notebook-codex-runner entry lifecycle', () => {
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
    process.env.MBOS_AGENT_RUNNER_DEBUG = '0';
    resolveRunnerSuccessPolicyMock.mockImplementation(() => ({ ok: true as const }));
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
    delete process.env.MBOS_AGENT_RUNNER_DEBUG;
    delete process.env.MBOS_AGENT_CANCEL_KILL_DELAY_MS;
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
    const child: MockTerminalChild = {
      exitCode: null,
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

  function serverHello(): Buffer {
    return Buffer.from(JSON.stringify({
      type: 'server.hello',
      timestamp: new Date().toISOString(),
      payload: {
        resource_proxy: {
          base_url: 'http://127.0.0.1:20000/api/v1',
        },
      },
    }));
  }

  function serverRequestStart(
    requestId: string,
    executionContextOverrides: Record<string, unknown> = {},
  ): Buffer {
    return Buffer.from(JSON.stringify({
      type: 'server.request.start',
      request_id: requestId,
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
          ...executionContextOverrides,
        },
      },
    }));
  }

  function serverTerminalStart(terminalSessionId: string): Buffer {
    return Buffer.from(JSON.stringify({
      type: 'server.terminal.start',
      terminal_session_id: terminalSessionId,
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

  async function waitForCodexStdoutListener(child: MockCodexChild): Promise<void> {
    await vi.waitFor(() => {
      expect(child.stdout.listenerCount('data')).toBeGreaterThan(0);
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
    socket: EventEmitter & { send: ReturnType<typeof vi.fn> },
    terminalSessionId = 'terminal_1',
  ): Promise<{ child: MockTerminalChild; exitListeners: Array<(event: TerminalExitEvent) => void> }> {
    const exitListeners: Array<(event: TerminalExitEvent) => void> = [];
    const child = createTerminalChild(exitListeners);
    startTerminalProcessMock.mockResolvedValueOnce({
      child,
      cwd: '/workspace/task_1',
    });
    socket.emit('message', serverTerminalStart(terminalSessionId));
    await vi.waitFor(() => {
      expect(startTerminalProcessMock).toHaveBeenCalled();
    });
    return { child, exitListeners };
  }

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

    await vi.waitFor(() => {
      expect(readSentFrames(socket).some((frame) => (
        frame.type === 'agent.response.done'
        && frame.request_id === requestId
      ))).toBe(true);
    });

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
    const cleanFinalAnswer = 'Clean final notebook answer.';
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

  it('does not emit incomplete JSON stdout buffer as notebook answer content on close', async () => {
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

  it('starts a fresh codex exec even when AgentSmith sends a session id but no reusable local codex state was approved', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    spawnMock.mockReturnValueOnce(createCodexChild());
    socket.emit('message', serverHello());
    socket.emit('message', serverRequestStart('req_fresh_exec', {
      session_id: 'session_remote_from_agentsmith',
    }));

    await vi.waitFor(() => {
      expect(buildCodexExecArgsMock).toHaveBeenCalledWith(expect.objectContaining({
        resumeSession: false,
      }));
    });
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
    socket.emit('message', serverRequestStart('req_resume_allowed', {
      session_id: 'session_remote_from_agentsmith',
    }));

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
        codexDir: '/workspace/task_1/.codex',
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

  it('waits for running children to exit before releasing tracked workspaces and exiting on websocket close', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"agent.ready"'));

    const codexChild = await startCodexRun(socket);
    const terminal = await startTerminalRun(socket);

    socket.emit('close');

    await vi.waitFor(() => {
      expect(codexChild.kill).toHaveBeenCalledWith('SIGTERM');
    });
    await vi.waitFor(() => {
      expect(terminal.child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    await Promise.resolve();
    expect(releaseAllPreparedTaskWorkspacesMock).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();

    const sendCountAfterShutdownStarted = socket.send.mock.calls.length;
    closeCodexChild(codexChild, null, 'SIGTERM');
    closeTerminalChild(terminal.child, terminal.exitListeners, null, 'SIGTERM');

    await vi.waitFor(() => {
      expect(releaseAllPreparedTaskWorkspacesMock).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
    expect(socket.send).toHaveBeenCalledTimes(sendCountAfterShutdownStarted);
  });

  it('emits stable lifecycle state logs before websocket ready, shutdown cleanup, and final exit', async () => {
    const stdoutWriteSpy = vi.spyOn(process.stdout, 'write');
    try {
      await import('./index.js');
      const socket = websocketInstances.at(-1);
      if (!socket) {
        throw new Error('websocket_instance_missing');
      }

      socket.emit('open');
      socket.emit('close');

      await vi.waitFor(() => {
        expect(releaseAllPreparedTaskWorkspacesMock).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledWith(1);
      });

      const output = stdoutWriteSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
      const connectedIndex = output.indexOf('runner_state=connected reason=websocket_open');
      const shuttingDownIndex = output.indexOf('runner_state=shutting_down reason=websocket_close');
      const disconnectedIndex = output.indexOf('runner_state=disconnected reason=websocket_close');

      expect(connectedIndex).toBeGreaterThanOrEqual(0);
      expect(shuttingDownIndex).toBeGreaterThan(connectedIndex);
      expect(disconnectedIndex).toBeGreaterThan(shuttingDownIndex);
    } finally {
      stdoutWriteSpy.mockRestore();
    }
  });

  it('sends SIGKILL to running children after shutdown grace expires', async () => {
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

    socket.emit('close');
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

  it('rejects new codex and terminal work while shutdown is in progress', async () => {
    await import('./index.js');
    const socket = websocketInstances.at(-1);
    if (!socket) {
      throw new Error('websocket_instance_missing');
    }

    socket.emit('open');
    const codexChild = await startCodexRun(socket, 'req_before_shutdown');
    const terminal = await startTerminalRun(socket, 'terminal_before_shutdown');

    socket.emit('close');
    await vi.waitFor(() => {
      expect(codexChild.kill).toHaveBeenCalledWith('SIGTERM');
      expect(terminal.child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    socket.emit('message', serverRequestStart('req_after_shutdown'));
    socket.emit('message', serverTerminalStart('terminal_after_shutdown'));
    await Promise.resolve();

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(startTerminalProcessMock).toHaveBeenCalledTimes(1);
  });

  it('uses the same idempotent shutdown path for process signals and websocket close', async () => {
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
