import { chmod, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { basename, extname, join } from 'node:path';
import { WebSocket } from 'ws';

type ServerStartPayload = {
  model?: string;
  messages?: Array<{ role?: string; content?: unknown }>;
  runtime_context?: {
    workspace_id?: string;
    project_id?: string;
    task_id?: string;
    run_id?: string;
    username?: string;
    endpoint_proxy_base?: string;
    api_base?: string;
    user_bearer_token?: string;
    wire_api?: 'chat' | 'responses';
    model?: string;
    notebook_mode?: boolean;
    task_inputs?: Array<{
      source_id?: string;
      filename?: string;
      file_type?: string;
      file_size?: number;
      ai_ready_status?: string;
    }>;
  };
};

type AgentMessage = {
  type?: string;
  request_id?: string;
  payload?: ServerStartPayload;
};

const wsUrl = process.env.MBOS_AGENT_WS_URL;
const key = process.env.MBOS_AGENT_KEY;
const codexBin = process.env.CODEX_BIN ?? 'codex';
const runnerDebug = process.env.MBOS_AGENT_RUNNER_DEBUG === '1';
const codexYolo = process.env.MBOS_AGENT_CODEX_YOLO === '1';
// Keep runner watchdog below api-entry-node's current per-request timeout (60s default)
// so the user sees a deterministic runner timeout instead of the generic runtime timeout.
const taskTimeoutSec = Math.max(5, Number(process.env.MBOS_AGENT_TASK_TIMEOUT_SEC ?? '55') || 55);

if (!wsUrl || !key) {
  process.stderr.write(
    'Usage: MBOS_AGENT_WS_URL=ws://... MBOS_AGENT_KEY=ask_xxx [CODEX_BIN=codex] npm run dev -w @mbos/agent-codex-runner\n',
  );
  process.exit(1);
}

const ws = new WebSocket(wsUrl, {
  headers: { Authorization: `Bearer ${key}` },
});

type RunningProcess = ChildProcessByStdio<null, Readable, Readable>;
const runningByRequestId = new Map<string, RunningProcess>();
const timeoutByRequestId = new Map<string, NodeJS.Timeout>();
const hardKillTimeoutByRequestId = new Map<string, NodeJS.Timeout>();
const timedOutRequestIds = new Set<string>();
const traceSeqByRequestId = new Map<string, number>();
const codexSessionReadyByCwd = new Set<string>();
const reportedArtifactsByCwd = new Map<string, Set<string>>();
type FilterStats = {
  stderr_superpowers_skill_missing: number;
  model_metadata_warning: number;
  delta_metadata_warning_event: number;
  delta_empty_error_shell: number;
};
const filterStatsByRequestId = new Map<string, FilterStats>();

function getFilterStats(requestId: string): FilterStats {
  let existing = filterStatsByRequestId.get(requestId);
  if (existing) return existing;
  existing = {
    stderr_superpowers_skill_missing: 0,
    model_metadata_warning: 0,
    delta_metadata_warning_event: 0,
    delta_empty_error_shell: 0,
  };
  filterStatsByRequestId.set(requestId, existing);
  return existing;
}

function sanitizePathPart(input: string | undefined, fallback: string): string {
  const value = (input ?? '').trim();
  if (!value) return fallback;
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || fallback;
}

function sendFrame(type: string, requestId: string, payload: Record<string, unknown>) {
  ws.send(
    JSON.stringify({
      type,
      request_id: requestId,
      timestamp: new Date().toISOString(),
      payload,
    }),
  );
}

function nextTraceSequence(requestId: string): number {
  const next = (traceSeqByRequestId.get(requestId) ?? 0) + 1;
  traceSeqByRequestId.set(requestId, next);
  return next;
}

function sendTraceEvent(
  requestId: string,
  event: {
    category: 'lifecycle' | 'progress' | 'tool' | 'artifact' | 'warning' | 'error' | 'debug';
    phase?: 'start' | 'update' | 'end';
    status?: 'running' | 'success' | 'error' | 'cancelled';
    name: string;
    summary: string;
    details?: Record<string, unknown>;
    raw?: string;
  },
): void {
  sendFrame('agent.response.event', requestId, {
    sequence: nextTraceSequence(requestId),
    at: new Date().toISOString(),
    ...event,
  });
}

function debugLog(message: string, extra?: Record<string, unknown>): void {
  if (!runnerDebug) return;
  const payload = extra ? ` ${JSON.stringify(extra)}` : '';
  process.stdout.write(`[agent-codex-runner][debug] ${message}${payload}\n`);
}

function clearRequestTimers(requestId: string): void {
  const timeout = timeoutByRequestId.get(requestId);
  if (timeout) {
    clearTimeout(timeout);
    timeoutByRequestId.delete(requestId);
  }
  const hardKill = hardKillTimeoutByRequestId.get(requestId);
  if (hardKill) {
    clearTimeout(hardKill);
    hardKillTimeoutByRequestId.delete(requestId);
  }
}

function extractPrompt(messages: Array<{ role?: string; content?: unknown }> | undefined): string {
  if (!messages || messages.length === 0) return '';
  const lastUser = [...messages].reverse().find((item) => item.role === 'user');
  const content = lastUser?.content;
  if (typeof content === 'string') return content;
  return JSON.stringify(content ?? '');
}

function maybeEmitDeltaChunk(requestId: string, chunk: string): void {
  const trimmed = sanitizeAgentDeltaChunk(chunk, requestId).replace(/\r/g, '');
  if (!trimmed.trim()) return;
  sendFrame('agent.response.delta', requestId, { delta: trimmed });
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function buildTaskCodexConfig(args: {
  model: string;
  endpointProxyBase: string;
  wireApi: 'responses' | 'chat';
  userBearerToken?: string;
}): string {
  const lines: string[] = [
    '# Generated by @mbos/agent-codex-runner for this task workspace.',
    '# Project-scoped Codex config loaded from <cwd>/.codex/config.toml',
    `model = ${tomlString(args.model)}`,
    'model_provider = "proxy"',
    '',
    '# Reduce unsupported built-in tool usage for OpenAI-compatible third-party providers.',
    'web_search = "disabled"',
    '# Keep notebook output compact; reasoning is still available in tool/provider responses when needed.',
    'hide_agent_reasoning = true',
    '',
    '[model_providers.proxy]',
    `name = ${tomlString('Proxy')}`,
    `base_url = ${tomlString(args.endpointProxyBase)}`,
    `wire_api = ${tomlString(args.wireApi)}`,
  ];
  if (args.userBearerToken && args.userBearerToken.trim().length > 0) {
    lines.push(`experimental_bearer_token = ${tomlString(args.userBearerToken)}`);
  }
  return `${lines.join('\n')}\n`;
}

function buildCodexExecArgs(args: {
  model: string;
  prompt: string;
  cwd: string;
  endpointProxyBase: string;
  wireApi: 'responses' | 'chat';
  userBearerToken?: string;
  resumeLast?: boolean;
}): string[] {
  const cliArgs = [
    'exec',
    '--skip-git-repo-check',
    '--json',
    '--model',
    args.model,
    '-c',
    'model_provider="proxy"',
    '-c',
    'model_providers.proxy.name="Proxy"',
    '-c',
    `model_providers.proxy.base_url=${JSON.stringify(args.endpointProxyBase)}`,
    '-c',
    `model_providers.proxy.wire_api=${JSON.stringify(args.wireApi)}`,
    // Treat the task cwd as project root even without .git, so project-scoped features
    // (.codex/, AGENTS.md) can be discovered for this ephemeral workspace.
    '-c',
    'project_root_markers=[]',
    // Codex only loads project-scoped config layers for trusted projects.
    '-c',
    `projects.${JSON.stringify(args.cwd)}.trust_level="trusted"`,
    '-c',
    'web_search="disabled"',
    '-c',
    'hide_agent_reasoning=true',
  ];
  if (codexYolo) {
    cliArgs.splice(1, 0, '--dangerously-bypass-approvals-and-sandbox');
  } else {
    cliArgs.splice(1, 0, '--full-auto');
  }
  if (args.userBearerToken && args.userBearerToken.trim().length > 0) {
    cliArgs.push(
      '-c',
      `model_providers.proxy.experimental_bearer_token=${JSON.stringify(args.userBearerToken)}`,
    );
  }
  if (args.resumeLast) {
    cliArgs.splice(1, 0, 'resume', '--last');
  }
  cliArgs.push(args.prompt);
  return cliArgs;
}

function buildNotebookHeadlessPreamble(args: {
  artifactsDir: string;
  taskInputsManifestPath: string;
  taskInputsCount: number;
}): string {
  return [
    'Notebook runtime policy (headless execution):',
    '- This environment is headless. Do not open GUI windows or interactive viewers.',
    '- Do not call blocking UI display operations such as matplotlib plt.show().',
    `- Save charts/images/files to the artifacts directory: ${args.artifactsDir}`,
    '- Put final textual conclusions in your response; put generated files in artifacts.',
    `- Task inputs metadata is available at: ${args.taskInputsManifestPath}`,
    `- Attached inputs count: ${String(args.taskInputsCount)}`,
    '',
    'Use attached inputs to complete the user request and mention generated artifact filenames in your final response.',
    '',
  ].join('\n');
}

function buildNotebookAgentsMd(): string {
  return [
    '# AGENTS.md (generated by @mbos/agent-codex-runner)',
    '',
    '## Notebook Runtime Rules (Mandatory)',
    '',
    '1. This task runs in a headless environment. Do not open GUI windows or interactive viewers.',
    '2. Do not call blocking display APIs (for example: matplotlib.pyplot.show()).',
    '3. Save generated files/charts/images into `./artifacts/`.',
    '4. Put final conclusions in the response message, and mention generated artifact filenames.',
    '5. Attached notebook inputs are described in `./.mbos/task-inputs.json`.',
    '6. Use the local notebook-inputs skill helper to fetch attached source files when needed.',
    '',
    '## Notebook Inputs Helper',
    '',
    '- List attached inputs:',
    '  - `node ./.codex/skills/notebook-inputs/fetch_input.mjs list`',
    '- Fetch a specific source by source_id into `./inputs/`:',
    '  - `node ./.codex/skills/notebook-inputs/fetch_input.mjs fetch <source_id>`',
    '',
    '## Output Convention',
    '',
    '- Text summary -> final response message',
    '- Files/images -> `./artifacts/` (system will collect these as notebook artifacts)',
    '',
  ].join('\n');
}

function buildNotebookInputsSkillMd(): string {
  return [
    '---',
    'name: notebook-inputs',
    'description: Fetch notebook task input files referenced by .mbos/task-inputs.json via MBOS API into ./inputs/.',
    '---',
    '',
    '# notebook-inputs',
    '',
    'Use this skill to inspect and fetch notebook task input files referenced in `./.mbos/task-inputs.json`.',
    '',
    '## Commands',
    '',
    '- List attached inputs:',
    '  - `node ./.codex/skills/notebook-inputs/fetch_input.mjs list`',
    '- Fetch one input by `source_id` (writes into `./inputs/`):',
    '  - `node ./.codex/skills/notebook-inputs/fetch_input.mjs fetch <source_id>`',
    '',
    '## Notes',
    '',
    '- The helper uses MBOS runtime env vars provided by the runner.',
    '- Downloaded files are stored locally under `./inputs/` for analysis.',
    '- Do not attempt GUI file pickers; this is a headless notebook runtime.',
    '',
  ].join('\n');
}

function buildNotebookInputsFetchScript(): string {
  return `#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

function reqEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(\`missing_env_\${name}\`);
  return v;
}

async function main() {
  const apiBase = reqEnv('MBOS_NOTEBOOK_API_BASE').replace(/\\/+$/, '');
  const workspaceId = reqEnv('MBOS_NOTEBOOK_WORKSPACE_ID');
  const projectId = reqEnv('MBOS_NOTEBOOK_PROJECT_ID');
  const token = reqEnv('MBOS_NOTEBOOK_USER_BEARER_TOKEN');
  const manifestPath = process.env.MBOS_NOTEBOOK_TASK_INPUTS_MANIFEST || './.mbos/task-inputs.json';
  const cmd = process.argv[2] || 'list';
  const sourceIdArg = process.argv[3];

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const inputs = Array.isArray(manifest.task_inputs) ? manifest.task_inputs : [];

  if (cmd === 'list') {
    process.stdout.write(JSON.stringify({ count: inputs.length, items: inputs }, null, 2) + '\\n');
    return;
  }

  if (cmd === 'fetch') {
    if (!sourceIdArg) throw new Error('source_id_required');
    const item = inputs.find((x) => x && x.source_id === sourceIdArg);
    if (!item) throw new Error('source_not_in_task_inputs');
    const res = await fetch(
      \`\${apiBase}/api/v1/workspaces/\${encodeURIComponent(workspaceId)}/projects/\${encodeURIComponent(projectId)}/sources/\${encodeURIComponent(sourceIdArg)}/download\`,
      { headers: { Authorization: \`Bearer \${token}\` } },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(\`source_download_failed_\${res.status}\${text ? ':' + text.slice(0, 200) : ''}\`);
    }
    const ab = await res.arrayBuffer();
    await mkdir('./inputs', { recursive: true });
    const filename = (typeof item.filename === 'string' && item.filename.trim()) ? item.filename.trim() : \`\${sourceIdArg}.bin\`;
    const outPath = join('./inputs', basename(filename));
    await writeFile(outPath, Buffer.from(ab));
    process.stdout.write(JSON.stringify({ source_id: sourceIdArg, path: outPath, bytes: ab.byteLength }, null, 2) + '\\n');
    return;
  }

  throw new Error('unsupported_command');
}

main().catch((err) => {
  process.stderr.write(String(err instanceof Error ? err.message : err) + '\\n');
  process.exit(1);
});
`;
}

async function prepareNotebookWorkspaceAssets(args: {
  cwd: string;
  runtimeContext: NonNullable<ServerStartPayload['runtime_context']>;
  taskInputs: Array<{
    source_id?: string;
    filename?: string;
    file_type?: string;
    file_size?: number;
    ai_ready_status?: string;
  }>;
}): Promise<{
  artifactsDir: string;
  taskInputsManifestPath: string;
}> {
  const { cwd, runtimeContext, taskInputs } = args;
  const artifactsDir = join(cwd, 'artifacts');
  const mbosDir = join(cwd, '.mbos');
  const codexSkillDir = join(cwd, '.codex', 'skills', 'notebook-inputs');
  await mkdir(artifactsDir, { recursive: true });
  await mkdir(mbosDir, { recursive: true });
  await mkdir(codexSkillDir, { recursive: true });
  const taskInputsManifestPath = join(mbosDir, 'task-inputs.json');
  await writeFile(
    taskInputsManifestPath,
    JSON.stringify(
      {
        task_id: runtimeContext.task_id ?? null,
        run_id: runtimeContext.run_id ?? null,
        generated_at: new Date().toISOString(),
        task_inputs: taskInputs.map((item) => ({
          source_id: typeof item?.source_id === 'string' ? item.source_id : undefined,
          filename: typeof item?.filename === 'string' ? item.filename : undefined,
          file_type: typeof item?.file_type === 'string' ? item.file_type : undefined,
          file_size: typeof item?.file_size === 'number' ? item.file_size : undefined,
          ai_ready_status: typeof item?.ai_ready_status === 'string' ? item.ai_ready_status : undefined,
        })),
      },
      null,
      2,
    ),
    'utf-8',
  );
  await writeFile(join(cwd, 'AGENTS.md'), buildNotebookAgentsMd(), 'utf-8');
  await writeFile(join(codexSkillDir, 'SKILL.md'), buildNotebookInputsSkillMd(), 'utf-8');
  const skillScriptPath = join(codexSkillDir, 'fetch_input.mjs');
  await writeFile(skillScriptPath, buildNotebookInputsFetchScript(), 'utf-8');
  try {
    await chmod(skillScriptPath, 0o755);
  } catch {
    // non-fatal on some filesystems
  }
  return { artifactsDir, taskInputsManifestPath };
}

type ScannedArtifact = {
  filename: string;
  task_relative_path: string;
  artifact_type: 'text' | 'image' | 'file' | 'other';
  mime_type?: string;
  file_size: number;
  title?: string;
  content?: string;
  thumbnail_url?: string;
  mtime_ms?: number;
};

const MAX_SCANNED_ARTIFACT_FILES = Math.max(1, Number(process.env.MBOS_AGENT_ARTIFACT_SCAN_MAX_FILES ?? '50') || 50);
const MAX_SCANNED_ARTIFACT_FILE_BYTES = Math.max(
  1024,
  Number(process.env.MBOS_AGENT_ARTIFACT_SCAN_MAX_FILE_BYTES ?? '10485760') || 10 * 1024 * 1024,
);
const MAX_INLINE_IMAGE_BYTES = Math.max(
  1024,
  Number(process.env.MBOS_AGENT_ARTIFACT_INLINE_IMAGE_MAX_BYTES ?? '2097152') || 2 * 1024 * 1024,
);
const MAX_TEXT_ARTIFACT_PREVIEW_BYTES = Math.max(
  256,
  Number(process.env.MBOS_AGENT_ARTIFACT_TEXT_PREVIEW_MAX_BYTES ?? '65536') || 64 * 1024,
);

function inferArtifactKind(filename: string): {
  artifactType: ScannedArtifact['artifact_type'];
  mimeType?: string;
  isText: boolean;
  isImage: boolean;
} {
  const ext = extname(filename).toLowerCase();
  const imageMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  };
  if (imageMap[ext]) return { artifactType: 'image', mimeType: imageMap[ext], isText: false, isImage: true };
  const textMap: Record<string, string> = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.log': 'text/plain',
    '.yaml': 'application/yaml',
    '.yml': 'application/yaml',
    '.html': 'text/html',
  };
  if (textMap[ext]) return { artifactType: 'text', mimeType: textMap[ext], isText: true, isImage: false };
  const fileMap: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
  };
  if (fileMap[ext]) return { artifactType: 'file', mimeType: fileMap[ext], isText: false, isImage: false };
  return { artifactType: 'file', isText: false, isImage: false };
}

async function scanArtifactsDirectory(cwd: string): Promise<ScannedArtifact[]> {
  const artifactsDir = join(cwd, 'artifacts');
  let entries: Dirent[];
  try {
    entries = await readdir(artifactsDir, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return [];
  }
  const out: ScannedArtifact[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (out.length >= MAX_SCANNED_ARTIFACT_FILES) break;
    const absPath = join(artifactsDir, entry.name);
    let fileStat;
    try {
      fileStat = await stat(absPath);
    } catch {
      continue;
    }
    if (!fileStat.isFile() || fileStat.size > MAX_SCANNED_ARTIFACT_FILE_BYTES) continue;
    const inferred = inferArtifactKind(entry.name);
    const artifact: ScannedArtifact = {
      filename: entry.name,
      task_relative_path: `artifacts/${entry.name}`,
      artifact_type: inferred.artifactType,
      ...(inferred.mimeType ? { mime_type: inferred.mimeType } : {}),
      file_size: fileStat.size,
      title: basename(entry.name),
      mtime_ms: fileStat.mtimeMs,
    };
    try {
      if (inferred.isImage && fileStat.size <= MAX_INLINE_IMAGE_BYTES && artifact.mime_type) {
        const imageBytes = await readFile(absPath);
        const dataUrl = `data:${artifact.mime_type};base64,${imageBytes.toString('base64')}`;
        artifact.content = dataUrl;
        artifact.thumbnail_url = dataUrl;
      } else if (inferred.isText) {
        const textBytes = await readFile(absPath);
        artifact.content = textBytes.subarray(0, MAX_TEXT_ARTIFACT_PREVIEW_BYTES).toString('utf-8');
      }
    } catch {
      // metadata-only fallback
    }
    out.push(artifact);
  }
  return out;
}

function artifactFingerprint(artifact: ScannedArtifact): string {
  return [
    artifact.task_relative_path,
    String(artifact.file_size ?? 0),
    String(Math.floor(artifact.mtime_ms ?? 0)),
  ].join('|');
}

function filterNewArtifactsForCwd(cwd: string, artifacts: ScannedArtifact[]): ScannedArtifact[] {
  let seen = reportedArtifactsByCwd.get(cwd);
  if (!seen) {
    seen = new Set<string>();
    reportedArtifactsByCwd.set(cwd, seen);
  }
  const next: ScannedArtifact[] = [];
  for (const artifact of artifacts) {
    const fp = artifactFingerprint(artifact);
    if (seen.has(fp)) continue;
    seen.add(fp);
    next.push(artifact);
  }
  return next;
}

const STDERR_FILTER_PATTERNS: RegExp[] = [
  // Optional local symlink from the user environment; harmless for our runner.
  /ERROR codex_core::skills::loader: failed to stat skills entry .*\/\.agents\/skills\/superpowers .*$/gim,
  // Codex local metadata registry does not know custom third-party model ids.
  /Model metadata for `[^`]+` not found\. Defaulting to fallback metadata; this can degrade performance and cause issues\./g,
];

const DELTA_FILTER_PATTERNS: RegExp[] = [
  // Codex may emit this warning as a structured stdout JSON event; remove the whole event chunk.
  /\{"type":"item\.completed","item":\{"id":"[^"]+","type":"error","message":"Model metadata for `[^`]+` not found\. Defaulting to fallback metadata; this can degrade performance and cause issues\."\}\}/g,
  // If a prior text-based filter removed the warning payload, remove the now-empty error event shell.
  /\{"type":"item\.completed","item":\{"id":"[^"]+","type":"error","message":""\}\}/g,
  ...STDERR_FILTER_PATTERNS,
];

function countMatches(pattern: RegExp, text: string): number {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  let count = 0;
  while (re.exec(text)) count += 1;
  return count;
}

function sanitizeAgentDeltaChunk(raw: string, requestId?: string): string {
  let text = raw;
  if (requestId) {
    const stats = getFilterStats(requestId);
    stats.delta_metadata_warning_event += countMatches(DELTA_FILTER_PATTERNS[0]!, text);
    stats.delta_empty_error_shell += countMatches(DELTA_FILTER_PATTERNS[1]!, text);
    stats.stderr_superpowers_skill_missing += countMatches(STDERR_FILTER_PATTERNS[0]!, text);
    stats.model_metadata_warning += countMatches(STDERR_FILTER_PATTERNS[1]!, text);
  }
  for (const pattern of DELTA_FILTER_PATTERNS) {
    text = text.replace(pattern, '');
  }
  return text;
}

function sanitizeStderrChunk(raw: string, requestId?: string): string {
  let text = sanitizeAgentDeltaChunk(raw, requestId);
  // Remove excessive blank lines introduced by filtering, but keep JSON chunks untouched.
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

function parseCodexJsonLine(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function maybeEmitTraceFromStdoutLine(requestId: string, line: string): void {
  const evt = parseCodexJsonLine(line);
  if (!evt) return;
  const type = evt.type;
  if (type !== 'thread.started'
    && type !== 'turn.started'
    && type !== 'turn.completed'
    && type !== 'turn.failed'
    && type !== 'error'
    && type !== 'item.completed') {
    return;
  }

  if (type === 'thread.started') {
    sendTraceEvent(requestId, {
      category: 'lifecycle',
      phase: 'start',
      status: 'running',
      name: 'codex.thread',
      summary: 'Codex thread started',
    });
    return;
  }
  if (type === 'turn.started') {
    sendTraceEvent(requestId, {
      category: 'progress',
      phase: 'start',
      status: 'running',
      name: 'codex.turn',
      summary: 'Agent turn started',
    });
    return;
  }
  if (type === 'turn.completed') {
    sendTraceEvent(requestId, {
      category: 'progress',
      phase: 'end',
      status: 'success',
      name: 'codex.turn',
      summary: 'Agent turn completed',
    });
    return;
  }
  if (type === 'turn.failed') {
    const errObj = typeof evt.error === 'object' && evt.error !== null ? (evt.error as Record<string, unknown>) : {};
    const message = typeof errObj.message === 'string' ? errObj.message : 'Agent turn failed';
    sendTraceEvent(requestId, {
      category: 'error',
      phase: 'end',
      status: 'error',
      name: 'codex.turn',
      summary: message,
      details: { message },
    });
    return;
  }
  if (type === 'error') {
    const message = typeof evt.message === 'string' ? evt.message : 'Codex error';
    sendTraceEvent(requestId, {
      category: 'error',
      phase: 'update',
      status: 'error',
      name: 'codex.error',
      summary: message,
      details: { message },
    });
    return;
  }
  const item = typeof evt.item === 'object' && evt.item !== null ? (evt.item as Record<string, unknown>) : {};
  if (item.type === 'agent_message') {
    sendTraceEvent(requestId, {
      category: 'progress',
      phase: 'end',
      status: 'success',
      name: 'codex.output',
      summary: 'Final response generated',
    });
    return;
  }
  if (item.type === 'function_call') {
    const toolName = typeof item.name === 'string' ? item.name : 'unknown';
    sendTraceEvent(requestId, {
      category: 'tool',
      phase: 'end',
      status: 'success',
      name: 'codex.tool',
      summary: `Tool call: ${toolName}`,
      details: {
        tool_name: toolName,
        ...(typeof item.arguments === 'string' ? { arguments: item.arguments } : {}),
      },
    });
  }
}

async function runCodexRequest(requestId: string, payload: ServerStartPayload): Promise<void> {
  const runtimeContext = payload.runtime_context ?? {};
  const taskId = sanitizePathPart(runtimeContext.task_id, `task_${requestId.slice(0, 8)}`);
  const username = sanitizePathPart(runtimeContext.username, 'unknown_user');
  const cwd = join('/tmp', username, taskId);
  await mkdir(cwd, { recursive: true });
  const isNotebookMode = runtimeContext.notebook_mode === true;
  const userPrompt = extractPrompt(payload.messages);
  const taskInputs = Array.isArray(runtimeContext.task_inputs) ? runtimeContext.task_inputs : [];
  let artifactsDir = join(cwd, 'artifacts');
  let taskInputsManifestPath = join(cwd, '.mbos', 'task-inputs.json');
  if (isNotebookMode) {
    const preparedAssets = await prepareNotebookWorkspaceAssets({
      cwd,
      runtimeContext,
      taskInputs,
    });
    artifactsDir = preparedAssets.artifactsDir;
    taskInputsManifestPath = preparedAssets.taskInputsManifestPath;
  }
  const prompt = isNotebookMode
    ? `${buildNotebookHeadlessPreamble({
      artifactsDir,
      taskInputsManifestPath,
      taskInputsCount: taskInputs.length,
    })}User request:\n${userPrompt}`
    : userPrompt;
  const endpointProxyBase = (runtimeContext.endpoint_proxy_base ?? '').replace(/\/+$/, '');
  // codex-cli >=0.104 no longer accepts wire_api=chat in provider config.
  const wireApi = 'responses';

  const model = runtimeContext.model ?? payload.model ?? 'gpt-5-codex';
  const resumeLast = isNotebookMode && codexSessionReadyByCwd.has(cwd);
  const codexConfigDir = join(cwd, '.codex');
  await mkdir(codexConfigDir, { recursive: true });
  await writeFile(
    join(codexConfigDir, 'config.toml'),
    buildTaskCodexConfig({
      model,
      endpointProxyBase,
      wireApi,
      userBearerToken: runtimeContext.user_bearer_token,
    }),
    'utf-8',
  );
  debugLog('prepared task workspace', {
    request_id: requestId,
    cwd,
    codex_config: join(codexConfigDir, 'config.toml'),
    model,
    wire_api: wireApi,
    endpoint_proxy_base: endpointProxyBase,
    has_user_bearer_token: Boolean(runtimeContext.user_bearer_token && runtimeContext.user_bearer_token.trim()),
    notebook_mode: isNotebookMode,
    task_inputs_count: taskInputs.length,
    artifacts_dir: isNotebookMode ? artifactsDir : null,
    resume_last: resumeLast,
  });

  const codexArgs = buildCodexExecArgs({
    model,
    prompt,
    cwd,
    endpointProxyBase,
    wireApi,
    userBearerToken: runtimeContext.user_bearer_token,
    resumeLast,
  });

  const child = spawn(
    codexBin,
    codexArgs,
    {
      cwd,
      env: {
        ...process.env,
        NO_COLOR: '1',
        ...(isNotebookMode ? {
          MBOS_NOTEBOOK_API_BASE: runtimeContext.api_base ?? '',
          MBOS_NOTEBOOK_WORKSPACE_ID: runtimeContext.workspace_id ?? '',
          MBOS_NOTEBOOK_PROJECT_ID: runtimeContext.project_id ?? '',
          MBOS_NOTEBOOK_USER_BEARER_TOKEN: runtimeContext.user_bearer_token ?? '',
          MBOS_NOTEBOOK_TASK_INPUTS_MANIFEST: './.mbos/task-inputs.json',
        } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  debugLog('spawned codex', {
    request_id: requestId,
    yolo: codexYolo,
    cmd: codexBin,
    argv: codexArgs.map((arg) => {
      if (arg === prompt) return '<prompt>';
      if (arg.includes('experimental_bearer_token=')) return 'model_providers.proxy.experimental_bearer_token="<redacted>"';
      return arg;
    }),
  });
  runningByRequestId.set(requestId, child);
  sendTraceEvent(requestId, {
    category: 'progress',
    phase: 'start',
    status: 'running',
    name: 'codex.exec',
    summary: 'Starting Codex execution',
    details: {
      model,
      wire_api: wireApi,
      yolo: codexYolo,
      notebook_mode: isNotebookMode,
      task_inputs_count: taskInputs.length,
      artifacts_dir: isNotebookMode ? 'artifacts/' : null,
    },
  });
  if (isNotebookMode) {
    sendTraceEvent(requestId, {
      category: 'progress',
      phase: 'start',
      status: 'running',
      name: 'runner.policy',
      summary: 'Notebook headless execution policy applied',
      details: {
        task_inputs_manifest: '.mbos/task-inputs.json',
        artifacts_dir: 'artifacts/',
      },
    });
  }

  const timeoutHandle = setTimeout(() => {
    if (child.exitCode !== null) return;
    timedOutRequestIds.add(requestId);
    debugLog('task watchdog timeout', {
      request_id: requestId,
      timeout_sec: taskTimeoutSec,
    });
    sendFrame('agent.response.error', requestId, {
      error_code: 'AGENT_TIMEOUT',
      error_message: `codex_task_timeout_${taskTimeoutSec}s`,
    });
    sendTraceEvent(requestId, {
      category: 'error',
      phase: 'end',
      status: 'error',
      name: 'codex.exec',
      summary: `Execution timeout (${taskTimeoutSec}s)`,
    });
    child.kill('SIGTERM');
    const hardKillHandle = setTimeout(() => {
      if (child.exitCode === null) {
        debugLog('task watchdog hard kill', { request_id: requestId });
        child.kill('SIGKILL');
      }
    }, 3_000);
    hardKillTimeoutByRequestId.set(requestId, hardKillHandle);
  }, taskTimeoutSec * 1000);
  timeoutByRequestId.set(requestId, timeoutHandle);

  let stdoutBuffer = '';
  child.stdout.on('data', (buffer: Buffer) => {
    stdoutBuffer += buffer.toString('utf-8');
    let idx = stdoutBuffer.indexOf('\n');
    while (idx >= 0) {
      const line = stdoutBuffer.slice(0, idx).trim();
      stdoutBuffer = stdoutBuffer.slice(idx + 1);
      if (line.length > 0) {
        maybeEmitTraceFromStdoutLine(requestId, line);
        maybeEmitDeltaChunk(requestId, line);
      }
      idx = stdoutBuffer.indexOf('\n');
    }
  });

  child.stderr.on('data', (buffer: Buffer) => {
    const text = sanitizeStderrChunk(buffer.toString('utf-8'), requestId);
    if (!text) return;
    sendTraceEvent(requestId, {
      category: text.includes('ERROR') ? 'error' : 'warning',
      phase: 'update',
      status: 'running',
      name: 'codex.stderr',
      summary: (text.split('\n')[0] ?? 'stderr').slice(0, 200),
      details: { stderr: text.slice(0, 4000) },
    });
    maybeEmitDeltaChunk(requestId, `[stderr] ${text}\n`);
  });

  child.on('error', (error) => {
    clearRequestTimers(requestId);
    runningByRequestId.delete(requestId);
    if (timedOutRequestIds.has(requestId)) {
      timedOutRequestIds.delete(requestId);
      traceSeqByRequestId.delete(requestId);
      filterStatsByRequestId.delete(requestId);
      return;
    }
    sendTraceEvent(requestId, {
      category: 'error',
      phase: 'end',
      status: 'error',
      name: 'codex.exec',
      summary: error.message,
    });
    sendFrame('agent.response.error', requestId, {
      error_code: 'AGENT_UPSTREAM_ERROR',
      error_message: error.message,
    });
    if (runnerDebug) {
      const stats = filterStatsByRequestId.get(requestId);
      if (stats) debugLog('filter stats', { request_id: requestId, ...stats });
    }
    filterStatsByRequestId.delete(requestId);
  });

  child.on('close', (code, signal) => {
    clearRequestTimers(requestId);
    debugLog('codex process closed', {
      request_id: requestId,
      code: code ?? null,
      signal: signal ?? null,
    });
    if (runnerDebug) {
      const stats = filterStatsByRequestId.get(requestId);
      if (stats) debugLog('filter stats', { request_id: requestId, ...stats });
    }
    runningByRequestId.delete(requestId);
    if (timedOutRequestIds.has(requestId)) {
      timedOutRequestIds.delete(requestId);
      traceSeqByRequestId.delete(requestId);
      filterStatsByRequestId.delete(requestId);
      return;
    }
    void (async () => {
      const artifacts = isNotebookMode ? filterNewArtifactsForCwd(cwd, await scanArtifactsDirectory(cwd)) : [];
      for (const artifact of artifacts) {
        sendTraceEvent(requestId, {
          category: 'artifact',
          phase: 'end',
          status: 'success',
          name: 'runner.artifact',
          summary: `Artifact discovered: ${artifact.filename}`,
          details: {
            filename: artifact.filename,
            path: artifact.task_relative_path,
            artifact_type: artifact.artifact_type,
            file_size: artifact.file_size,
            mtime_ms: artifact.mtime_ms,
          },
        });
        sendFrame('agent.response.artifact', requestId, artifact as unknown as Record<string, unknown>);
      }
      if (code === 0) {
        if (isNotebookMode) {
          codexSessionReadyByCwd.add(cwd);
        }
        sendTraceEvent(requestId, {
          category: 'progress',
          phase: 'end',
          status: 'success',
          name: 'codex.exec',
          summary: 'Codex execution completed',
        });
        sendFrame('agent.response.done', requestId, {
          finish_reason: 'stop',
          usage_tokens: Math.max(1, userPrompt.length),
        });
        traceSeqByRequestId.delete(requestId);
        filterStatsByRequestId.delete(requestId);
        return;
      }
      sendTraceEvent(requestId, {
        category: signal ? 'warning' : 'error',
        phase: 'end',
        status: signal ? 'cancelled' : 'error',
        name: 'codex.exec',
        summary: signal ? `Codex terminated (${signal})` : `Codex exited with code ${String(code ?? 'unknown')}`,
        details: {
          ...(signal ? { signal } : {}),
          ...(code !== null ? { exit_code: code } : {}),
        },
      });
      sendFrame('agent.response.error', requestId, {
        error_code: signal ? 'AGENT_CANCELLED' : 'AGENT_UPSTREAM_ERROR',
        error_message: signal ? `codex_terminated_${signal}` : `codex_exit_code_${String(code ?? 'unknown')}`,
      });
      if (isNotebookMode && !resumeLast && code !== null && code > 0) {
        // Keep first-run failures from incorrectly enabling resume for subsequent turns.
        codexSessionReadyByCwd.delete(cwd);
      }
      traceSeqByRequestId.delete(requestId);
      filterStatsByRequestId.delete(requestId);
    })().catch((error) => {
      sendTraceEvent(requestId, {
        category: 'warning',
        phase: 'update',
        status: 'running',
        name: 'runner.artifact_scan',
        summary: error instanceof Error ? error.message : 'artifact_scan_failed',
      });
      sendFrame('agent.response.error', requestId, {
        error_code: 'AGENT_UPSTREAM_ERROR',
        error_message: error instanceof Error ? error.message : 'artifact_scan_failed',
      });
      traceSeqByRequestId.delete(requestId);
      filterStatsByRequestId.delete(requestId);
    });
  });
}

ws.on('open', () => {
  process.stdout.write('[agent-codex-runner] connected\n');
  debugLog('websocket open', { ws_url: wsUrl });
  ws.send(
    JSON.stringify({
      type: 'agent.ready',
      timestamp: new Date().toISOString(),
      payload: {
        capabilities: {
          streaming_completion: true,
          multimodal_completion: false,
        },
        runtime: {
          executor: 'codex_cli',
          wire_api: 'responses',
        },
      },
    }),
  );
});

ws.on('message', (raw) => {
  let message: AgentMessage;
  try {
    message = JSON.parse(raw.toString('utf-8')) as AgentMessage;
  } catch {
    return;
  }

  if (message.type === 'server.ping') {
    ws.send(
      JSON.stringify({
        type: 'agent.pong',
        timestamp: new Date().toISOString(),
        payload: {},
      }),
    );
    return;
  }

  if (message.type === 'server.request.cancel' && message.request_id) {
    debugLog('received cancel', { request_id: message.request_id });
    const child = runningByRequestId.get(message.request_id);
    if (child && child.exitCode === null) {
      sendTraceEvent(message.request_id, {
        category: 'warning',
        phase: 'end',
        status: 'cancelled',
        name: 'codex.exec',
        summary: 'Execution cancelled by server',
      });
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
        }
      }, 3000);
    }
    clearRequestTimers(message.request_id);
    return;
  }

  if (message.type !== 'server.request.start' || !message.request_id || !message.payload) {
    return;
  }
  debugLog('received start', {
    request_id: message.request_id,
    model: message.payload.runtime_context?.model ?? message.payload.model ?? null,
    wire_api: message.payload.runtime_context?.wire_api ?? null,
    task_id: message.payload.runtime_context?.task_id ?? null,
  });

  void runCodexRequest(message.request_id, message.payload).catch((error) => {
    sendTraceEvent(message.request_id!, {
      category: 'error',
      phase: 'end',
      status: 'error',
      name: 'codex.exec',
      summary: error instanceof Error ? error.message : 'codex_request_failed',
    });
    sendFrame('agent.response.error', message.request_id!, {
      error_code: 'AGENT_UPSTREAM_ERROR',
      error_message: error instanceof Error ? error.message : 'codex_request_failed',
    });
  });
});

ws.on('close', () => {
  process.stdout.write('[agent-codex-runner] disconnected\n');
  for (const child of runningByRequestId.values()) {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
    }
  }
  runningByRequestId.clear();
  for (const requestId of timeoutByRequestId.keys()) {
    clearRequestTimers(requestId);
  }
  timedOutRequestIds.clear();
  traceSeqByRequestId.clear();
});

ws.on('error', (error) => {
  process.stderr.write(`[agent-codex-runner] error: ${error instanceof Error ? error.message : 'unknown'}\n`);
});
