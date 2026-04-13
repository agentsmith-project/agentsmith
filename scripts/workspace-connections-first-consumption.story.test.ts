import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadStoryDefinitionSync } from '../e2e/story-loader';

describe('workspace connections first consumption story', () => {
  it('defines a backend-real story for workspace connections, project discovery, and first use guide consumption', () => {
    const story = loadStoryDefinitionSync('workspace-connections-to-project-use');

    expect(story.lane).toBe('backend-real');
    expect(story.family).toBe('workspace-connections-to-project-use');
    expect(story.personas).toEqual(['workspace admin', 'project member']);
    expect(story.kind).toBe('journey');
    expect(story.goal).toContain('工作区连接页');
    expect(story.goal).toContain('项目列表');
    expect(story.goal).toContain('use-guide');
    expect(story.goal).toContain('第一次 endpoint 消费');
    expect(story.goal).not.toContain('Feishu token');
    expect(story.goal).not.toContain('workspace_feishu');

    expect(story.scenes.map((scene) => scene.sceneId)).toEqual([
      'workspace-connections',
      'project-use-guide',
      'personal-api-keys',
    ]);
    expect(story.steps.map((step) => step.stepId)).toEqual([
      'review-workspace-connections',
      'open-project-use-guide',
      'verify-project-use-ready',
      'create-personal-api-key',
      'consume-project-endpoint',
      'verify-first-consumption',
    ]);
  });

  it('wires the workspace connections page and use-guide surfaces to the story instead of keeping the flow hidden in self-service tests', async () => {
    const connectionsPage = await readFile(
      path.resolve(process.cwd(), 'src/app/[locale]/workspaces/[workspace]/connections/page.tsx'),
      'utf-8',
    );
    const useGuidePage = await readFile(
      path.resolve(process.cwd(), 'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/use-guide/page.tsx'),
      'utf-8',
    );
    const visualSpec = await readFile(path.resolve(process.cwd(), 'e2e/visual.spec.ts'), 'utf-8');

    expect(connectionsPage).toContain('workspace-connections__feishu-connect');
    expect(connectionsPage).toContain('workspace-connections__open-projects');
    expect(useGuidePage).toContain('use-guide__page');
    expect(useGuidePage).toContain('use-guide__endpoint-select');
    expect(visualSpec).toContain("workspace connections - Feishu disabled state");
    expect(visualSpec).toContain("workspace connections - Feishu connected state");
    expect(visualSpec).toContain('workspace-connections-feishu-disabled.png');
    expect(visualSpec).toContain('workspace-connections-feishu-connected.png');
    expect(visualSpec).not.toContain('workspace-connections-feishu-debug-smoke');
  });
});
