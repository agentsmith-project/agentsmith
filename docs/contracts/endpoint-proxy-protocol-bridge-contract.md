# Endpoint Proxy Protocol Bridge Contract

## Scope

This contract defines the project-scoped endpoint proxy and llm-gateway proxy behavior for canonical protocol-prefixed client paths.

Supported client paths:

- `openai/chat/completions`
- `openai/responses`
- `anthropic/messages`
- `anthropic/messages/count_tokens`

The proxy entrypoints remain:

- `POST /api/v1/workspaces/{workspace}/projects/{project}/endpoints/{endpointId}/proxy/{proxyPath}`
- `POST /api/v1/workspaces/{workspace}/projects/{project}/llm-gateway/{proxyPath}`

## Runtime Truth

- `endpoint.upstream_protocol` is the only protocol truth on the endpoint record.
- `meta.compatibility_interface` is a derived display field only.
- Canonical protocol-prefixed client paths are the only supported public proxy ingress paths.
- Bare paths such as `chat/completions`, `responses`, `messages`, and `messages/count_tokens` are not supported.
- Alias client paths such as `openai/v1/...` and `anthropic/v1/...` are not supported.

## Negotiation Rules

1. Source wire protocol is inferred from the canonical client `proxyPath`.
2. Target wire protocol is derived from `endpoint.upstream_protocol`.
3. Requests are normalized through the bridge plan before upstream encoding.
4. Responses are converted back to the canonical client protocol when source and target differ.

## Supported Conversion Matrix

### Non-streaming

All pairs in `{anthropic, openai_completion, openai_responses}` are supported.

### Streaming

Supported:

- `openai_responses -> openai_completion`
- `openai_completion -> anthropic`
- `anthropic -> openai_completion`
- `anthropic -> openai_responses`

Unsupported stream conversions return `422` with:

- `error_code: PROTOCOL_STREAM_CONVERSION_NOT_SUPPORTED`
- `source_protocol`
- `target_protocol`

## Error Semantics

- llm-gateway invalid client path: `422 VALIDATION_ERROR: gateway_proxy_path_not_supported`
- endpoint-scoped invalid client path: `422 VALIDATION_ERROR: endpoint_proxy_path_not_supported`

## Transparency Headers

Each proxy response includes:

- `x-agentsmith-proxy-source-protocol`
- `x-agentsmith-proxy-target-protocol`
- `x-agentsmith-proxy-converted` (`0`/`1`)

## Governance Requirements

- Frontend endpoint creation and edit flows must submit `upstream_protocol` explicitly.
- Compatibility interface may be shown in UI as a derived label, but it must not be treated as the protocol truth.
- Regression tests must cover canonical proxy paths and rejection of bare-path ingress.

## Evidence

Primary implementation:

- `packages/api-entry-node/src/endpoint-route-handler.ts`
- `packages/api-entry-node/src/protocol-bridge.ts`
- `packages/api-entry-node/src/http-utils.ts`
- `packages/api-entry-node/src/universal-proxy-service.ts`

Primary tests:

- `packages/api-entry-node/src/endpoint-route-handler.test.ts`
- `packages/api-entry-node/src/__integration__/endpoint-proxy-bridges.integration.test.ts`
- `packages/api-entry-node/src/__integration__/user-api-keys.integration.test.ts`
