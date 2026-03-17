import { test as base, expect, type Page } from '@playwright/test';
import { withAuth } from './fixtures/authenticated';
import {
  DOC_LOCALE,
  flushDocIndex,
  stableNavigate,
  type DocArtifactRecord,
  writeDocArtifact,
} from './doc-artifacts-support';

const WORKSPACE_ID = 'ws_default';
const PROJECT_ID = 'proj_001';

const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await withAuth(page, WORKSPACE_ID, 'test@example.com', 'user_001');
    await use(page);
  },
});

async function dismissOpenDialogs(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const count = await page.locator('[role="dialog"]').count().catch(() => 0);
    if (count === 0) return;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
  }
}

test.describe.configure({ mode: 'serial' });

test('generate chinese product documentation artifacts', async ({ page, authedPage }) => {
  test.setTimeout(180_000);
  const manifest: DocArtifactRecord[] = [];

  await page.setViewportSize({ width: 1920, height: 1080 });
  await stableNavigate(page, `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/login`);
  await expect(page.getByTestId('workspace-login__heading')).toBeVisible();
  await writeDocArtifact(page, manifest, {
    id: 'workspace-login',
    title: '工作区登录',
    group: 'workspace',
    role: '业务用户',
    route: `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/login`,
    summary: '用户通过工作区登录页进入指定工作区，进入后可以直接访问项目列表和项目内的各项操作能力。',
    contentPoints: [
      '页面展示当前工作区名称和登录入口。',
      '用于承接从工作区选择页进入后的统一登录动作。',
    ],
    userSteps: [
      '输入或选择企业身份后完成登录。',
      '登录成功后进入工作区内项目入口页。',
    ],
  });

  await stableNavigate(authedPage, `/${DOC_LOCALE}/login/workspace`);
  await expect(authedPage.getByTestId('workspace-select__card--ws_default')).toBeVisible();
  await writeDocArtifact(authedPage, manifest, {
    id: 'workspace-select',
    title: '工作区选择',
    group: 'workspace',
    role: '业务用户',
    route: `/${DOC_LOCALE}/login/workspace`,
    summary: '用户在进入系统后选择自己可访问的工作区，后续所有项目与治理操作都在所选工作区内完成。',
    contentPoints: [
      '列表展示可访问的工作区卡片。',
      '每个卡片提供进入工作区的入口。',
    ],
    userSteps: [
      '浏览工作区列表。',
      '点击目标工作区进入登录或直接进入工作区。',
    ],
  });

  await stableNavigate(authedPage, `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}`);
  await expect(authedPage.getByTestId('projects__page')).toBeVisible();
  await writeDocArtifact(authedPage, manifest, {
    id: 'workspace-projects',
    title: '工作区项目入口',
    group: 'workspace',
    role: '工作区成员',
    route: `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}`,
    summary: '工作区根路径直接承载项目入口，用户登录后即可查看项目、创建项目并进入项目工作台。',
    contentPoints: [
      '页面展示当前工作区内的项目列表和搜索框。',
      '具备权限的成员可直接创建新项目。',
    ],
    userSteps: [
      '通过搜索定位目标项目。',
      '点击项目进入项目工作台。',
      '点击“创建项目”打开新建项目对话框。',
    ],
  });

  await authedPage.getByTestId('projects__create-btn').click();
  await expect(authedPage.getByRole('dialog')).toBeVisible();
  await writeDocArtifact(authedPage, manifest, {
    id: 'dialog-project-create',
    title: '创建项目对话框',
    group: 'workspace',
    role: '工作区成员',
    route: `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}`,
    summary: '项目创建对话框用于设置项目名称、可见性和基本说明，是用户进入项目治理与智能体使用的第一步。',
    contentPoints: [
      '表单包含项目名称、描述和访问策略等字段。',
      '提交后会在当前工作区下创建新的项目记录。',
    ],
    userSteps: [
      '点击“创建项目”。',
      '填写项目名称与说明。',
      '确认后进入新项目或返回项目列表。',
    ],
  });
  await authedPage.keyboard.press('Escape');

  await stableNavigate(authedPage, `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/overview`);
  await writeDocArtifact(authedPage, manifest, {
    id: 'project-overview',
    title: '项目总览',
    group: 'workspace',
    role: '项目成员',
    route: `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/overview`,
    summary: '项目总览页集中展示项目运行状态、关键入口和治理维度，是进入 Chat、Notebook、Files 和治理页面的统一入口。',
    contentPoints: [
      '页面展示项目核心说明和关键工作台入口。',
      '用户可从这里快速跳转到聊天、任务、文件和治理相关页面。',
    ],
    userSteps: [
      '进入项目后先查看总览信息。',
      '根据目标工作选择 Chat、Notebook、Files 或治理页面。',
    ],
  });

  await stableNavigate(authedPage, `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/chat`);
  const thread = authedPage.locator('[data-testid="chat__thread-item"][data-thread-id="chat_doc_001"]').first();
  if (await thread.isVisible().catch(() => false)) {
    await thread.click();
  }
  await expect(authedPage.getByTestId('chat__threads-pane')).toBeVisible();
  await expect(authedPage.getByTestId('chat__composer')).toBeVisible();
  await writeDocArtifact(authedPage, manifest, {
    id: 'project-chat-session',
    title: 'Chat 多轮会话',
    group: 'chat',
    role: '项目成员',
    route: `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/chat`,
    summary: 'Chat 页面展示多轮对话、线程列表和输入区，适合做交互式提问、分析和结果迭代。',
    contentPoints: [
      '左侧为会话线程列表，右侧为当前会话消息内容。',
      '示例数据展示了围绕 GLM-5 调用波动的多轮分析对话。',
    ],
    userSteps: [
      '在左侧选择已有会话，或新建会话。',
      '在输入框中继续追问或补充上下文。',
      '查看 assistant 的结构化回复并继续迭代。',
    ],
  });

  await stableNavigate(authedPage, `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/notebook`);
  await expect(authedPage.getByTestId('notebook__task-list')).toBeVisible();
  await writeDocArtifact(authedPage, manifest, {
    id: 'project-notebook-list',
    title: 'Notebook 任务列表',
    group: 'notebook',
    role: '项目成员',
    route: `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/notebook`,
    summary: 'Notebook 页面展示长期任务列表，适合执行更长流程的智能体任务、保留上下文和沉淀产物。',
    contentPoints: [
      '列表中展示任务标题、状态、绑定智能体和最近活动时间。',
      '适合用于执行审计分析、报告汇总、文件处理等长流程任务。',
    ],
    userSteps: [
      '进入 Notebook 查看现有任务。',
      '点击某个任务进入详情页继续查看执行过程和结果。',
    ],
  });

  await stableNavigate(authedPage, `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/notebook/tasks/task_doc_001`);
  await expect(authedPage.getByTestId('notebook__task-header')).toBeVisible();
  const traceToggle = authedPage.getByTestId('notebook__message-trace-toggle').first();
  if (await traceToggle.isVisible().catch(() => false)) {
    await traceToggle.click();
  }
  await writeDocArtifact(authedPage, manifest, {
    id: 'project-notebook-task-detail',
    title: 'Notebook 任务详情',
    group: 'notebook',
    role: '项目成员',
    route: `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/notebook/tasks/task_doc_001`,
    summary: '任务详情页集中展示任务消息、运行状态、trace 和产物，是长期智能体执行的核心证据页面。',
    contentPoints: [
      '页面展示任务标题、绑定 agent、消息过程和最终产物。',
      '示例任务包含 trace、artifact 和已完成状态，适合用于功能说明书。',
    ],
    userSteps: [
      '打开具体任务查看执行过程。',
      '展开 trace 面板定位关键步骤。',
      '查看或下载产物文件。',
    ],
  });

  await stableNavigate(authedPage, `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/files`);
  await dismissOpenDialogs(authedPage);
  await expect(authedPage.getByTestId('files__library-list')).toBeVisible();
  await authedPage.getByTestId('files__library-item--lib_shared_default').click();
  await writeDocArtifact(authedPage, manifest, {
    id: 'project-files',
    title: '文件库管理',
    group: 'files',
    role: '项目成员',
    route: `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/files`,
    summary: 'Files 页面用于管理项目文件库、浏览目录、查看文件详情，并支持与本地挂载目录同步。',
    contentPoints: [
      '左侧展示文件库列表，中间展示目录与文件，右侧展示详情面板。',
      '示例文件库包含周报、巡检截图和治理模板等真实风格内容。',
    ],
    userSteps: [
      '选择文件库进入浏览。',
      '点击文件查看详情。',
      '通过页面进行上传、下载、重命名或删除。',
    ],
  });

  await dismissOpenDialogs(authedPage);
  await authedPage.getByTestId('files__library-create').click();
  await expect(authedPage.getByTestId('files__dialog__library-create')).toBeVisible();
  await writeDocArtifact(authedPage, manifest, {
    id: 'dialog-file-library-create',
    title: '创建文件库对话框',
    group: 'files',
    role: '项目成员',
    route: `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/files`,
    summary: '创建文件库对话框用于新建项目级文件库，为 Web 文件管理和本地挂载提供统一入口。',
    contentPoints: [
      '表单包含文件库名称和描述。',
      '创建后会生成独立文件库并出现在左侧列表中。',
    ],
    userSteps: [
      '点击“创建文件库”。',
      '填写名称和说明。',
      '提交后即可开始上传文件或本地挂载。',
    ],
  });
  await dismissOpenDialogs(authedPage);
  await expect(authedPage.getByTestId('files__dialog__library-create')).toHaveCount(0);

  await dismissOpenDialogs(authedPage);
  await authedPage.getByTestId('files__library-mount-access--lib_shared_default').click();
  await expect(authedPage.getByTestId('files__dialog__library-mount-access')).toBeVisible();
  await writeDocArtifact(authedPage, manifest, {
    id: 'dialog-file-library-mount-access',
    title: '文件库本地挂载说明',
    group: 'files',
    role: '项目成员',
    route: `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/files`,
    summary: '挂载说明对话框展示 filesystem 名称、metadata URL 和多平台挂载命令，用于把项目文件库挂载到本地目录。',
    contentPoints: [
      '对话框展示 JuiceFS 挂载所需的关键信息。',
      '支持复制 metadata URL 和查看推荐挂载路径。',
    ],
    userSteps: [
      '点击文件库右侧的挂载入口。',
      '查看并复制挂载信息。',
      '在本地执行 JuiceFS 挂载命令后与 Web 端同步操作。',
    ],
  });
  await dismissOpenDialogs(authedPage);

  await stableNavigate(authedPage, `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/credentials`);
  await expect(authedPage.getByTestId('credentials__table')).toBeVisible();
  await writeDocArtifact(authedPage, manifest, {
    id: 'project-credentials',
    title: '凭据管理',
    group: 'governance',
    role: '项目管理员',
    route: `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/credentials`,
    summary: '凭据页集中管理对接第三方模型和服务所需的凭据，并与 endpoint 和 agent 形成治理闭环。',
    contentPoints: [
      '页面展示凭据名称、类型和轮换时间。',
      '支持新建、轮换和删除等关键操作。',
    ],
    userSteps: [
      '查看现有凭据清单。',
      '按需创建或轮换凭据。',
      '为 endpoint 配置对应的 credential 引用。',
    ],
  });
  await authedPage.getByTestId('credentials__create-btn').click();
  await expect(authedPage.getByTestId('credentials__create-dialog')).toBeVisible();
  await writeDocArtifact(authedPage, manifest, {
    id: 'dialog-credential-create',
    title: '创建凭据对话框',
    group: 'governance',
    role: '项目管理员',
    route: `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/credentials`,
    summary: '创建凭据对话框用于录入模型服务、第三方平台或代理服务所需的密钥信息，是 endpoint 接入的前置步骤。',
    contentPoints: [
      '表单包含凭据名称、类型、密钥字段和可选说明。',
      '创建后的凭据可被 endpoint 复用，用于统一治理和轮换。',
    ],
    userSteps: [
      '点击“创建凭据”。',
      '填写名称和密钥内容。',
      '保存后回到凭据列表并用于 endpoint 配置。',
    ],
  });
  await dismissOpenDialogs(authedPage);

  await stableNavigate(authedPage, `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/endpoints`);
  await expect(authedPage.getByTestId('endpoints__table')).toBeVisible();
  await writeDocArtifact(authedPage, manifest, {
    id: 'project-endpoints',
    title: 'Endpoint 管理',
    group: 'governance',
    role: '项目管理员',
    route: `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/endpoints`,
    summary: 'Endpoint 页面统一管理各类模型入口，是 AI 开发工具、智能体和 Notebook 的统一接入面。',
    contentPoints: [
      '页面展示 endpoint 名称、模型、协议、状态和基础限额。',
      '示例中包含 GLM-5 主生产和 Claude 复杂推理两个入口。',
    ],
    userSteps: [
      '创建或编辑 endpoint。',
      '为 endpoint 绑定 credential。',
      '将 endpoint 分配给 Chat、Notebook 或 agent 使用。',
    ],
  });
  await authedPage.getByTestId('endpoints__create-btn').click();
  await expect(authedPage.getByTestId('endpoints__create-dialog')).toBeVisible();
  await writeDocArtifact(authedPage, manifest, {
    id: 'dialog-endpoint-create',
    title: '创建 Endpoint 对话框',
    group: 'governance',
    role: '项目管理员',
    route: `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/endpoints`,
    summary: '创建 Endpoint 对话框用于定义模型入口、协议、模型名和绑定凭据，是企业级统一接入的核心配置入口。',
    contentPoints: [
      '表单展示 endpoint 名称、协议类型、模型标识、凭据绑定等字段。',
      '创建后可被 Chat、Notebook 和智能体统一复用。',
    ],
    userSteps: [
      '点击“创建 Endpoint”。',
      '填写模型、协议和凭据绑定信息。',
      '保存后在列表中查看并纳入治理。',
    ],
  });
  await dismissOpenDialogs(authedPage);

  await stableNavigate(authedPage, `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/agents`);
  await expect(authedPage.getByTestId('agents__table')).toBeVisible();
  await writeDocArtifact(authedPage, manifest, {
    id: 'project-agents',
    title: '智能体管理',
    group: 'governance',
    role: '项目管理员',
    route: `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/agents`,
    summary: '智能体页面用于管理 external/internal agent，查看在线状态、运行模式和入口能力。',
    contentPoints: [
      '页面展示智能体名称、模式、在线状态和负责管理员。',
      '适合用来说明 external agent 与 codex runner 的接入路径。',
    ],
    userSteps: [
      '查看当前项目下的智能体清单。',
      '根据状态判断是聊天、Notebook 还是双模式使用。',
      '进一步打开连接信息或服务 key 管理。',
    ],
  });
  await authedPage.getByTestId('agents__create-btn').click();
  await expect(authedPage.getByTestId('agents__create-dialog')).toBeVisible();
  await writeDocArtifact(authedPage, manifest, {
    id: 'dialog-agent-create',
    title: '创建智能体对话框',
    group: 'governance',
    role: '项目管理员',
    route: `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/agents`,
    summary: '创建智能体对话框用于定义 agent 的名称、运行模式、能力边界和接入方式，是管理 external agent 的关键入口。',
    contentPoints: [
      '表单展示智能体名称、模式、说明和可选行为配置。',
      '适合说明 external agent 与本地 codex runner 的接入关系。',
    ],
    userSteps: [
      '点击“创建智能体”。',
      '填写名称、模式和说明。',
      '保存后再配置连接信息或服务 key。',
    ],
  });
  await dismissOpenDialogs(authedPage);

  const keysButton = authedPage.locator('[data-testid^="agents__keys-btn--"]').first();
  if (await keysButton.isVisible().catch(() => false)) {
    await keysButton.click();
    await expect(authedPage.getByTestId('agents__dialog__keys')).toBeVisible();
    await writeDocArtifact(authedPage, manifest, {
      id: 'dialog-agent-connection-info',
      title: '智能体连接信息对话框',
      group: 'governance',
      role: '项目管理员',
      route: `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/agents`,
      summary: '连接信息对话框展示 external agent 的连接地址、服务 key 和接入说明，用于接入本地 codex runner。',
      contentPoints: [
        '展示 WebSocket 地址和服务 key 列表。',
        '用于说明 external agent 与本地 runner 的连接方式。',
      ],
      userSteps: [
        '在智能体列表中打开 key/连接信息。',
        '复制连接地址与 key。',
        '在本地 runner 中完成接入。',
      ],
    });
    await authedPage.keyboard.press('Escape');
  }

  await stableNavigate(authedPage, `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/members?member_tab=people`);
  await expect(authedPage.getByTestId('members__search-input')).toBeVisible();
  await writeDocArtifact(authedPage, manifest, {
    id: 'project-members',
    title: '成员治理',
    group: 'governance',
    role: '项目管理员',
    route: `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/members?member_tab=people`,
    summary: '成员治理页面用于管理成员、加入申请、权限模板和有效访问范围，是项目权限控制的核心界面。',
    contentPoints: [
      '页面展示成员列表、搜索和治理标签页。',
      '适合说明项目成员、管理员和审批链路。',
    ],
    userSteps: [
      '搜索成员并查看当前状态。',
      '处理加入申请或调整分组。',
      '进入有效访问详情核对权限来源。',
    ],
  });
  const inviteButton = authedPage.getByTestId('members__invite-btn');
  if (await inviteButton.isVisible().catch(() => false)) {
    await inviteButton.click();
    await expect(authedPage.getByTestId('members__invite-dialog')).toBeVisible();
    await writeDocArtifact(authedPage, manifest, {
      id: 'dialog-member-invite',
      title: '邀请成员对话框',
      group: 'governance',
      role: '项目管理员',
      route: `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/members?member_tab=people`,
      summary: '邀请成员对话框用于向项目添加成员、指定分组或角色来源，是权限治理的起点。',
      contentPoints: [
        '表单支持录入成员邮箱、选择权限分组和说明。',
        '邀请结果会出现在成员列表和相关治理视图中。',
      ],
      userSteps: [
        '点击“邀请成员”。',
        '填写邮箱并选择成员分组。',
        '发送邀请后在成员列表中跟踪状态。',
      ],
    });
    await dismissOpenDialogs(authedPage);
  }

  await stableNavigate(authedPage, `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/resource-policy`);
  await expect(authedPage.getByTestId('resource-policy__editor')).toBeVisible();
  await writeDocArtifact(authedPage, manifest, {
    id: 'project-resource-policy',
    title: '资源策略',
    group: 'governance',
    role: '项目管理员',
    route: `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/resource-policy`,
    summary: '资源策略页面用于定义 endpoint、文件库和 agent 的访问规则、限流和费用约束，是企业级 AI 治理的核心页面。',
    contentPoints: [
      '页面展示资源分组、默认策略、subject allow-list 和 explainability 面板。',
      '适合说明默认限额与按资源治理的思路。',
    ],
    userSteps: [
      '选择资源类型和目标资源。',
      '调整访问模式、限流规则和费用上限。',
      '保存后到 Usage/Audit 页面核对效果。',
    ],
  });

  await stableNavigate(authedPage, `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/audit`);
  await expect(authedPage.getByTestId('audit__page')).toBeVisible();
  await writeDocArtifact(authedPage, manifest, {
    id: 'project-audit',
    title: '审计日志',
    group: 'governance',
    role: '项目管理员',
    route: `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/audit`,
    summary: '审计页面用于追踪配置变更、endpoint 调用和治理动作，是可追责和复盘的核心证据面。',
    contentPoints: [
      '页面展示审计摘要、过滤器和事件表格。',
      '示例中包含策略更新、endpoint 调用和 agent key 创建事件。',
    ],
    userSteps: [
      '通过过滤器定位指定资源或动作。',
      '打开详情抽屉查看上下文与关联治理入口。',
    ],
  });

  const auditActionButton = authedPage.locator('[data-testid^="audit__row-actions--"]').first();
  if (await auditActionButton.isVisible().catch(() => false)) {
    await auditActionButton.click();
    await authedPage.locator('[data-testid^="audit__view-details--"]').first().click();
    await expect(authedPage.getByTestId('audit__detail-summary')).toBeVisible();
    await writeDocArtifact(authedPage, manifest, {
      id: 'drawer-audit-detail',
      title: '审计详情抽屉',
      group: 'governance',
      role: '项目管理员',
      route: `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/audit`,
      summary: '审计详情抽屉展示单条事件的上下文、治理入口和责任信息，方便管理员从事件快速跳转到相关配置页面。',
      contentPoints: [
        '抽屉包含摘要、责任归属和治理快捷入口。',
        '可直接跳转到资源策略、成员访问或用量页面。',
      ],
      userSteps: [
        '在审计表格中打开操作菜单。',
        '点击“查看详情”。',
        '根据详情中的入口继续排查或修正配置。',
      ],
    });
    await authedPage.keyboard.press('Escape');
  }

  await stableNavigate(authedPage, `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/usage`);
  await expect(authedPage.getByTestId('usage__view')).toBeVisible();
  await writeDocArtifact(authedPage, manifest, {
    id: 'project-usage',
    title: '用量与限额',
    group: 'governance',
    role: '项目管理员',
    route: `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/usage`,
    summary: '用量页面展示 endpoint 的调用量、限额卡片和趋势，是成员自控和管理员巡检的重要界面。',
    contentPoints: [
      '页面展示按 endpoint 切换的限额卡片和趋势图。',
      '示例页面适合说明默认限额、最近 30 天趋势和资源切换。',
    ],
    userSteps: [
      '选择目标 endpoint。',
      '查看限额卡片、进度和趋势变化。',
      '结合 Audit 和 Resource Policy 页面进行治理调整。',
    ],
  });

  await stableNavigate(authedPage, `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/settings`);
  await writeDocArtifact(authedPage, manifest, {
    id: 'project-settings',
    title: '项目设置',
    group: 'governance',
    role: '项目管理员',
    route: `/${DOC_LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/settings`,
    summary: '项目设置页用于维护项目基础信息和治理边界，是项目生命周期管理的重要页面。',
    contentPoints: [
      '页面展示项目基础信息和可调整的设置项。',
      '适合说明项目级配置与治理入口的关系。',
    ],
    userSteps: [
      '查看项目基础配置。',
      '按需修改说明、可见性或相关设置。',
    ],
  });

  await flushDocIndex(manifest);
});
