import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('user story contract docs', () => {
  it('documents the current runtimeData and step note schema from story-contract', async () => {
    const docSource = await readFile(path.resolve('docs/contracts/user-story-contract-v1.md'), 'utf-8');
    const contractSource = await readFile(path.resolve('e2e/story-contract.ts'), 'utf-8');

    expect(contractSource).toContain('note?: string;');
    expect(contractSource).toContain('runtimeData?: StoryRuntimeData;');
    expect(contractSource).toContain('export type StoryRuntimeNotebookTurnDefinition');
    expect(contractSource).toContain('export type StoryRuntimeNotebookFlowDefinition');
    expect(contractSource).toContain('export type StoryRuntimeVisualReviewNotebookTaskDefinition');
    expect(contractSource).toContain('export type StoryRuntimeData');

    expect(docSource).toContain('- `runtimeData?: StoryRuntimeData`');
    expect(docSource).toContain('- `note?: string`');
    expect(docSource).toContain('- `story.runtimeData?: StoryRuntimeData`');
    expect(docSource).toContain('- `step.note?: string`');
    expect(docSource).toContain('### Runtime data');
    expect(docSource).toContain('- `story.runtimeData.notebook?: Record<string, StoryRuntimeNotebookFlowDefinition>`');
    expect(docSource).toContain('- `story.runtimeData.visualReview?: { notebookTask: StoryRuntimeVisualReviewNotebookTaskDefinition }`');
    expect(docSource).toContain('- `story.runtimeData.visualReview.notebookTask: StoryRuntimeVisualReviewNotebookTaskDefinition`');
    expect(docSource).toContain('### Notebook turn');
    expect(docSource).toContain('- `prompt: string`');
    expect(docSource).toContain('- `expectedToken: string`');
    expect(docSource).toContain('- `expectedArtifactPath: string`');
    expect(docSource).toContain('- `minAgentMessages?: number`');
    expect(docSource).toContain('### Notebook flow');
    expect(docSource).toContain('- `turnOne: StoryRuntimeNotebookTurnDefinition`');
    expect(docSource).toContain('- `turnTwo: StoryRuntimeNotebookTurnDefinition`');
    expect(docSource).toContain('### Visual review notebook task');
    expect(docSource).toContain('- `taskTitlePrefix: string`');
    expect(docSource).toContain('- `expectedTokenPrefix: string`');
    expect(docSource).toContain('- `artifactNamePrefix: string`');
    expect(docSource).toContain('- `artifactExtension: string`');
    expect(docSource).toContain('- `promptIntro: string`');
    expect(docSource).toContain('- `artifactBodyLines: string[]`');
    expect(docSource).toContain('- if `note` is present, it must be non-empty');
  });
});
