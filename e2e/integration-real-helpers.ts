import { appendFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { expect, type Page } from '@playwright/test';
import { ensureWorkspaceProjectCreatorAccess, readStoredAuthToken } from './integration-workspace-access';

export const LOCALE = process.env.INTEGRATION_LOCALE ?? 'en-US';
export const API_BASE = process.env.INTEGRATION_API_BASE ?? 'http://localhost:20000';
export const GLM_BASE_URL = process.env.INTEGRATION_GLM_BASE_URL ?? 'https://open.bigmodel.cn/api/anthropic';
export const GLM_MODEL = process.env.INTEGRATION_GLM_MODEL ?? 'GLM-5';
export const DOCKER_BUILD_PROXY = process.env.INTEGRATION_DOCKER_BUILD_PROXY ?? 'http://192.168.0.210:8889';
export const INTERNAL_AGENT_IMAGE = process.env.INTEGRATION_INTERNAL_AGENT_IMAGE?.trim() || 'agentsmith-codex-runner:local';
export const KEYCLOAK_DEV_ADMIN_USERNAME = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
export const KEYCLOAK_DEV_ADMIN_PASSWORD = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

async function collectChildPids(pid: number): Promise<number[]> {
  return new Promise((resolve) => {
    const child = spawn('pgrep', ['-P', String(pid)], { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf-8');
    });
    child.once('error', () => resolve([]));
    child.once('close', () => {
      const pids = stdout
        .split(/\s+/)
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value) && value > 0);
      resolve(pids);
    });
  });
}

async function killProcessTree(pid: number, signal: NodeJS.Signals): Promise<void> {
  const children = await collectChildPids(pid);
  for (const childPid of children) {
    await killProcessTree(childPid, signal);
  }
  try {
    process.kill(pid, signal);
  } catch {
    // Process already exited.
  }
}

async function unmountWorkspaceTree(root: string): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    const mountPath = path.join(root, entry);
    await new Promise<void>((resolve) => {
      const proc = spawn('juicefs', ['umount', mountPath], { stdio: 'ignore' });
      proc.once('error', () => resolve());
      proc.once('exit', () => resolve());
      setTimeout(() => resolve(), 5_000);
    });
  }
}

async function unmountSingleWorkspace(mountPath: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const proc = spawn('juicefs', ['umount', mountPath], { stdio: 'ignore' });
    proc.once('error', () => resolve());
    proc.once('exit', () => resolve());
    setTimeout(() => resolve(), 5_000);
  });
}

async function spawnAndCapture(command: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options?.cwd,
      env: options?.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf-8');
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf-8');
    });
    proc.once('error', reject);
    proc.once('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

async function clearAppState(page: Page, workspaceId: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto(`/${LOCALE}/workspaces/${workspaceId}/login`);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

async function gotoWithRetry(page: Page, path: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.readyState === 'interactive' || document.readyState === 'complete');
      if (page.url() === 'about:blank') {
        throw new Error('blank_navigation');
      }
      const bodyText = await page.locator('body').textContent().catch(() => '');
      if ((bodyText ?? '').trim().length === 0) {
        throw new Error('empty_document');
      }
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if ((!message.includes('ERR_ABORTED') && !message.includes('blank_navigation') && !message.includes('empty_document')) || attempt === 2) {
        throw error;
      }
      await page.waitForTimeout(500);
    }
  }
}

export async function keycloakLoginToWorkspace(
  page: Page,
  workspaceId: string,
  username = KEYCLOAK_DEV_ADMIN_USERNAME,
  password = KEYCLOAK_DEV_ADMIN_PASSWORD,
): Promise<void> {
  await clearAppState(page, workspaceId);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/login`);
    await expect(page.getByTestId('workspace-login__keycloak-btn')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('workspace-login__keycloak-btn').click();
    const keycloakError = page.getByTestId('workspace-login__keycloak-error');
    if (await keycloakError.isVisible({ timeout: 3_000 }).catch(() => false)) {
      throw new Error(`Keycloak login bootstrap failed: ${await keycloakError.textContent()}`);
    }

    let enteredKeycloakForm = false;
    for (let tick = 0; tick < 60; tick += 1) {
      const currentUrl = page.url();
      if (/\/realms\/.+\/protocol\/openid-connect\/auth|\/login-actions\/authenticate/i.test(currentUrl)) {
        enteredKeycloakForm = true;
        break;
      }
      if (new RegExp(`/${LOCALE}/workspaces/${workspaceId}(?:$|/login/callback|/projects|/settings)`).test(currentUrl)) {
        break;
      }
      await page.waitForTimeout(500);
    }

    if (enteredKeycloakForm) {
      await page.locator('input#username, input[name="username"], input[name="email"]').first().fill(username);
      await page.locator('input#password, input[name="password"]').first().fill(password);
      await page.locator('#kc-login, button[type="submit"]').first().click();
    }

    let reachedWorkspace = false;
    let callbackError = false;
    for (let tick = 0; tick < 120; tick += 1) {
      const currentUrl = page.url();
      if (new RegExp(`/${LOCALE}/workspaces/${workspaceId}(?:$|/projects|/settings)`).test(currentUrl)) {
        reachedWorkspace = true;
        break;
      }
      if (new RegExp(`/${LOCALE}/workspaces/${workspaceId}/login/callback`).test(currentUrl)) {
        const errorNode = page.getByTestId('workspace-login-callback__error');
        if (await errorNode.isVisible({ timeout: 300 }).catch(() => false)) {
          callbackError = true;
          break;
        }
      }
      await page.waitForTimeout(500);
    }

    if (reachedWorkspace) {
      const token = await readStoredAuthToken(page);
      await ensureWorkspaceProjectCreatorAccess({ page, apiBase: API_BASE, token, username });
      await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects`);
      await page.waitForURL(new RegExp(`/${LOCALE}/workspaces/${workspaceId}/projects(?:$|/)`), { timeout: 30_000 });
      return;
    }

    if (callbackError && attempt < 2) {
      await clearAppState(page, workspaceId);
      continue;
    }

    throw new Error(`workspace_login_failed:${workspaceId}:${username}`);
  }

  throw new Error(`workspace_login_retry_exhausted:${workspaceId}:${username}`);
}

export async function createProjectInWorkspace(
  page: Page,
  workspaceId: string,
  prefix = 'Real Integration Project',
): Promise<{ projectId: string; projectName: string }> {
  const projectName = `${prefix} ${Date.now()}`;
  await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects`);
  await expect(page.getByTestId('projects__create-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('projects__create-btn').click();
  await page.locator('#project-name').fill(projectName);
  await Promise.all([
    page.waitForURL(new RegExp(`/${LOCALE}/workspaces/${workspaceId}/projects/.+/overview`), { timeout: 30_000 }),
    page.getByRole('button', { name: /Create|创建/i }).click(),
  ]);
  const match = page.url().match(/\/projects\/([^/]+)\//);
  if (!match?.[1]) {
    throw new Error('project_id_not_found_after_create');
  }
  return { projectId: match[1], projectName };
}

export async function createCredentialViaUi(
  page: Page,
  workspaceId: string,
  projectId: string,
  credentialName: string,
  credentialValue: string,
): Promise<string> {
  await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/credentials`);
  await expect(page.getByTestId('credentials__create-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('credentials__create-btn').click();
  const dialog = page.getByTestId('credentials__create-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#cred-name').fill(credentialName);
  await dialog.locator('#cred-value').fill(credentialValue);
  const createResponse = page.waitForResponse((res) =>
    res.request().method() === 'POST'
    && new RegExp(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/credentials$`).test(res.url()),
  );
  await dialog.getByRole('button', { name: /create|创建/i }).click();
  const response = await createResponse;
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json().catch(() => null)) as { id?: string; data?: { id?: string } } | null;
  const credentialId = payload?.id ?? payload?.data?.id;
  expect(credentialId).toBeTruthy();
  await expect(page.getByText(credentialName)).toBeVisible({ timeout: 30_000 });
  return credentialId!;
}

export async function createEndpointViaApi(
  page: Page,
  workspaceId: string,
  projectId: string,
  args: {
    endpointName: string;
    endpointModel: string;
    upstreamBaseUrl: string;
    credentialName: string;
    capability?: 'chat_completion' | 'multimodal_completion';
  },
): Promise<string> {
  const token = await readStoredAuthToken(page);
  const capability = args.capability ?? 'chat_completion';
  const normalizedBaseUrl = args.upstreamBaseUrl.trim().toLowerCase();
  const useAnthropicCompat = normalizedBaseUrl.includes('/anthropic') || normalizedBaseUrl.includes('api.anthropic.com');
  const credentialsRes = await page.request.get(
    `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/credentials`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(credentialsRes.ok()).toBeTruthy();
  const credentialsJson = (await credentialsRes.json().catch(() => null)) as
    | { items?: Array<{ id?: string; name?: string }> }
    | null;
  const credential = credentialsJson?.items?.find((item) => item.name === args.credentialName);
  expect(credential?.id).toBeTruthy();

  const defaults =
    capability === 'multimodal_completion'
      ? { multimodal_model_id: args.endpointModel }
      : { chat_model_id: args.endpointModel };

  const endpointRes = await page.request.post(
    `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: args.endpointName,
        model: args.endpointModel,
        type: useAnthropicCompat ? 'anthropic' : 'openai',
        base_url: args.upstreamBaseUrl,
        credential_ref: credential!.id,
        provider_family: useAnthropicCompat ? 'anthropic' : 'openai',
        protocol: useAnthropicCompat ? 'anthropic_compatible' : 'openai_compatible',
        capabilities: [{ type: capability, enabled: true, default_model_id: args.endpointModel }],
        models: [{ capability, model_id: args.endpointModel, display_name: args.endpointModel }],
        defaults,
        meta: { compatibility_interface: useAnthropicCompat ? 'anthropic_compatible' : 'openai_compatible' },
      },
    },
  );
  expect(endpointRes.ok()).toBeTruthy();
  const endpointJson = (await endpointRes.json().catch(() => null)) as { id?: string; data?: { id?: string } } | null;
  const endpointId = endpointJson?.id ?? endpointJson?.data?.id;
  expect(endpointId).toBeTruthy();
  return endpointId!;
}

export async function createExternalCodexAgentBundle(
  page: Page,
  args: {
    workspaceId: string;
    projectId: string;
    endpointId: string;
    title: string;
    multimodal?: boolean;
    sessionModel?: string;
  },
): Promise<{ agentId: string; agentName: string; wsUrl: string; agentKey: string; sessionId: string }> {
  const token = await readStoredAuthToken(page);
  const agentName = `${args.title}-${Date.now()}`;
  const createAgentRes = await page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/agents`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: agentName,
        mode: 'external',
        interaction_mode: 'both',
        execution_preferences: {
          chat: {
            endpoint_id: args.endpointId,
            wire_api: 'responses',
            model: GLM_MODEL,
          },
          notebook: {
            endpoint_id: args.endpointId,
            wire_api: 'responses',
            model: GLM_MODEL,
          },
        },
        capabilities: {
          streaming_completion: true,
          multimodal_completion: args.multimodal ?? false,
          accepted_mime_types: ['image/png', 'image/jpeg', 'image/webp', 'text/plain'],
          max_file_count: 8,
          max_total_bytes: 62_914_560,
        },
      },
    },
  );
  expect(createAgentRes.ok()).toBeTruthy();
  const createdAgent = (await createAgentRes.json()) as { id: string };

  const createKeyRes = await page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/agents/${createdAgent.id}/keys`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {},
    },
  );
  expect(createKeyRes.ok()).toBeTruthy();
  const keyPayload = (await createKeyRes.json()) as { key: string };

  const connectionRes = await page.request.get(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/agents/${createdAgent.id}/connection-info`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  expect(connectionRes.ok()).toBeTruthy();
  const connectionInfo = (await connectionRes.json()) as { ws_url: string };

  const createSessionRes = await page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/chat/sessions`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        title: args.title,
        model: args.sessionModel ?? GLM_MODEL,
        external_agent_id: createdAgent.id,
      },
    },
  );
  expect(createSessionRes.ok()).toBeTruthy();
  const session = (await createSessionRes.json()) as { id: string };

  return {
    agentId: createdAgent.id,
    agentName,
    wsUrl: connectionInfo.ws_url.replace('ws://localhost:20000', API_BASE.replace('http://', 'ws://')),
    agentKey: keyPayload.key,
    sessionId: session.id,
  };
}

export async function createInternalCodexAgent(
  page: Page,
  args: {
    workspaceId: string;
    projectId: string;
    endpointId: string;
    title: string;
    image?: string;
  },
): Promise<{ agentId: string; agentName: string }> {
  const token = await readStoredAuthToken(page);
  const agentName = `${args.title}-${Date.now()}`;
  const createAgentRes = await page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/agents`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: agentName,
        mode: 'internal',
        interaction_mode: 'notebook',
        execution_preferences: {
          notebook: {
            endpoint_id: args.endpointId,
            wire_api: 'responses',
            model: GLM_MODEL,
          },
        },
        config: {
          image: args.image?.trim() || INTERNAL_AGENT_IMAGE,
          endpoint_id: args.endpointId,
          cpu_request: '500m',
          cpu_limit: '2',
          memory_request: '512Mi',
          memory_limit: '4Gi',
          idle_timeout_sec: 180,
          max_lifetime_sec: 3600,
        },
        capabilities: {
          streaming_completion: true,
        },
      },
    },
  );
  expect(createAgentRes.ok()).toBeTruthy();
  const createdAgent = (await createAgentRes.json()) as { id: string };
  expect(createdAgent.id).toBeTruthy();
  return {
    agentId: createdAgent.id,
    agentName,
  };
}

export async function deleteInternalWorkloadViaManager(args: {
  workspaceId: string;
  projectId: string;
  workloadId: string;
}): Promise<void> {
  const managerBase = process.env.SANDBOX_MANAGER_URL?.trim();
  const serviceKey = process.env.SANDBOX_SERVICE_KEY?.trim();
  if (!managerBase || !serviceKey) {
    throw new Error('sandbox_manager_env_missing');
  }
  const response = await fetch(
    `${managerBase.replace(/\/+$/, '')}/v1/workspaces/${encodeURIComponent(args.workspaceId)}/projects/${encodeURIComponent(args.projectId)}/workloads/${encodeURIComponent(args.workloadId)}`,
    {
      method: 'DELETE',
      headers: {
        'X-Service-Key': serviceKey,
      },
    },
  );
  if (!response.ok && response.status !== 404) {
    const body = await response.text().catch(() => '');
    throw new Error(`delete_internal_workload_failed:${response.status}:${body}`);
  }
}

export async function waitForAgentPresenceOnline(
  page: Page,
  workspaceId: string,
  projectId: string,
  agentId: string,
): Promise<void> {
  const token = await readStoredAuthToken(page);
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/agents/${agentId}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!response.ok()) return null;
        const body = (await response.json()) as { presence?: string };
        return body.presence ?? null;
      },
      { timeout: 30_000 },
    )
    .toBe('online');
}

export async function openChatSession(
  page: Page,
  workspaceId: string,
  projectId: string,
  expectedTitle: string,
): Promise<void> {
  await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/chat`);
  await expect(page.getByTestId('chat__main-pane')).toBeVisible({ timeout: 30_000 });
  const target = page.getByTestId('chat__thread-item').filter({ hasText: expectedTitle }).first();
  await expect(target).toBeVisible({ timeout: 30_000 });
  await target.click();
  const composer = page.getByTestId('chat__composer').locator('textarea');
  await expect(composer).toBeVisible({ timeout: 30_000 });
}

export async function startCodexRunnerProcess(args: {
  wsUrl: string;
  agentKey: string;
  codeBin?: string;
}): Promise<{
  proc: ChildProcessWithoutNullStreams;
  logPath: string;
  workspaceRoot: string;
  stop: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const logPath = path.join(tmpdir(), `agentsmith-codex-runner-${Date.now()}.log`);
    const workspaceRoot = path.join(tmpdir(), `agentsmith-codex-workspaces-${Date.now()}`);
    const proc = spawn(
      'npm',
      ['run', 'agent:codex-runner'],
      {
        env: {
          ...process.env,
          MBOS_AGENT_WS_URL: args.wsUrl,
          MBOS_AGENT_KEY: args.agentKey,
          MBOS_AGENT_CODEX_YOLO: '1',
          MBOS_AGENT_RUNNER_DEBUG: '1',
          MBOS_AGENT_WORKSPACE_ROOT: workspaceRoot,
          ...(args.codeBin ? { CODEX_BIN: args.codeBin } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stderr = '';
    let resolved = false;
    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`codex_runner_start_timeout:${stderr.slice(-500)}:log=${logPath}`));
    }, 30_000);

    const onStdout = (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      void appendFile(logPath, text, 'utf-8');
      if (!resolved && text.includes('[agent-codex-runner] connected')) {
        resolved = true;
        clearTimeout(timeout);
        resolve({
          proc,
          logPath,
          workspaceRoot,
          stop: async () => {
            if (!proc.killed && proc.exitCode === null) {
              await killProcessTree(proc.pid, 'SIGTERM');
              await new Promise<void>((done) => {
                const killTimeout = setTimeout(() => {
                  if (!proc.killed && proc.exitCode === null) {
                    void killProcessTree(proc.pid, 'SIGKILL');
                  }
                  done();
                }, 5_000);
                proc.once('exit', () => {
                  clearTimeout(killTimeout);
                  done();
                });
              });
            }
            await unmountWorkspaceTree(workspaceRoot);
            await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
          },
        });
      }
    };

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf-8');
      stderr += text;
      void appendFile(logPath, text, 'utf-8');
    });

    proc.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    proc.once('exit', (code) => {
      clearTimeout(timeout);
      if (!resolved && code !== 0) {
        reject(new Error(`codex_runner_exit_${String(code)}:${stderr.slice(-500)}:log=${logPath}`));
      }
    });

    proc.stdout.on('data', onStdout);
  });
}

export async function startCodexRunnerDockerProcess(args: {
  wsUrl: string;
  agentKey: string;
  codeBin?: string;
}): Promise<{
  containerName: string;
  workspaceRoot: string;
  imageTag: string;
  stop: () => Promise<void>;
}> {
  const imageTag = process.env.INTEGRATION_CODEX_RUNNER_DOCKER_IMAGE?.trim() || 'agentsmith-codex-runner:local';
  const buildContext = path.resolve(__dirname, '..');
  const dockerfile = path.join(buildContext, 'infra/runner/Dockerfile.agent-codex-runner');
  const inspectResult = await spawnAndCapture('docker', ['image', 'inspect', imageTag]);
  if (inspectResult.code !== 0) {
    const buildArgs = ['build'];
    if (DOCKER_BUILD_PROXY.trim()) {
      buildArgs.push('--build-arg', `HTTP_PROXY=${DOCKER_BUILD_PROXY.trim()}`);
      buildArgs.push('--build-arg', `HTTPS_PROXY=${DOCKER_BUILD_PROXY.trim()}`);
      buildArgs.push('--build-arg', `NO_PROXY=127.0.0.1,localhost,host.docker.internal`);
    }
    buildArgs.push('-f', dockerfile, '-t', imageTag, '.');
    const buildResult = await spawnAndCapture('docker', buildArgs, { cwd: buildContext });
    if (buildResult.code !== 0) {
      throw new Error(`docker_runner_image_build_failed:${buildResult.stderr.slice(-800)}`);
    }
  }

  const workspaceRoot = path.join(tmpdir(), `agentsmith-codex-docker-workspaces-${Date.now()}`);
  await mkdir(workspaceRoot, { recursive: true });
  const containerName = `agentsmith-codex-runner-${Date.now()}`;
  const runArgs = [
    'run',
    '--detach',
    '--rm',
    '--name',
    containerName,
    '--network',
    'host',
    '--privileged',
    '--device',
    '/dev/fuse',
    '--security-opt',
    'apparmor:unconfined',
    '--env',
    `MBOS_AGENT_WS_URL=${args.wsUrl}`,
    '--env',
    `MBOS_AGENT_KEY=${args.agentKey}`,
    '--env',
    'MBOS_AGENT_CODEX_YOLO=1',
    '--env',
    'MBOS_AGENT_RUNNER_DEBUG=1',
    '--env',
    'MBOS_AGENT_WORKSPACE_ROOT=/workspace/ags-workspaces',
    '--env',
    'MBOS_AGENT_BUILTIN_SKILLS_DIR=/app/packages/agent-codex-runner/builtin-skills',
    '--env',
    'MBOS_AGENT_BUILTIN_SKILLS=.system,feishu-docs,jira-ops,file-read',
    '--env',
    'MBOS_AGENT_BUILTIN_SKILLS_REQUIRED=1',
    '--volume',
    `${buildContext}:/app`,
    '--volume',
    `${workspaceRoot}:/workspace/ags-workspaces:rshared`,
  ];
  if (args.codeBin) {
    runArgs.push('--env', `CODEX_BIN=${args.codeBin}`);
  }
  runArgs.push(imageTag);

  const runResult = await spawnAndCapture('docker', runArgs);
  if (runResult.code !== 0) {
    throw new Error(`docker_runner_start_failed:${runResult.stderr.slice(-800)}`);
  }

  const started = (runResult.stdout || '').trim();
  if (!started) {
    throw new Error('docker_runner_start_missing_container_id');
  }

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const logs = await spawnAndCapture('docker', ['logs', containerName]);
    if (`${logs.stdout}\n${logs.stderr}`.includes('[agent-codex-runner] connected')) {
      return {
        containerName,
        workspaceRoot,
        imageTag,
        stop: async () => {
          await spawnAndCapture('docker', ['rm', '-f', containerName]);
          await unmountWorkspaceTree(workspaceRoot);
          await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
        },
      };
    }
    const inspectRunning = await spawnAndCapture('docker', ['inspect', '-f', '{{.State.Running}}', containerName]);
    if (inspectRunning.code !== 0 || !inspectRunning.stdout.includes('true')) {
      throw new Error(`docker_runner_exit:${logs.stderr.slice(-800)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  const logs = await spawnAndCapture('docker', ['logs', containerName]);
  await spawnAndCapture('docker', ['rm', '-f', containerName]);
  throw new Error(`docker_runner_connect_timeout:${`${logs.stdout}\n${logs.stderr}`.slice(-1200)}`);
}

export async function mountFileLibraryLocally(metadataUrl: string): Promise<{
  mountPath: string;
  stop: () => Promise<void>;
}> {
  const mountPath = await mkdtemp(path.join(tmpdir(), 'agentsmith-real-file-library-'));
  const mountResult = await spawnAndCapture('juicefs', ['mount', metadataUrl, mountPath, '-d']);
  if (mountResult.code !== 0) {
    await rm(mountPath, { recursive: true, force: true }).catch(() => undefined);
    throw new Error(`local_juicefs_mount_failed:${mountResult.stderr.slice(-800)}`);
  }
  return {
    mountPath,
    stop: async () => {
      await unmountSingleWorkspace(mountPath);
      await rm(mountPath, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

export async function createFileLibraryViaUi(
  page: Page,
  workspaceId: string,
  projectId: string,
  name: string,
): Promise<string> {
  await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/files`);
  await expect(page.getByTestId('files__library-create')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('files__library-create').click();
  const dialog = page.getByTestId('files__dialog__library-create');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('files__library-create__name').fill(name);
  await dialog.getByTestId('files__library-create__submit').click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  const libraryItem = page.locator('[data-testid^="files__library-item--"]').filter({ hasText: name }).first();
  await expect(libraryItem).toBeVisible({
    timeout: 30_000,
  });
  const libraryId = (await libraryItem.getAttribute('data-testid'))?.replace('files__library-item--', '');
  if (!libraryId) {
    throw new Error(`file_library_id_not_found:${name}`);
  }
  return libraryId;
}

export async function openMountAccessAndRevealMetadataUrl(
  page: Page,
  libraryName: string,
): Promise<string> {
  const libraryItem = page.locator('[data-testid^="files__library-item--"]').filter({ hasText: libraryName }).first();
  await expect(libraryItem).toBeVisible({ timeout: 30_000 });
  const mountButton = libraryItem.locator('[data-testid^="files__library-mount-access--"]').first();
  await mountButton.click({ force: true });
  const dialog = page.getByTestId('files__dialog__library-mount-access');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole('button', { name: /reveal|显示|show/i }).click();
  const metadataInput = dialog.getByTestId('files__library-mount__metadata-url');
  await expect(metadataInput).not.toHaveValue(/••••/);
  return (await metadataInput.inputValue()).trim();
}

export async function createTempMountDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export async function mountJuiceFs(metadataUrl: string, mountPoint: string): Promise<() => Promise<void>> {
  await mkdir(mountPoint, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      'juicefs',
      ['mount', metadataUrl, mountPoint, '-d', '--attr-cache', '0', '--entry-cache', '0', '--dir-entry-cache', '0'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf-8');
    });
    proc.once('error', reject);
    proc.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`juicefs_mount_failed_${String(code)}:${stderr.slice(-500)}`));
        return;
      }
      resolve();
    });
    setTimeout(() => resolve(), 5_000);
  });

  return async () => {
    await new Promise<void>((resolve) => {
      const proc = spawn('juicefs', ['umount', mountPoint], { stdio: 'ignore' });
      proc.once('error', () => resolve());
      proc.once('exit', () => resolve());
      setTimeout(() => resolve(), 5_000);
    });
    await rm(mountPoint, { recursive: true, force: true });
  };
}

export async function writeMountedFile(mountPoint: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = path.join(mountPoint, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf-8');
}
