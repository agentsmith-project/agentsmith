import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { gotoAndWait, waitForPageReady } from './utils/navigation';

export type DocCapture = {
  id: string;
  title: string;
  group: 'workspace' | 'chat' | 'notebook' | 'files' | 'governance';
  role: string;
  route: string;
  summary: string;
  contentPoints: string[];
  userSteps: string[];
};

export type DocArtifactRecord = DocCapture & {
  image: string;
  markdown: string;
};

export const DOC_LOCALE = 'zh-CN';
export const DOC_OUTPUT_DIR = process.env.DOC_ARTIFACTS_OUTPUT_DIR
  ? path.resolve(process.env.DOC_ARTIFACTS_OUTPUT_DIR)
  : path.resolve('artifacts/product-docs/manual-run');

const GROUP_LABELS: Record<DocCapture['group'], string> = {
  workspace: '工作区与项目',
  chat: 'Chat 对话',
  notebook: 'Notebook 任务',
  files: '文件管理',
  governance: '治理与运营',
};

export async function ensureDocOutputDir() {
  await mkdir(DOC_OUTPUT_DIR, { recursive: true });
}

export async function stableNavigate(page: Page, target: string) {
  await gotoAndWait(page, target, 30_000);
  await waitForPageReady(page, 45_000);
  const bootMessage = page.getByText('Starting mocks...');
  if (await bootMessage.isVisible().catch(() => false)) {
    await bootMessage.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
  }
  await page.waitForTimeout(400);
}

function renderMarkdown(entry: DocArtifactRecord) {
  const lines = [
    `# ${entry.title}`,
    '',
    `- 功能分组：${GROUP_LABELS[entry.group]}`,
    `- 适用角色：${entry.role}`,
    `- 功能路径：${entry.route}`,
    '',
    '## 页面截图',
    '',
    `![${entry.title}](./${entry.image})`,
    '',
    '## 功能说明',
    '',
    entry.summary,
    '',
    '## 页面内容说明',
    '',
    ...entry.contentPoints.map((point) => `- ${point}`),
    '',
    '## 用户操作',
    '',
    ...entry.userSteps.map((step, index) => `${index + 1}. ${step}`),
    '',
    '## 截图文件',
    '',
    `- [${entry.image}](./${entry.image})`,
    '',
  ];
  return `${lines.join('\n')}\n`;
}

export async function writeDocArtifact(page: Page, manifest: DocArtifactRecord[], capture: DocCapture) {
  await ensureDocOutputDir();
  const image = `${capture.id}.png`;
  const markdown = `${capture.id}.md`;
  await page.screenshot({
    path: path.join(DOC_OUTPUT_DIR, image),
    fullPage: true,
  });
  const record: DocArtifactRecord = { ...capture, image, markdown };
  await writeFile(path.join(DOC_OUTPUT_DIR, markdown), renderMarkdown(record), 'utf-8');
  manifest.push(record);
}

export async function flushDocIndex(manifest: DocArtifactRecord[]) {
  await ensureDocOutputDir();
  const grouped = manifest.reduce<Record<string, DocArtifactRecord[]>>((acc, item) => {
    acc[item.group] ??= [];
    acc[item.group].push(item);
    return acc;
  }, {});

  const indexLines = [
    '# AgentSmith 产品文档截图目录',
    '',
    '- 语言：中文（zh-CN）',
    '- 分辨率：1920x1080',
    `- 生成时间：${new Date().toISOString()}`,
    '',
    '## 模块索引',
    '',
  ];

  for (const [group, items] of Object.entries(grouped)) {
    indexLines.push(`### ${GROUP_LABELS[group as DocCapture['group']] ?? group}`);
    indexLines.push('');
    for (const item of items) {
      indexLines.push(`- [${item.title}](./${item.markdown})`)
      indexLines.push(`  截图：[${item.image}](./${item.image})`);
    }
    indexLines.push('');
  }

  await writeFile(path.join(DOC_OUTPUT_DIR, 'index.md'), `${indexLines.join('\n')}\n`, 'utf-8');
  await writeFile(
    path.join(DOC_OUTPUT_DIR, 'manifest.json'),
    `${JSON.stringify({ generated_at: new Date().toISOString(), items: manifest }, null, 2)}\n`,
    'utf-8',
  );
}
