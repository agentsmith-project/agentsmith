import { describe, expect, it } from 'vitest';
import {
  buildCodexExecArgs,
  buildTaskCodexConfig,
  buildTaskCodexModelCatalog,
} from './codex-command-builder.js';

describe('codex-command-builder', () => {
  it('writes model context window, compact limit, and execution ticket header env into task codex config', () => {
    const config = buildTaskCodexConfig({
      model: 'placeholder-model',
      endpointProxyBase: 'http://proxy.local',
      wireApi: 'responses',
      modelContextWindow: 128000,
      modelMaxOutputTokens: 6400,
      modelAutoCompactTokenLimit: 121600,
      modelCatalogPath: '/tmp/catalog.json',
      executionTicketHeaderEnvName: 'MBOS_CODEX_PROXY_EXECUTION_TICKET',
    });

    expect(config).toContain('model_context_window = 128000');
    expect(config).toContain('model_auto_compact_token_limit = 121600');
    expect(config).toContain('model_catalog_json = "/tmp/catalog.json"');
    expect(config).toContain('env_http_headers = { "x-agentsmith-execution-ticket" = "MBOS_CODEX_PROXY_EXECUTION_TICKET" }');
    expect(config).not.toContain('max_output_tokens');
    expect(config).not.toContain('Authorization');
    expect(config).not.toContain('MBOS_CODEX_PROXY_AUTH_HEADER');
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
      modelMaxOutputTokens: 6400,
      modelAutoCompactTokenLimit: 121600,
      modelCatalogPath: '/tmp/catalog.json',
      resumeSession: true,
    });

    expect(args.slice(0, 4)).toEqual(['exec', 'resume', '--last', '--dangerously-bypass-approvals-and-sandbox']);
    expect(args).toContain('--json');
    expect(args).toContain('model_context_window=128000');
    expect(args).toContain('model_auto_compact_token_limit=121600');
    expect(args).toContain('model_catalog_json="/tmp/catalog.json"');
    expect(args.join(' ')).not.toContain('max_output_tokens');
    expect(args.join(' ')).not.toContain('experimental_bearer_token');
    expect(args).not.toContain('--full-auto');
  });

  it('builds a fresh exec command when local codex state was not proven reusable for this task', () => {
    const args = buildCodexExecArgs({
      model: 'placeholder-model',
      prompt: 'hello',
      cwd: '/tmp/task',
      endpointProxyBase: 'http://proxy.local',
      wireApi: 'responses',
      resumeSession: false,
    });

    expect(args.slice(0, 4)).toEqual(['exec', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check', '--json']);
    expect(args).not.toContain('resume');
    expect(args).not.toContain('--last');
  });

  it('derives config and exec compact limits from max output tokens without passing raw output limits', () => {
    const config = buildTaskCodexConfig({
      model: 'placeholder-model',
      endpointProxyBase: 'http://proxy.local',
      wireApi: 'responses',
      modelContextWindow: 200000,
      modelMaxOutputTokens: 32000,
    });
    const args = buildCodexExecArgs({
      model: 'placeholder-model',
      prompt: 'hello',
      cwd: '/tmp/task',
      endpointProxyBase: 'http://proxy.local',
      wireApi: 'responses',
      modelContextWindow: 200000,
      modelMaxOutputTokens: 32000,
    });

    expect(config).toContain('model_auto_compact_token_limit = 168000');
    expect(config).not.toContain('max_output_tokens');
    expect(args).toContain('model_auto_compact_token_limit=168000');
    expect(args.join(' ')).not.toContain('max_output_tokens');
  });

  it('builds a text-only model catalog for a proxy-backed codex alias', () => {
    const catalogText = buildTaskCodexModelCatalog({
      model: 'placeholder-model',
      modelContextWindow: 200000,
      modelMaxOutputTokens: 32000,
      applyPatchToolType: 'function',
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
    expect(catalog.models[0]?.context_window).toBe(200000);
    expect(catalog.models[0]?.auto_compact_token_limit).toBe(168000);
    expect(catalog.models[0]?.effective_context_window_percent).toBe(84);
    expect(catalog.models[0]?.apply_patch_tool_type).toBe('function');
    expect(catalog.models[0]?.input_modalities).toEqual(['text']);
    expect(catalog.models[0]?.supports_search_tool).toBe(false);
    expect(catalog.models[0]?.supports_parallel_tool_calls).toBe(false);
    expect(catalog.models[0]).not.toHaveProperty('max_output_tokens');
    expect(catalogText).not.toContain('max_output_tokens');
  });

  it('emits a freeform apply_patch tool type only when catalog truth says so', () => {
    const catalogText = buildTaskCodexModelCatalog({
      model: 'native-responses-model',
      modelContextWindow: 128000,
      modelAutoCompactTokenLimit: 121600,
      applyPatchToolType: 'freeform',
    });
    const catalog = JSON.parse(catalogText) as {
      models: Array<Record<string, unknown>>;
    };

    expect(catalog.models[0]?.apply_patch_tool_type).toBe('freeform');
  });

  it('rounds catalog effective context percent from the emitted compact limit', () => {
    const catalogText = buildTaskCodexModelCatalog({
      model: 'task-profile-model',
      modelContextWindow: 128000,
      modelMaxOutputTokens: 8192,
      applyPatchToolType: 'function',
    });
    const catalog = JSON.parse(catalogText) as {
      models: Array<Record<string, unknown>>;
    };

    expect(catalog.models[0]?.auto_compact_token_limit).toBe(119808);
    expect(catalog.models[0]?.effective_context_window_percent).toBe(94);
  });
});
