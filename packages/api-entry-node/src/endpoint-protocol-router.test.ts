import { describe, expect, it } from 'vitest';
import {
  isCapabilitySupportedByProtocol,
  resolveEndpointTaskRoute,
} from './endpoint-protocol-router.js';
import type { EndpointRecord } from './resource-models.js';

function buildEndpoint(upstreamProtocol: EndpointRecord['upstream_protocol']): EndpointRecord {
  return {
    id: 'ep_1',
    workspace_id: 'ws_1',
    project_id: 'proj_1',
    name: 'endpoint',
    model: 'gpt-4o-mini',
    type: 'catalog',
    base_url: 'https://api.example.com/v1',
    status: 'active',
    upstream_protocol: upstreamProtocol,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

describe('endpoint protocol router', () => {
  it('resolves openai-compatible paths for core tasks', () => {
    const endpoint = buildEndpoint('openai_chat_completions');
    expect(resolveEndpointTaskRoute(endpoint, 'rerank')).toEqual({
      capability: 'rerank',
      proxyPath: 'rerank',
    });
    expect(resolveEndpointTaskRoute(endpoint, 'image_generation')).toEqual({
      capability: 'image_generation',
      proxyPath: 'images/generations',
    });
    expect(resolveEndpointTaskRoute(endpoint, 'video_generation_create')).toEqual({
      capability: 'video_generation',
      proxyPath: 'videos/generations',
    });
    expect(resolveEndpointTaskRoute(endpoint, 'video_generation_poll', 'job_1')).toEqual({
      capability: 'video_generation',
      proxyPath: 'videos/generations/job_1',
    });
    expect(resolveEndpointTaskRoute(endpoint, 'video_generation_cancel', 'job_1')).toEqual({
      capability: 'video_generation',
      proxyPath: 'videos/generations/job_1/cancel',
    });
  });

  it('rejects unsupported capability by protocol matrix', () => {
    expect(isCapabilitySupportedByProtocol('google_gemini', 'rerank')).toBe(false);
    expect(isCapabilitySupportedByProtocol('glm_native', 'rerank')).toBe(false);
    expect(isCapabilitySupportedByProtocol('dashscope_native', 'rerank')).toBe(false);
    expect(isCapabilitySupportedByProtocol('openai_chat_completions', 'rerank')).toBe(true);
    expect(isCapabilitySupportedByProtocol('openai_responses', 'rerank')).toBe(true);
    expect(isCapabilitySupportedByProtocol('anthropic_messages', 'chat_completion')).toBe(true);
    expect(isCapabilitySupportedByProtocol('anthropic_messages', 'rerank')).toBe(false);
    expect(isCapabilitySupportedByProtocol('google_gemini', 'image_generation')).toBe(false);
  });

  it('routes anthropic compatible chat traffic to messages endpoint', () => {
    const endpoint = buildEndpoint('anthropic_messages');
    expect(resolveEndpointTaskRoute(endpoint, 'chat')).toEqual({
      capability: 'chat_completion',
      proxyPath: 'messages',
    });
  });
});
