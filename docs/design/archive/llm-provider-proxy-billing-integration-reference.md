# LLM Provider, Proxy, and Billing Integration — Technical Report

Status: `archived-reference-only`
Canonical docs:
- `docs/design/llm-runtime-product-decision-memo-v1.md`
- `docs/plans/llm-runtime-final-implementation-plan-v2.md`

**Purpose:** Integrate OpenClaw and 9router design patterns into AgentSmith to improve LLM provider configuration, unified proxy endpoints, and billing/usage. This document summarizes where each capability lives in the reference projects and how to port or adapt them.

---

## 1. Executive Summary


| Concern             | OpenClaw                                                     | 9router                                                     | AgentSmith (current)                                        |
| ------------------- | ------------------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------- |
| **Provider config** | Config-driven `models.providers` + plugin providers          | DB-driven `providerConnections` + `providerNodes`           | Project endpoints + runtime `provider-catalog` JSON         |
| **Model catalog**   | `loadModelCatalog()` from config + discovery                 | Aliases + combos in localDb; model string `provider/model`  | `ENDPOINT_PROVIDER_OPTIONS` + `models-catalog.runtime.json` |
| **Unified proxy**   | Gateway OpenAI HTTP + method `models.list`                   | Single `v1/chat/completions` with format translation        | Per-endpoint proxy under project route                      |
| **Billing / cost**  | Per-model cost in config; session-cost-usage; provider-usage | Per-request pricing in localDb; usageDb history + cost calc | Usage facts (tokens, requests); no per-model pricing yet    |
| **Display**         | Control UI usage view (sessions, daily, export)              | Dashboard usage API + chart/history                         | Cost & quota dashboard; audit/usage API                     |


**Recommendation:** Fuse 9router’s **provider/connection + combo + pricing + usage recording** with OpenClaw’s **config schema for providers/models and cost**, and keep AgentSmith’s **project-scoped governance** (policy, quota, audit). Add a **unified proxy** that can route by provider/model or combo and record usage with cost.

---

## 2. OpenClaw — Reference Locations and Design

### 2.1 Adding and Configuring LLM Providers/Models

**Where it lives:**

- **Config types:** `openclaw/src/config/types.models.ts`
  - `ModelApi` (e.g. `openai-completions`, `anthropic-messages`, `google-generative-ai`).
  - `ModelProviderConfig`: `baseUrl`, `apiKey?`, `auth?`, `api?`, `headers?`, `models: ModelDefinitionConfig[]`.
  - `ModelDefinitionConfig`: `id`, `name`, `api?`, `reasoning`, `input`, `cost: { input, output, cacheRead, cacheWrite }`, `contextWindow`, `maxTokens`, `compat?`.
  - `ModelsConfig`: `mode?: "merge" | "replace"`, `providers?: Record<string, ModelProviderConfig>`, `bedrockDiscovery?`.
- **Config schema (labels/help):** `openclaw/src/config/schema.help.ts`, `schema.labels.ts` — paths like `models.providers`, `models.providers.*.baseUrl`, `models.providers.*.models`.
- **Model catalog loading:** `openclaw/src/agents/model-catalog.ts`
  - `loadModelCatalog({ config })`: reads `config.models.providers` and optional discovery (e.g. Venice, HuggingFace); returns `ModelCatalogEntry[]` (`id`, `name`, `provider`, `contextWindow`, `reasoning`, `input`).
  - `readConfiguredOptInProviderModels()`: builds catalog from `config.models.providers` for specific providers.
- **Gateway model list:** `openclaw/src/gateway/server-methods/models.ts` — `models.list` uses `loadGatewayModelCatalog()` and `buildAllowedModelSet()` to return allowed models.
- **Gateway model catalog:** `openclaw/src/gateway/server-model-catalog.ts` — `loadGatewayModelCatalog()` calls `loadModelCatalog({ config: loadConfig() })`.
- **Model selection / allowlist:** `openclaw/src/agents/model-selection.ts` — `buildAllowedModelSet()`, `modelKey()`, provider normalization; allowlist comes from agent/config.

**Design points:**

- Providers are a **map** keyed by provider ID; each has `baseUrl`, credentials, and a **list of model definitions** with `id`, `name`, **cost** (input/output/cache per token), and compat.
- Catalog is **merged** from config and optional discovery; gateway exposes a single `models.list` with allowlist applied.
- Cost is **per model** in config; no separate “pricing API” — cost is part of model definition.

### 2.2 Proxy and Central Entrypoint

**Where it lives:**

- **OpenAI-compatible HTTP:** `openclaw/src/gateway/openai-http.ts` — HTTP endpoint that accepts OpenAI-format requests and forwards to the agent/runtime.
- **Gateway methods:** `openclaw/src/gateway/server-methods/chat.ts`, `agent.ts` — internal RPC-style handling; `models.list` in `server-methods/models.ts` as above.
- OpenClaw does **not** implement a single “router” that translates between providers; it uses one gateway and config-driven provider selection per agent/session.

**Design points:**

- One gateway; **models** are chosen from catalog/allowlist; **provider** is implied by model (provider/model id).
- No “combo” or fallback chain in the gateway itself; that’s in 9router.

### 2.3 Billing and Usage

**Where it lives:**

- **Cost resolution:** `openclaw/src/utils/usage-format.ts`
  - `ModelCostConfig`: `input`, `output`, `cacheRead`, `cacheWrite` (per-token rates).
  - `resolveModelCostConfig({ provider, model, config })`: reads from `config.models.providers[provider].models[].cost`.
  - `estimateUsageCost({ usage, cost })`: computes cost from token counts and cost config.
- **Session / cost usage:** `openclaw/src/infra/session-cost-usage.ts`
  - Parses session transcripts and usage; builds `SessionCostSummary`, `CostUsageSummary`, daily series, etc.
  - Uses `resolveModelCostConfig` and `estimateUsageCost` for cost.
- **Provider usage (quotas):** `openclaw/src/infra/provider-usage.ts` (re-exports), `provider-usage.types.ts` — `UsageProviderId`, `ProviderUsageSnapshot`, `UsageWindow` (e.g. for OAuth quota).
- **Provider usage fetch:** `openclaw/src/infra/provider-usage.fetch.*.ts` — per-provider (e.g. Claude, Codex, Gemini) quota/usage fetching.
- **Gateway usage API:** `openclaw/src/gateway/server-methods/usage.ts` — `sessions.usage`, cost summaries, date interpretation, discovery; uses `loadProviderUsageSummary`, `loadCostUsageSummary`, `loadSessionCostSummary`, etc.

**Design points:**

- **Cost** is defined in **config** (per provider/model); **usage** is derived from session data and optional provider APIs.
- Two axes: (1) **session-cost-usage** (what we spent per session/model from transcripts), (2) **provider-usage** (provider-side quotas/windows).
- Control UI: `openclaw/ui/src/ui/views/usage.ts` — Token Usage, filters, CSV/JSON export, session detail.

---

## 3. 9router — Reference Locations and Design

### 3.1 Adding and Configuring LLM Providers/Models

**Where it lives:**

- **Storage:** `9router/src/lib/localDb.js`
  - Default shape: `providerConnections`, `providerNodes`, `modelAliases`, `combos`, `apiKeys`, `settings`, `pricing`.
  - `getProviderConnections(filter)`, `createProviderConnection(data)`, `getProviderNodeById(id)`, `createProviderNode(data)`.
  - `getModelAliases()`, `getComboByName(name)`, combos as `{ name, models: string[] }`.
- **Provider constants:** `9router/src/shared/constants/config.js` — `APIKEY_PROVIDERS`; `9router/src/shared/constants/providers.js` — OpenAI/Anthropic compatible node types.
- **API:** `9router/src/app/api/providers/route.js` — GET list connections (sanitized), POST create (provider, apiKey, name, priority, …); supports OpenAI-compatible and Anthropic-compatible nodes.
- **Model resolution:** `9router/open-sse/services/model.js`
  - `parseModel(modelStr)`: `"provider/model"` → `{ provider, model }`; else alias → `{ provider: null, model, isAlias: true }`.
  - `resolveProviderAlias(alias)`: map short names (e.g. `cc` → `claude`) via `ALIAS_TO_PROVIDER_ID`.
  - `resolveModelAliasFromMap(alias, aliases)`: alias → `provider/model`.
- **SSE layer:** `9router/src/sse/services/model.js` — `getModelInfo(modelStr)`: uses localDb aliases and combos; if combo, returns `provider: null` so caller does combo flow; also resolves OpenAI/Anthropic compatible nodes by prefix.
- **Combos:** `9router/open-sse/services/combo.js` — `getComboModelsFromData(modelStr, combosData)`, `handleComboChat({ body, models, handleSingleModel, log })` — tries each model in order until one succeeds (fallback).

**Design points:**

- **Connections** are stored in DB (not config file); each has provider, credentials, priority, optional defaultModel.
- **Provider nodes** extend the set of providers (e.g. custom OpenAI-compatible endpoints) with prefix, baseUrl, apiType.
- **Model string** is either `provider/model` or an **alias** (resolved via `modelAliases`) or a **combo name** (resolved to list of `provider/model` for fallback).
- **Pricing** is stored in localDb (`pricing`), keyed by provider and model; see below.

### 3.2 Central Proxy and Request Flow

**Where it lives:**

- **Route:** `9router/src/app/api/v1/chat/completions/route.js` — POST calls `handleChat(request)`.
- **Handler:** `9router/src/sse/handlers/chat.js`
  - Validates body, model, API key if required.
  - If model is a **combo**, calls `handleComboChat` with ordered list of models; each try uses `handleSingleModelChat`.
  - For single model: `getModelInfo(modelStr)` → provider + model; then `getProviderCredentials(provider, …)` for an account; token refresh; then `handleChatCore(...)`.
- **Chat core:** `9router/open-sse/handlers/chatCore/` — shared core that does format translation (OpenAI ↔ Claude ↔ Gemini, etc.), upstream request, streaming; calls out to **usage tracking** when done.
- **Translators:** `9router/open-sse/translator/` — request/response translation by provider format.
- **Usage recording:** `9router/open-sse/handlers/chatCore/requestDetail.js` and `9router/open-sse/utils/usageTracking.js` — after response, call `saveRequestUsage({ provider, model, connectionId, tokens, … })` and `appendRequestLog(...)`.

**Design points:**

- **Single entrypoint:** `v1/chat/completions` (and sibling routes like embeddings). Client sends OpenAI-style request with `model`; 9router resolves to provider/model or combo and forwards.
- **Combo** = ordered list of models; on failure (rate limit, error) fallback to next; no per-model config in the request beyond the list.
- **Credentials** come from DB (OAuth or API key per connection); multi-account round-robin/priority is in auth layer.

### 3.3 Pricing and Cost Calculation

**Where it lives:**

- **Default pricing:** `9router/src/shared/constants/pricing.js` — `DEFAULT_PRICING` and `getDefaultPricing()`; structure `provider -> model -> { input, output, cached, reasoning, cache_creation }` (e.g. $ per 1M tokens).
  - `calculateCostFromTokens(tokens, pricing)` in same file.
- **DB pricing:** `9router/src/lib/localDb.js` — `getPricing()`, `updatePricing(body)`, `getPricingForModel(provider, model)` (merge user pricing with defaults).
- **Usage cost:** `9router/src/lib/usageDb.js` — internal `calculateCost(provider, model, tokens)` uses `getPricingForModel`; supports prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens, cache_creation_input_tokens; multiplies by rates and returns dollars.
- **API:** `9router/src/app/api/pricing/route.js` — GET current pricing, PATCH update (body: provider -> model -> { input, output, cached, reasoning, cache_creation }), DELETE reset; GET /api/pricing/defaults.

**Design points:**

- **Pricing** is **per provider/model**, stored in DB and merged with defaults; **cost** is computed at **request end** from token counts.
- Same pricing structure used for **display** (usage analytics) and for **savings comparison** (no real billing by 9router).

### 3.4 Usage Persistence and Display

**Where it lives:**

- **Persistence:** `9router/src/lib/usageDb.js`
  - `saveRequestUsage(entry)`: append to `history[]` with timestamp, provider, model, tokens, connectionId, and **cost** (from `calculateCost`).
  - `getUsageHistory(filter)`, `getUsageStats()` — aggregate by provider/model, recent requests, connection names; `getActiveRequests()` for live pending.
  - File: `~/.9router/usage.json` (history), `log.txt` (append-only log lines).
- **APIs:** `9router/src/app/api/usage/` — `history/route.js`, `chart/route.js`, `logs/route.js`, `request-logs/route.js`, `request-details/route.js`, `stream/route.js` (SSE for live updates), `[connectionId]/route.js`, `providers/route.js` (usage by provider).
- **Dashboard:** Uses above APIs to show usage analytics, token consumption per provider/model, cost over time, recent requests.

**Design points:**

- **Every** chat completion is recorded (provider, model, tokens, cost) in a **history** array; optional log file for ops.
- **Real-time:** `statsEmitter`, `trackPendingRequest`, `getActiveRequests()` for in-flight and recent activity.
- **Cost** on each record is computed at write time from current pricing (so historical view reflects current pricing unless you store raw tokens and recompute).

---

## 4. AgentSmith — Current State

### 4.1 Endpoints and Provider Catalog

**Where it lives:**

- **Resource model:** `agentsmith/packages/api-entry-node/src/resource-models.ts` — `EndpointRecord` (base_url, credential_ref, provider_family, protocol, capabilities, models, defaults, limits).
- **Provider catalog:** `agentsmith/src/lib/endpoints/provider-catalog.ts` — `ENDPOINT_PROVIDER_OPTIONS` from `models-catalog.runtime.json`; per-provider: family, protocol, default_base_url, models (with capabilities). No combos; no aliases.
- **Endpoint API:** `agentsmith/src/lib/api/endpoints/endpoints.ts` — CRUD for endpoints; create includes provider_family, protocol, capabilities, models, defaults.

**Gaps:**

- No **alias** (e.g. `my-chat` → `openai/gpt-4o`); no **combo** (ordered fallback list).
- Provider set is **fixed** in runtime JSON; adding a provider requires code/catalog change (9router adds nodes via API).

### 4.2 Proxy and Governance

**Where it lives:**

- **Routing:** `agentsmith/packages/api-entry-node/src/endpoint-route-handler.ts` — `handleEndpointRoute`; resolves route to workspace/project/endpoint; checks resource policy, quota, member quota, rate limit; then `proxyEndpointRequest`.
- **Proxy:** Same file — `proxyEndpointRequest` loads endpoint, credential, resolves model by capability (chat/rerank/embedding/…), builds upstream URL via `resolveEndpointTaskRoute`, then calls `proxyJsonRequest` (or streaming equivalent).
- **Protocol/capability:** `agentsmith/packages/api-entry-node/src/endpoint-protocol-router.ts` — path → capability (chat, rerank, etc.) and model resolution.

**Design points:**

- **Per-endpoint** proxy: each request is bound to one endpoint (and thus one provider/base_url). No “router” that picks provider from a single model string.
- **Governance** (policy, quota, rate limit, member quota) is already strong; keep it and add **usage recording with cost** and optional **unified proxy** that can route by provider/model or combo.

### 4.3 Usage and Billing

**Where it lives:**

- **Audit/usage store:** `agentsmith/packages/api-entry-node/src/audit-usage-store.ts` — `UsageFactRecord` (tokens_in, tokens_out, requests, duration_ms, result, …); `writeProjectUsageFact`; queries by project, time range, resource_type, end_user_id.
- **Recorders:** `agentsmith/packages/api-entry-node/src/audit-usage-recorders.ts` — `writeProjectAuditEvent`, `writeProjectUsageFact` (used from endpoint-route-handler on success and on governance failures).
- **Chat/stream:** `agentsmith/packages/api-entry-node/src/chat-stream-handler.ts` / `chat-non-stream-handler.ts` — after upstream response, usage facts are written (tokens, etc.); cost is **not** computed (no per-model pricing in AgentSmith yet).

**Gaps:**

- No **per-model or per-provider pricing** config; no **cost** field on usage facts; no **cost aggregation** in dashboard.
- Usage is **project/resource/end_user** oriented; not yet **provider/model** breakdown like 9router.

---

## 5. Integration Design for AgentSmith

### 5.1 Provider and Model Configuration (Fusing OpenClaw + 9router)

**Goals:**

- Support **multiple providers** and **multiple models per provider** with a clear schema (OpenClaw-style).
- Support **aliases** (e.g. `prod-chat` → `openai/gpt-4o`) and **combos** (e.g. `main-combo` → [openai/gpt-4o, anthropic/claude-3-5-sonnet]) for fallback (9router-style).
- Allow **custom/provider nodes** (OpenAI-compatible base URL + prefix) without changing code (9router-style).

**Proposed locations in AgentSmith:**

- **Config/schema (OpenClaw-like):** New types/module, e.g. `packages/api-entry-node/src/llm-provider-config.ts` (or under `src/config` if you have one):
  - `ModelProviderConfig` (baseUrl, apiKey/secretRef, auth, models: ModelDefinitionConfig[]).
  - `ModelDefinitionConfig` (id, name, cost: { input, output, cacheRead, cacheWrite }, contextWindow, capabilities).
  - Optional: `ModelsConfig` (mode, providers, discovery) for merge/replace with existing catalog.
- **Storage:** Either (a) extend **project/workspace config** (e.g. project-level “provider connections” and “model aliases/combos”) or (b) add **tables/stores** in the same doc store used for endpoints (e.g. `provider_connections`, `model_aliases`, `combos`). Prefer (b) if you want UI-driven management like 9router.
- **Reference to copy/adapt:**
  - From **OpenClaw:** `types.models.ts` (ModelProviderConfig, ModelDefinitionConfig, cost shape); `model-catalog.ts` (building a list from config + discovery).
  - From **9router:** `localDb.js` (providerConnections, providerNodes, modelAliases, combos); `open-sse/services/model.js` (parseModel, resolveModelAliasFromMap); `open-sse/services/combo.js` (getComboModelsFromData, handleComboChat).

**Concrete steps:**

1. Define `ModelProviderConfig` and `ModelDefinitionConfig` (and optional `ModelsConfig`) in AgentSmith; add per-model **cost** (input/output/cache) like OpenClaw.
2. Add stores or config for: **provider connections** (or reuse “endpoints” as the connection layer and add a separate “provider registry” that endpoints reference), **model aliases** (alias → provider/model), **combos** (name → ordered list of provider/model).
3. Implement **model resolution**: given a string, return either (provider, model) or (combo name, list of (provider, model)); support provider-node prefix resolution if you add nodes.
4. Keep **existing endpoint resource** for “which base URL and credential to use” and optionally link it to a **provider id** so that pricing and display can be by provider/model.

### 5.2 Unified Proxy and Combo Fallback

**Goals:**

- Optionally expose **one** project-scoped proxy path (e.g. `/v1/chat/completions`) that accepts a **model** string (provider/model, alias, or combo) and routes to the right provider/endpoint; or keep current per-endpoint proxy and add a **router** mode that selects endpoint from model string.
- Implement **combo fallback**: try first model; on retryable failure, try next (reuse 9router’s logic).

**Proposed locations:**

- **Router handler:** New module, e.g. `packages/api-entry-node/src/llm-proxy-router.ts` (or extend `endpoint-route-handler.ts`):
  - Input: project (and workspace), model string, body, auth.
  - Resolve model string to (provider, model) or combo list (see 5.1).
  - For combo: loop over list; for each (provider, model) resolve to **endpoint/connection** (and credential); call upstream; on success return; on retryable error try next.
  - For single: resolve to one endpoint/connection and call upstream.
  - After success: record usage (provider, model, tokens, cost) and audit.
- **Reference:** `9router/src/sse/handlers/chat.js` (handleChat, handleComboChat, handleSingleModelChat); `9router/open-sse/services/combo.js` (handleComboChat, checkFallbackError); `9router/open-sse/handlers/chatCore/` (request/response handling and usage hook).

**Concrete steps:**

1. Add a **route** (e.g. under project) that accepts POST with `model` and body; auth and governance (policy, quota, rate limit) same as current endpoint proxy.
2. Implement **model → endpoint/credential** resolution using provider connections and optional aliases/combos.
3. Implement **combo loop** with retryable-error detection and fallback; re-use or port `checkFallbackError` from 9router.
4. Reuse existing **proxy** (e.g. `proxyJsonRequest` / stream) per chosen endpoint; optionally support format translation (OpenAI ↔ Anthropic, etc.) if you need it (see open-sse/translator).

### 5.3 Pricing and Cost (Fusing OpenClaw + 9router)

**Goals:**

- **Pricing** config: per provider/model (and optionally per project) with input/output/cache/reasoning rates (like both references).
- **Cost** computed at **request end** from token usage and stored with the usage fact (9router-style) so dashboard can show cost per request and aggregates.
- **Resolve cost config** from project/global config or DB (OpenClaw: from config; 9router: from localDb pricing).

**Proposed locations:**

- **Pricing store/config:** Either extend project/workspace config or add a **pricing** store (e.g. project-level or global) keyed by provider + model; structure: `{ input, output, cached?, reasoning?, cache_creation? }` in $/1M tokens.
- **Cost calculation:** New (or extend) module, e.g. `packages/api-entry-node/src/usage-cost.ts`:
  - `getPricingForModel(provider, model)` — from store or defaults (port 9router’s `getPricingForModel` + default pricing map).
  - `calculateCostFromTokens(tokens, pricing)` — same formula as 9router (input, output, cached, reasoning, cache_creation).
- **Usage fact:** Extend `UsageFactRecord` (or add optional fields) with `provider`, `model`, `cost` (number); when recording after chat completion, call `calculateCostFromTokens` and attach.
- **Reference:** `9router/src/lib/usageDb.js` (`calculateCost`), `9router/src/shared/constants/pricing.js`; `openclaw/src/utils/usage-format.ts` (`resolveModelCostConfig`, `estimateUsageCost`).

**Concrete steps:**

1. Add **default pricing** map (provider → model → rates) and **pricing store/API** (GET/PATCH/DELETE) per project or global; validate shape like 9router PATCH.
2. Implement **calculateCostFromTokens** and **getPricingForModel**; ensure token shape supports prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens, cache_creation_input_tokens.
3. In chat completion handler (stream and non-stream), after upstream response and token extraction, call cost calculation and **write usage fact** with provider, model, tokens, cost.
4. Expose **usage API** that can group by provider/model and sum cost (and tokens) for dashboard.

### 5.4 Display (Cost and Usage)

**Goals:**

- **Cost & Quota** dashboard: show usage by **provider** and **model** (and optionally by end_user, time bucket); show **cost** totals and trends (like 9router usage analytics).
- Optional: **sessions/daily** view and CSV/JSON export (like OpenClaw usage view).

**Proposed locations:**

- **Backend:** Extend existing usage/audit API (or add `usage/aggregates` and `usage/by-provider-model`) that query usage facts with groupBy provider, model, time_bucket; include `cost` in response.
- **Frontend:** Extend Cost & Quota dashboard (and any usage tables) to show provider/model columns and cost; add filters by provider/model; optional export (reference: `openclaw/ui/src/ui/views/usage.ts` for export patterns).

**Reference:**

- **9router:** `src/app/api/usage/` (history, chart, stream for live); dashboard components that consume these.
- **OpenClaw:** `openclaw/ui/src/ui/views/usage.ts` (Token Usage, date range, CSV/JSON export), `openclaw/ui/src/ui/controllers/usage.ts` (load data, date params).

---

## 6. Reference Map — Where to Find What


| Feature                  | OpenClaw                                                          | 9router                                                                     | AgentSmith (current)                                       |
| ------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Provider config schema   | `config/types.models.ts`                                          | `localDb.js` (providerConnections, providerNodes)                           | `resource-models.ts` EndpointRecord; `provider-catalog.ts` |
| Model definitions + cost | `types.models.ts` ModelDefinitionConfig.cost                      | `localDb.js` pricing; `pricing.js` DEFAULT_PRICING                          | — (add)                                                    |
| Model catalog load       | `agents/model-catalog.ts`, `gateway/server-model-catalog.ts`      | aliases + combos in localDb; `open-sse/services/model.js`                   | `provider-catalog.ts` + runtime JSON                       |
| Alias / combo            | —                                                                 | `localDb.js` modelAliases, combos; `open-sse/services/model.js`, `combo.js` | — (add)                                                    |
| Proxy entrypoint         | `gateway/openai-http.ts`                                          | `app/api/v1/chat/completions/route.js` → `sse/handlers/chat.js`             | `endpoint-route-handler.ts` (per-endpoint)                 |
| Combo fallback           | —                                                                 | `open-sse/services/combo.js` handleComboChat                                | — (add)                                                    |
| Cost calculation         | `utils/usage-format.ts` resolveModelCostConfig, estimateUsageCost | `usageDb.js` calculateCost; `pricing.js` calculateCostFromTokens            | — (add)                                                    |
| Pricing API              | —                                                                 | `app/api/pricing/route.js`                                                  | — (add)                                                    |
| Usage persistence        | session-cost-usage (files); provider-usage (quotas)               | `usageDb.js` saveRequestUsage, history                                      | `audit-usage-store.ts` writeProjectUsageFact               |
| Usage display            | `gateway/server-methods/usage.ts`; UI `views/usage.ts`            | `app/api/usage/`*; dashboard                                                | Cost & quota dashboard; audit/usage API                    |


---

## 7. Implementation Order Suggestion

1. **Pricing and cost (5.3)** — Add pricing store/defaults and `calculateCostFromTokens`; extend usage facts with provider, model, cost; no UI change yet. This unblocks “cost per request” everywhere.
2. **Provider/model config and resolution (5.1)** — Add ModelProviderConfig/ModelDefinitionConfig; add aliases and combos (store or config); implement model string → (provider, model) or combo list. Keeps current per-endpoint proxy working while preparing for router.
3. **Unified proxy and combo (5.2)** — Add router route and combo fallback; wire model resolution and existing governance; record usage with cost. Optional: format translation if you need multi-format support.
4. **Display (5.4)** — Extend usage APIs and Cost & Quota dashboard with provider/model and cost; optional export and sessions view.

---

## 8. Summary

- **OpenClaw** gives a clean **config schema** for providers and models and **cost on model definition**; **usage** is session/transcript and provider-quota oriented; **single gateway** with models.list and allowlist.
- **9router** gives **DB-driven** provider connections and nodes, **aliases and combos** with fallback, a **single proxy** (`v1/chat/completions`) with format translation, **per-request pricing** in DB and **per-request cost** in usage history, and **usage analytics** APIs and dashboard.
- **AgentSmith** already has **project-scoped endpoints**, **governance** (policy, quota, rate limit), and **usage facts**; it lacks **per-model pricing**, **cost** on usage, **aliases/combos**, and a **unified router** that can route by model string and combo.

By adding **pricing + cost calculation**, **provider/model config + aliases + combos**, and a **unified proxy with fallback**, then exposing **usage by provider/model with cost** in the dashboard, AgentSmith can fuse the strengths of both reference projects while keeping its own governance and multi-tenant model.

---

## Appendix A: Quick Copy/Port Checklist

When implementing in AgentSmith, these files are the primary sources to port or adapt:


| To implement in AgentSmith                              | Copy/adapt from                                                                                                                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model provider + model definition types (with cost)     | `openclaw/src/config/types.models.ts` (ModelProviderConfig, ModelDefinitionConfig, cost shape)                                                                    |
| Model catalog from config                               | `openclaw/src/agents/model-catalog.ts` (readConfiguredOptInProviderModels, merge logic)                                                                           |
| Cost resolution + estimation                            | `openclaw/src/utils/usage-format.ts` (resolveModelCostConfig, estimateUsageCost)                                                                                  |
| Provider connections + nodes + aliases + combos storage | `9router/src/lib/localDb.js` (defaultData shape, getProviderConnections, getModelAliases, getComboByName)                                                         |
| Model string parsing and alias/combo resolution         | `9router/open-sse/services/model.js` (parseModel, resolveModelAliasFromMap); `9router/src/sse/services/model.js` (getModelInfo, getComboModels)                   |
| Combo fallback loop                                     | `9router/open-sse/services/combo.js` (handleComboChat, getComboModelsFromData); `9router/open-sse/services/accountFallback.js` (checkFallbackError)               |
| Pricing defaults + getPricingForModel + calculateCost   | `9router/src/shared/constants/pricing.js` (DEFAULT_PRICING, calculateCostFromTokens); `9router/src/lib/usageDb.js` (calculateCost, merge with getPricingForModel) |
| Save usage with cost after each request                 | `9router/open-sse/handlers/chatCore/requestDetail.js` (saveRequestUsage call); `9router/open-sse/utils/usageTracking.js`                                          |
| Pricing API (GET/PATCH/DELETE)                          | `9router/src/app/api/pricing/route.js`                                                                                                                            |
| Usage history + stats + active requests                 | `9router/src/lib/usageDb.js` (getUsageStats, getUsageHistory, getActiveRequests); `9router/src/app/api/usage/history/route.js`, `chart/route.js`                  |
| Single proxy entry + model routing                      | `9router/src/sse/handlers/chat.js` (handleChat, handleSingleModelChat, combo branch)                                                                              |

