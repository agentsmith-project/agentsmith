import { describe, expect, it } from 'vitest';
import {
  buildCodexExecArgs,
  buildTaskCodexConfig,
  buildTaskCodexModelCatalog,
} from './codex-command-builder.js';

describe('codex-command-builder', () => {
  it('writes model context window, compact limit, and env-based auth into task codex config', () => {
    const config = buildTaskCodexConfig({
      model: 'placeholder-model',
      endpointProxyBase: 'http://proxy.local',
      wireApi: 'responses',
      modelContextWindow: 128000,
      modelAutoCompactTokenLimit: 121600,
      modelCatalogPath: '/tmp/catalog.json',
      proxyAuthHeaderEnvName: 'MBOS_CODEX_PROXY_AUTH_HEADER',
    });

    expect(config).toContain('model_context_window = 128000');
    expect(config).toContain('model_auto_compact_token_limit = 121600');
    expect(config).toContain('model_catalog_json = "/tmp/catalog.json"');
    expect(config).toContain('env_http_headers = { Authorization = "MBOS_CODEX_PROXY_AUTH_HEADER" }');
    expect(config).not.toContain('experimental_bearer_token');
  });


  it('omits env-based auth headers when no auth env name is provided', () => {
    const config = buildTaskCodexConfig({
      model: 'placeholder-model',
      endpointProxyBase: 'http://proxy.local',
      wireApi: 'responses',
    });

    expect(config).not.toContain('env_http_headers');
  });

  it('builds yolo exec args without persisting auth in argv', () => {
    const args = buildCodexExecArgs({
      model: 'placeholder-model',
      prompt: 'hello',
      cwd: '/tmp/task',
      endpointProxyBase: 'http://proxy.local',
      wireApi: 'responses',
      modelContextWindow: 128000,
      modelAutoCompactTokenLimit: 121600,
      modelCatalogPath: '/tmp/catalog.json',
      resumeSession: true,
    });

    expect(args.slice(0, 4)).toEqual(['exec', 'resume', '--last', '--dangerously-bypass-approvals-and-sandbox']);
    expect(args).toContain('--json');
    expect(args).toContain('model_context_window=128000');
    expect(args).toContain('model_auto_compact_token_limit=121600');
    expect(args).toContain('model_catalog_json="/tmp/catalog.json"');
    expect(args.join(' ')).not.toContain('experimental_bearer_token');
    expect(args).not.toContain('--full-auto');
  });

  it('builds a text-only model catalog for a proxy-backed codex alias', () => {
    const catalogText = buildTaskCodexModelCatalog({
      model: 'placeholder-model',
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
    expect(catalog.models[0]?.slug).toBe('placeholder-model');
    expect(catalog.models[0]?.display_name).toBe('placeholder-model');
    expect(catalog.models[0]?.context_window).toBe(128000);
    expect(catalog.models[0]?.auto_compact_token_limit).toBe(121600);
    expect(catalog.models[0]?.input_modalities).toEqual(['text']);
    expect(catalog.models[0]?.supports_search_tool).toBe(false);
    expect(catalog.models[0]?.supports_parallel_tool_calls).toBe(false);
  });
});
