# Endpoint Proxy Protocol Bridge Contract

## Scope

This contract defines how the single endpoint proxy egress handles protocol negotiation and conversion for:

- `openai_completion` (`/proxy/chat/completions`)
- `openai_responses` (`/proxy/responses`)
- `anthropic` (`/proxy/messages`)

The proxy entrypoint remains:

- `POST /api/v1/workspaces/{workspace}/projects/{project}/endpoints/{endpointId}/proxy/{proxyPath}`

## Runtime Truth

- Endpoint record is authoritative for target protocol.
- Endpoint must persist `protocol` and `meta.compatibility_interface`.
- `meta.compatibility_interface` is derived from protocol:
  - `anthropic_compatible` -> `anthropic_compatible`
  - all others -> `openai_compatible`

## Negotiation Rules

1. Source wire protocol is inferred from `proxyPath`:
   - `chat/completions` -> `openai_completion`
   - `responses` -> `openai_responses`
   - `messages` -> `anthropic`
2. Target wire protocol is derived from endpoint protocol:
   - endpoint `anthropic_compatible` -> target `anthropic`
   - otherwise target `openai_completion` except passthrough where source already matches
3. Requests are normalized through canonical chat semantics before target encoding.
4. Responses are converted back to source protocol when source != target.

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

## Transparency Headers

Each proxy response includes:

- `x-agentsmith-proxy-source-protocol`
- `x-agentsmith-proxy-target-protocol`
- `x-agentsmith-proxy-converted` (`0`/`1`)

## Governance Requirements

- Frontend endpoint creation/editing must always submit `protocol` explicitly.
- Provider and custom endpoint flows must expose compatibility interface in UI.
- Endpoint table must display compatibility interface for auditability.
- Regression tests must cover unified proxy cross-protocol flows.

## Evidence

Primary implementation:

- `packages/api-entry-node/src/protocol-bridge.ts`
- `packages/api-entry-node/src/http-utils.ts`
- `packages/api-entry-node/src/anthropic-sse-translate.ts`

Primary tests:

- `packages/api-entry-node/src/protocol-bridge.test.ts`
- `packages/api-entry-node/src/http-utils.test.ts`
- `packages/api-entry-node/src/anthropic-sse-translate.test.ts`
- `packages/api-entry-node/src/index.test.ts`
