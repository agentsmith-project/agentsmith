import { describe, expect, it } from 'vitest';
import {
  buildCodexExecArgs,
  buildTaskCodexConfig,
  buildTaskCodexModelCatalog,
} from './codex-command-builder.js';

describe('codex-command-builder', () => {
  it('writes model context window and compact limit into task codex config', () => {
    const config = buildTaskCodexConfig({
      model: 'glm-5-turbo',
      endpointProxyBase: 'http://proxy.local',
      wireApi: 'responses',
      modelContextWindow: 128000,
      modelAutoCompactTokenLimit: 121600,
      modelCatalogPath: '/tmp/catalog.json',
    });

    expect(config).toContain('model_context_window = 128000');
    expect(config).toContain('model_auto_compact_token_limit = 121600');
    expect(config).toContain('model_catalog_json = "/tmp/catalog.json"');
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
      modelCatalogPath: '/tmp/catalog.json',
      resumeSession: true,
      yolo: true,
    });

    expect(args.slice(0, 3)).toEqual(['exec', 'resume', '--last']);
    expect(args).toContain('model_context_window=128000');
    expect(args).toContain('model_auto_compact_token_limit=121600');
    expect(args).toContain('model_catalog_json="/tmp/catalog.json"');
  });

  it('builds a text-only model catalog for a proxy-backed codex alias', () => {
    const catalogText = buildTaskCodexModelCatalog({
      model: 'glm-5-turbo',
      modelContextWindow: 128000,
      modelAutoCompactTokenLimit: 121600,
      inputModalities: ['text'],
      supportsSearchTool: false,
      supportsParallelToolCalls: false,
    });
    const catalog = JSON.parse(catalogText) as {
      models: Array<Record<string, unknown>>;
    };

    expect(catalog.models).toHaveLength(1);
    expect(catalog.models[0]?.slug).toBe('glm-5-turbo');
    expect(catalog.models[0]?.context_window).toBe(128000);
    expect(catalog.models[0]?.auto_compact_token_limit).toBe(121600);
    expect(catalog.models[0]?.input_modalities).toEqual(['text']);
    expect(catalog.models[0]?.supports_search_tool).toBe(false);
    expect(catalog.models[0]?.supports_parallel_tool_calls).toBe(false);
  });
});
