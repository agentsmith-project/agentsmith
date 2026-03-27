import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  API_BASE,
  INTERNAL_AGENT_IMAGE,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  BACKEND_REAL_ANTHROPIC_BASE_URL,
  BACKEND_REAL_MODEL,
  createCredentialViaUi,
  createEndpointViaApi,
  createFileLibraryViaUi,
  createInternalCodexAgent,
  createProjectInWorkspace,
  deleteInternalWorkloadViaManager,
  keycloakLoginToWorkspace,
  mountFileLibraryLocally,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';

const INTERNAL_VISUAL_ARTIFACT_DIR = process.env.INTERNAL_REAL_VISUAL_ARTIFACT_DIR?.trim()
  ? path.resolve(process.env.INTERNAL_REAL_VISUAL_ARTIFACT_DIR)
  : path.resolve(`artifacts/backend-real-visual/internal-${Date.now()}`);
const INTERNAL_CLIENT_MOUNT_OVERRIDES = {
  metadataHostOverride: process.env.INTEGRATION_CLIENT_JUICEFS_META_HOST_OVERRIDE?.trim() || undefined,
  metadataPortOverride: process.env.INTEGRATION_CLIENT_JUICEFS_META_PORT_OVERRIDE?.trim() || undefined,
  storageEndpointOverride: process.env.INTEGRATION_CLIENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE?.trim() || undefined,
} as const;

type CaptureEntry = {
  name: string;
  path: string;
  notes: string;
  route: string;
};

function requireInternalSandboxEnv(): void {
  if (!process.env.SANDBOX_MANAGER_URL?.trim()) {
    throw new Error('missing_SANDBOX_MANAGER_URL');
  }
  if (!process.env.SANDBOX_SERVICE_KEY?.trim()) {
    throw new Error('missing_SANDBOX_SERVICE_KEY');
  }
  if (!process.env.INTERNAL_AGENT_K8S_NAMESPACE?.trim()) {
    throw new Error('missing_INTERNAL_AGENT_K8S_NAMESPACE');
  }
}

function requireRealLaneApiKey(): string {
  const value = process.env.BACKEND_REAL_API_KEY?.trim();
  if (!value) {
    throw new Error('missing_BACKEND_REAL_API_KEY');
  }
  return value;
}

function sanitizeWorkloadId(id: string): string {
  const normalized = id
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  return normalized || 'workload';
}

async function createNotebookTaskViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  title: string;
  agentId: string;
  fileLibraryId: string;
}): Promise<string> {
  const token = await readStoredAuthToken(args.page);
  const response = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        title: args.title,
        agent_id: args.agentId,
        workspace_file_library_id: args.fileLibraryId,
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json().catch(() => null)) as { id?: string; data?: { id?: string } } | null;
  const taskId = payload?.id ?? payload?.data?.id;
  expect(taskId).toBeTruthy();
  return taskId!;
}

async function waitForAssistantToken(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  token: string;
  minAgentMessages?: number;
}): Promise<void> {
  const authToken = await readStoredAuthToken(args.page);
  await expect
    .poll(
      async () => {
        const response = await args.page.request.get(
          `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/messages`,
          { headers: { Authorization: `Bearer ${authToken}` } },
        );
        if (!response.ok()) return false;
        const payload = (await response.json()) as Array<{ role?: string; content?: string }>;
        const agentMessages = payload.filter((item) => item.role === 'agent');
        if (agentMessages.length < (args.minAgentMessages ?? 1)) return false;
        return agentMessages.some((item) => item.content?.includes(args.token));
      },
      { timeout: 300_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe(true);
}

async function waitForAssistantTokenOrArtifact(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  token: string;
  artifactPath: string;
  minAgentMessages?: number;
}): Promise<void> {
  const authToken = await readStoredAuthToken(args.page);
  await expect
    .poll(
      async () => {
        const [messageHasToken, artifactContent] = await Promise.all([
          (async () => {
            const response = await args.page.request.get(
              `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/messages`,
              { headers: { Authorization: `Bearer ${authToken}` } },
            );
            if (!response.ok()) return false;
            const payload = (await response.json()) as Array<{ role?: string; content?: string }>;
            const agentMessages = payload.filter((item) => item.role === 'agent');
            if (agentMessages.length < (args.minAgentMessages ?? 1)) return false;
            return agentMessages.some((item) => item.content?.includes(args.token));
          })(),
          readFile(args.artifactPath, 'utf-8').catch(() => null),
        ]);
        return messageHasToken || artifactContent?.includes(args.token) === true;
      },
      { timeout: 300_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe(true);
}

async function sendTaskMessage(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  content: string;
}): Promise<void> {
  const token = await readStoredAuthToken(args.page);
  const response = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/messages`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        role: 'user',
        content: args.content,
      },
    },
  );
  expect(response.ok()).toBeTruthy();
}

async function openFileLibraryRoot(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryName: string;
}): Promise<void> {
  const { page, workspaceId, projectId, libraryName } = args;
  await page.goto(`/en-US/workspaces/${workspaceId}/projects/${projectId}/files`);
  const libraryItem = page.locator('[data-testid^="files__library-item--"]').filter({ hasText: libraryName }).first();
  await expect(libraryItem).toBeVisible({ timeout: 30_000 });
  await dismissFilesDialogs(page);
  await libraryItem.click();
  await expect(page.getByTestId('files__objects-table')).toBeVisible({ timeout: 30_000 });
  const mountAccessDialog = page.getByTestId('files__dialog__library-mount-access');
  if (await mountAccessDialog.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => undefined);
    await expect(mountAccessDialog).toBeHidden({ timeout: 10_000 });
  }
}

async function dismissFilesDialogs(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const dialog = page.getByRole('dialog').last();
    if (!(await dialog.isVisible().catch(() => false))) {
      return;
    }
    await page.keyboard.press('Escape').catch(() => undefined);
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  }
}

async function openFolderByName(page: Page, name: string): Promise<void> {
  await dismissFilesDialogs(page);
  const folderRow = page.getByTestId('files__object-row').filter({ hasText: name }).first();
  await expect(folderRow).toBeVisible({ timeout: 30_000 });
  const button = folderRow.getByRole('button').first();
  if (await button.isVisible().catch(() => false)) {
    await button.dblclick();
    return;
  }
  await folderRow.dblclick();
}

async function ensureArtifactDir(): Promise<void> {
  await mkdir(INTERNAL_VISUAL_ARTIFACT_DIR, { recursive: true });
}

async function capturePage(page: Page, captures: CaptureEntry[], name: string, notes: string): Promise<void> {
  await ensureArtifactDir();
  const filename = `${name}.png`;
  await page.screenshot({
    path: path.join(INTERNAL_VISUAL_ARTIFACT_DIR, filename),
    fullPage: true,
  });
  captures.push({
    name,
    path: filename,
    notes,
    route: page.url(),
  });
}

async function flushArtifacts(captures: CaptureEntry[]): Promise<void> {
  await ensureArtifactDir();
  const manifest = {
    generated_at: new Date().toISOString(),
    total: captures.length,
    screenshots: captures,
  };
  const reviewLines = [
    '# Internal Notebook Workspace Real Review',
    '',
    `- generated_at: ${manifest.generated_at}`,
    `- total: ${manifest.total}`,
    '',
    '| Screenshot | Route | Notes |',
    '| --- | --- | --- |',
    ...captures.map((item) => `| ${item.path} | ${item.route} | ${item.notes} |`),
    '',
    '- 这些截图来自 internal-k8s notebook workspace 真实 gate。',
    '- 用于审查 lazy start、任务详情和 Files 中的 deliverables 可见性。',
  ];
  await writeFile(path.join(INTERNAL_VISUAL_ARTIFACT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  await writeFile(path.join(INTERNAL_VISUAL_ARTIFACT_DIR, 'review.md'), `${reviewLines.join('\n')}\n`, 'utf-8');
}

test.describe('@lane-real internal notebook workspace via sandbox manager', () => {
  test('lazy-starts an internal agent, writes into /workspace, and resumes after workload reclaim', async ({ page }) => {
    test.setTimeout(900_000);
    requireInternalSandboxEnv();
    const glmApiKey = requireRealLaneApiKey();
    const captures: CaptureEntry[] = [];

    console.log('[internal-real] login');
    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    console.log('[internal-real] create project');
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Internal Notebook Workspace');
    const workspaceLibraryName = `Internal Workspace ${Date.now()}`;
    console.log('[internal-real] create file library');
    const fileLibraryId = await createFileLibraryViaUi(page, 'ws_default', projectId, workspaceLibraryName);
    const credentialName = `GLM Credential ${Date.now()}`;
    console.log('[internal-real] create credential');
    await createCredentialViaUi(page, 'ws_default', projectId, credentialName, glmApiKey);
    console.log('[internal-real] create endpoint');
    const endpointId = await createEndpointViaApi(page, 'ws_default', projectId, {
      endpointName: `GLM Endpoint ${Date.now()}`,
      endpointModel: BACKEND_REAL_MODEL,
      upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
      credentialName,
    });
    console.log('[internal-real] create internal agent');
    const internalAgent = await createInternalCodexAgent(page, {
      workspaceId: 'ws_default',
      projectId,
      endpointId,
      title: 'internal-codex-workspace',
      image: INTERNAL_AGENT_IMAGE,
    });

    const taskTitle = `Internal Workspace Task ${Date.now()}`;
    console.log('[internal-real] create task');
    const taskId = await createNotebookTaskViaApi({
      page,
      workspaceId: 'ws_default',
      projectId,
      title: taskTitle,
      agentId: internalAgent.agentId,
      fileLibraryId,
    });

    const firstToken = `INTERNAL_WORKSPACE_FIRST_${Date.now()}`;
    const firstArtifact = `internal-report-${Date.now()}.md`;
    console.log('[internal-real] send first message');
    await sendTaskMessage({
      page,
      workspaceId: 'ws_default',
      projectId,
      taskId,
      content: [
        'Run the following shell command exactly, then reply with the token and filename.',
        '```bash',
        `mkdir -p .artifacts && cat <<'EOF' > .artifacts/${firstArtifact}`,
        '# Internal workspace report',
        `- Token: ${firstToken}`,
        '- Insight: internal agent mounted persistent workspace successfully',
        'EOF',
        '```',
        `After the file is written, reply with exactly: ${firstToken} ${firstArtifact}`,
      ].join(' '),
    });
    await page.goto(`/en-US/workspaces/ws_default/projects/${projectId}/notebook`);
    await expect(page.getByTestId('notebook__task-list')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('notebook__task-list').getByText(taskTitle).first().click();
    await page.waitForTimeout(1_500);
    await capturePage(page, captures, 'internal-task-preparing', 'internal-k8s 首条消息触发 lazy start 后的任务执行中状态');
    console.log('[internal-real] wait for first token');
    await waitForAssistantToken({
      page,
      workspaceId: 'ws_default',
      projectId,
      taskId,
      token: firstToken,
    });
    await capturePage(page, captures, 'internal-task-detail-complete', 'internal-k8s notebook 任务完成后的详情页，工作目录固定为 /workspace');

    const authToken = await readStoredAuthToken(page);
    const workspaceAccessResponse = await page.request.post(
      `${API_BASE}/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/workspace-access`,
      { headers: { Authorization: `Bearer ${authToken}` } },
    );
    expect(workspaceAccessResponse.ok()).toBeTruthy();
    const workspaceAccessBody = (await workspaceAccessResponse.json()) as {
      metadata_url: string;
      storage_bucket_url?: string;
    };
    expect(workspaceAccessBody.metadata_url).toBeTruthy();

    const localMount = await mountFileLibraryLocally(
      workspaceAccessBody.metadata_url,
      workspaceAccessBody.storage_bucket_url,
      INTERNAL_CLIENT_MOUNT_OVERRIDES,
    );
    try {
      console.log('[internal-real] verify first artifact via local mount');
      await expect
        .poll(
          async () => readFile(path.join(localMount.mountPath, '.artifacts', firstArtifact), 'utf-8').catch(() => null),
          { timeout: 90_000, intervals: [1_000, 2_000, 5_000] },
        )
        .toContain(firstToken);

      const workloadId = sanitizeWorkloadId(taskId);
      console.log('[internal-real] delete workload', workloadId);
      await deleteInternalWorkloadViaManager({
        workspaceId: 'ws_default',
        projectId,
        workloadId,
      });
      await page.waitForTimeout(5_000);

      const secondToken = `INTERNAL_WORKSPACE_RESUME_${Date.now()}`;
      const secondArtifact = `internal-resume-${Date.now()}.md`;
      console.log('[internal-real] send second message');
      await sendTaskMessage({
        page,
        workspaceId: 'ws_default',
        projectId,
        taskId,
        content: [
          'Run the following shell command exactly, then reply with the token and filename.',
          '```bash',
          `if [ ! -f .artifacts/${firstArtifact} ]; then echo 'missing-first-artifact' >&2; exit 1; fi`,
          `cat <<'EOF' > .artifacts/${secondArtifact}`,
          '# Internal workspace resume report',
          `- Token: ${secondToken}`,
          `- Verified previous artifact: ${firstArtifact}`,
          'EOF',
          '```',
          `After the file is written, reply with exactly: ${secondToken} ${secondArtifact}`,
        ].join(' '),
      });
      console.log('[internal-real] wait for second token');
      await waitForAssistantTokenOrArtifact({
        page,
        workspaceId: 'ws_default',
        projectId,
        taskId,
        token: secondToken,
        artifactPath: path.join(localMount.mountPath, '.artifacts', secondArtifact),
        minAgentMessages: 2,
      });
      await capturePage(page, captures, 'internal-task-detail-resumed', 'internal-k8s workload reclaim 后再次恢复执行的任务详情页');

      console.log('[internal-real] verify second artifact via local mount');
      await expect
        .poll(
          async () => readFile(path.join(localMount.mountPath, '.artifacts', secondArtifact), 'utf-8').catch(() => null),
          { timeout: 90_000, intervals: [1_000, 2_000, 5_000] },
        )
        .toContain(secondToken);
    } finally {
      await localMount.stop();
    }

    console.log('[internal-real] verify files ui');
    await openFileLibraryRoot({
      page,
      workspaceId: 'ws_default',
      projectId,
      libraryName: workspaceLibraryName,
    });
    await openFolderByName(page, '.artifacts');
    await expect(page.getByTestId('files__object-row').filter({ hasText: firstArtifact }).first()).toBeVisible({ timeout: 30_000 });
    await capturePage(page, captures, 'internal-files-artifacts-visible', 'Files 页面中已可见 internal-k8s notebook 生成的 .artifacts 交付物');
    await flushArtifacts(captures);
  });
});
