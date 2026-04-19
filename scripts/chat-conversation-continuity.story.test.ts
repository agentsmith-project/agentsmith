import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCommittedStoryDefinitionByIdSync } from './story-catalog-support';

describe('chat conversation continuity story', () => {
  it('focuses exact-token validation on the post-refresh recall turn', async () => {
    const story = loadCommittedStoryDefinitionByIdSync('chat-conversation-continuity');
    const runtimeRoot = story.runtimeData as Record<string, unknown> | undefined;
    const chatRuntime = runtimeRoot?.chat as Record<string, unknown> | undefined;
    const continuity = chatRuntime?.continuity as Record<string, unknown> | undefined;
    const chatSource = await readFile(path.resolve(process.cwd(), 'e2e/integration-chat-llm-runner.spec.ts'), 'utf-8');
    const rememberPhasePattern =
      /const rememberedMessages = await waitForLatestAssistantContent\(\{\s*page,\s*projectId,\s*sessionId: agentBundle\.sessionId,\s*minMessages: 2,\s*\}\);/s;
    const recallPhasePattern =
      /const sessionMessages = await waitForLatestAssistantContent\(\{\s*page,\s*projectId,\s*sessionId: agentBundle\.sessionId,\s*requiredSubstring: runtime\.rememberToken,\s*minMessages: 4,\s*\}\);/s;

    expect(continuity?.rememberPrompt).toContain('Remember this token for our session: CHAT_CONTINUITY_OK.');
    expect(continuity?.rememberPrompt).not.toContain('Make sure your reply includes the token.');
    expect(continuity?.recallPrompt).toContain('Reply with exactly the token and nothing else.');
    expect(chatSource).toContain("hasText: runtime.rememberPrompt");
    expect(chatSource).toMatch(rememberPhasePattern);
    expect(chatSource).toMatch(recallPhasePattern);
    expect(chatSource).not.toContain("hasText: runtime.rememberToken }).first()).toBeVisible({ timeout: 240_000");
  });
});
