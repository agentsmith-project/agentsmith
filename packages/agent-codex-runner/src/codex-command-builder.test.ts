import { describe, expect, it } from 'vitest';
import { buildCodexExecArgs, buildTaskCodexConfig } from './codex-command-builder.js';

describe('codex-command-builder', () => {
  it('writes model context window and compact limit into task codex config', () => {
    const config = buildTaskCodexConfig({
      model: 'glm-5-turbo',
      endpointProxyBase: 'http://proxy.local',
      wireApi: 'responses',
      modelContextWindow: 128000,
      modelAutoCompactTokenLimit: 121600,
    });

    expect(config).toContain('model_context_window = 128000');
    expect(config).toContain('model_auto_compact_token_limit = 121600');
  });

  it('writes model context window and compact limit into codex exec args', () => {
    const args = buildCodexExecArgs({
      model: 'glm-5-turbo',
      prompt: 'hello',
      cwd: '/tmp/task',
      endpointProxyBase: 'http://proxy.local',
      wireApi: 'responses',
      modelContextWindow: 128000,
      modelAutoCompactTokenLimit: 121600,
      notebookMode: true,
      yolo: true,
    });

    expect(args).toContain('model_context_window=128000');
    expect(args).toContain('model_auto_compact_token_limit=121600');
  });
});
