import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const DEEPSEEK_MODEL = 'deepseek-v4-flash';
const DEEPSEEK_OPENAI_BASE_URL = 'https://api.deepseek.com';
const DEEPSEEK_ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic';

function readRepoText(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function parseEnvFile(relativePath: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const rawLine of readRepoText(relativePath).split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex < 1) continue;
    entries[line.slice(0, separatorIndex)] = line.slice(separatorIndex + 1);
  }
  return entries;
}

describe('DeepSeek real lane defaults', () => {
  it.each([
    '.env.local-manual.example',
    'infra/runtime/presets.env',
  ])('keeps %s on DeepSeek dual-protocol defaults without tracked secrets', (relativePath) => {
    const env = parseEnvFile(relativePath);
    const text = readRepoText(relativePath);

    expect(env.PRESET_ENDPOINT_MODEL).toBe(DEEPSEEK_MODEL);
    expect(env.PRESET_ANTHROPIC_ENDPOINT_BASE_URL).toBe(DEEPSEEK_ANTHROPIC_BASE_URL);
    expect(env.PRESET_ANTHROPIC_ENDPOINT_PROTOCOL).toBe('anthropic_messages');
    expect(env.PRESET_OPENAI_ENDPOINT_BASE_URL).toBe(DEEPSEEK_OPENAI_BASE_URL);
    expect(env.PRESET_OPENAI_ENDPOINT_PROTOCOL).toBe('openai_chat_completions');
    expect(env.PRESET_ENDPOINT_API_KEY ?? '').toBe('');
    expect(text).not.toMatch(/MiniMax|api\.minimaxi|placeholder-model|provider\.example/i);
    expect(text).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
  });

  it('uses DeepSeek fallbacks in backend-real and bootstrap shell entrypoints', () => {
    const backendRealEnv = readRepoText('scripts/lib/backend-real-env.sh');
    const bootstrapCommon = readRepoText('scripts/lib/bootstrap-common.sh');

    for (const text of [backendRealEnv, bootstrapCommon]) {
      expect(text).toContain(`:-${DEEPSEEK_MODEL}`);
      expect(text).toContain(`:-${DEEPSEEK_OPENAI_BASE_URL}`);
      expect(text).toContain(`:-${DEEPSEEK_ANTHROPIC_BASE_URL}`);
      expect(text).not.toMatch(/placeholder-model|anthropic-compatible\.provider\.example|openai-compatible\.provider\.example/i);
    }
    expect(bootstrapCommon).toContain(':-openai_chat_completions');
    expect(bootstrapCommon).toContain(':-anthropic_messages');
    expect(bootstrapCommon).toContain('ensure_agent_task_model_setting "${ANTHROPIC_ENDPOINT_ID}"');
    expect(bootstrapCommon).toContain('"${PRESET_AGENT_RUNNER_NAME}" "${ANTHROPIC_ENDPOINT_ID}"');
  });

  it('defaults real E2E helpers and fixtures to the DeepSeek OpenAI-compatible lane', () => {
    const helpers = readRepoText('e2e/integration-real-helpers.ts');
    const chatSpec = readRepoText('e2e/integration-chat.spec.ts');
    const chatFixture = JSON.parse(readRepoText('secrets/e2e-openai-compatible.demo.json')) as {
      completion?: { model?: string; api_base?: string; api_key?: string; mode?: string };
    };

    expect(helpers).toContain(`const DEFAULT_DEEPSEEK_OPENAI_BASE_URL = "${DEEPSEEK_OPENAI_BASE_URL}"`);
    expect(helpers).toContain(`const DEFAULT_DEEPSEEK_ANTHROPIC_BASE_URL = "${DEEPSEEK_ANTHROPIC_BASE_URL}"`);
    expect(helpers).toContain(`process.env.BACKEND_REAL_MODEL ?? "${DEEPSEEK_MODEL}"`);
    expect(helpers).toContain('process.env.BACKEND_REAL_ANTHROPIC_BASE_URL ??\n  DEFAULT_DEEPSEEK_ANTHROPIC_BASE_URL');
    expect(chatSpec).toContain('chat works with real deepseek completion endpoint');
    expect(chatFixture.completion).toMatchObject({
      model: DEEPSEEK_MODEL,
      api_base: DEEPSEEK_OPENAI_BASE_URL,
      api_key: 'YOUR_ROTATING_API_KEY',
      mode: 'openai',
    });
  });

  it('preserves Anthropic-compatible real runner defaults while keeping OpenAI-specific fixture on OpenAI base', () => {
    const sourceByPath = new Map(
      [
        'e2e/integration-agent-task-isolation.spec.ts',
        'e2e/integration-agent-member-permissions.spec.ts',
        'e2e/integration-context-store-isolation.spec.ts',
        'e2e/integration-governance-member-workflow-continuity.spec.ts',
        'e2e/integration-internal-sandbox-reclaim.spec.ts',
        'e2e/integration-internal-task-isolation.spec.ts',
        'e2e/integration-invite-first-effective-work.spec.ts',
        'e2e/integration-membership-chat-isolation.spec.ts',
        'e2e/integration-resource-policy-observable-effect.spec.ts',
        'e2e/integration-visual-review.spec.ts',
      ].map((relativePath) => [relativePath, readRepoText(relativePath)]),
    );

    for (const [relativePath, text] of sourceByPath) {
      expect(text, relativePath).toContain('BACKEND_REAL_ANTHROPIC_BASE_URL');
      expect(text, relativePath).not.toContain('BACKEND_REAL_OPENAI_BASE_URL');
    }
    const releaseUserStory = readRepoText('e2e/integration-release-user-story.spec.ts');
    expect(releaseUserStory).toContain(`'${DEEPSEEK_ANTHROPIC_BASE_URL}'`);
    expect(releaseUserStory).toContain(`'${DEEPSEEK_OPENAI_BASE_URL}'`);
    expect(releaseUserStory).toContain("upstreamProtocol: 'anthropic_messages'");
    expect(releaseUserStory).toContain("upstreamProtocol: 'openai_chat_completions'");
    expect(releaseUserStory).toContain('anthropicEndpointName');
    expect(sourceByPath.get('e2e/integration-visual-review.spec.ts')).toContain('protocol-anthropic_messages');
    expect(sourceByPath.get('e2e/integration-visual-review.spec.ts')).not.toContain('protocol-openai_chat_completions');
  });
});
