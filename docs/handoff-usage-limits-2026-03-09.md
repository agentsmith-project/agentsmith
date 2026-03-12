# Usage Limits Handoff

Last updated: 2026-03-09

Owner at handoff: Codex

Current commit:

- `3d52893` `Improve usage limits visibility`

## Context

> Review note (2026-03-10): this handoff records the implementation state around commit `3d52893`, but it should not be treated as the final product direction. In particular, `Usage` should remain a low-cognitive per-endpoint consumption view, `GET /limits/summary` should stay the primary source of truth, and any resource-policy fallback should be considered temporary diagnostic/configuration projection only.

> Status note (2026-03-10): the current product baseline is `Usage / Audit / Runtime`. `release-ops` has been removed as an independent surface and should not be referenced as an active destination in follow-up work.

This handoff covers the ongoing work on the project `Usage` page for AgentSmith:

- page route: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/usage/page.tsx`
- primary component: `src/components/audit-usage/UsagePage.tsx`
- primary view: `src/components/audit-usage/UsageView.tsx`

The user expectation is:

1. A normal project member should be able to open `Usage` and understand their own current usage.
2. The page should support selecting a specific endpoint.
3. For the selected endpoint, the page should show usage/limit dimensions by window:
   - minute
   - 5 hours
   - day
4. The page should separate:
   - rate / requests
   - spending / USD
5. The view should be useful for personal planning, not only admin governance.

## High-Level Structure

The current `Usage` implementation now has three data layers:

1. Usage facts for the current user
   - Hook: `useUsageRecords`
   - File: `src/lib/hooks/use-audit-usage.ts`
   - Purpose: simple request trend and per-resource usage history

2. Limit summary projection from backend
   - Hook: `useLimitsSummary`
   - API: `GET /workspaces/{workspace}/projects/{project}/limits/summary`
   - Purpose: canonical endpoint-grouped limits projection for Usage UI

3. Resource policy fallback
   - Hook: `useResourcePolicy`
   - API: `GET /workspaces/{workspace}/projects/{project}/resources/endpoint/{id}/policy`
   - Purpose: if `limits/summary` does not return endpoint limits, project configured endpoint policy rules into the Usage page as a fallback

The current page flow is:

1. Determine current user scope via `defaultEndUserId ?? currentUserId`
2. Query KPI and usage records for only that user
3. Query limit summary for the project
4. Query endpoints list to populate endpoint selector
5. If a concrete endpoint is selected and `limits/summary` has no entry for it:
   - fetch the endpoint resource policy
   - merge root rules + subject override rules for current user
   - convert policy rules into Usage limit cards

## Files Touched

Primary code:

- [UsagePage.tsx](/home/percy/works/mbos-v1/agentsmith/src/components/audit-usage/UsagePage.tsx)
- [UsageView.tsx](/home/percy/works/mbos-v1/agentsmith/src/components/audit-usage/UsageView.tsx)
- [audit-usage.ts](/home/percy/works/mbos-v1/agentsmith/src/lib/api/endpoints/audit-usage.ts)
- [use-members.ts](/home/percy/works/mbos-v1/agentsmith/src/lib/hooks/use-members.ts)

Tests:

- [UsagePage.test.tsx](/home/percy/works/mbos-v1/agentsmith/src/components/audit-usage/__tests__/UsagePage.test.tsx)

Messages:

- [zh-CN.json](/home/percy/works/mbos-v1/agentsmith/src/messages/zh-CN.json)
- [en-US.json](/home/percy/works/mbos-v1/agentsmith/src/messages/en-US.json)

Relevant supporting code:

- [use-audit-usage.ts](/home/percy/works/mbos-v1/agentsmith/src/lib/hooks/use-audit-usage.ts)
- [use-endpoints-data.ts](/home/percy/works/mbos-v1/agentsmith/src/lib/endpoints/use-endpoints-data.ts)
- [resource-policy constants](/home/percy/works/mbos-v1/agentsmith/src/lib/constants/resource-policy.ts)
- [usage-limits-summary-contract.md](/home/percy/works/mbos-v1/agentsmith/docs/contracts/usage-limits-summary-contract.md)

## What Was Changed

### 1. Usage time window changed to backend-safe range

Previous state:

- `Usage` used `7d` / `30d`
- backend rejects usage ranges beyond `48h` with `time_range_exceeds_48h`

Current state:

- UI now uses `24h` / `48h`
- trend and period labels were updated in i18n

Reason:

- retrying with invalid time ranges made the page permanently fail

### 2. Endpoint selector added

Previous state:

- page was fixed to a single "my usage" view with no endpoint filter

Current state:

- endpoint selector exists in `UsageView`
- selected endpoint is wired back into `UsagePage`
- when endpoint is selected, usage query adds:
  - `resource_type=endpoint`
  - `resource_id=<selected endpoint id>`

### 3. Limit mode selector added

Current state:

- selector supports:
  - `all`
  - `rate`
  - `spending`

This affects:

- selected endpoint dimension cards
- per-endpoint grouped limit sections

### 4. Endpoint dimension card section added

Current state:

- when a single endpoint is selected, `UsageView` renders a card-like dimension section
- each card shows:
  - rate or spending group
  - window label
  - remaining percentage
  - progress bar
  - `used / max` with unit

This is the part intended to move the page closer to the screenshot the user provided.

### 5. `limits/summary` parsing was made more tolerant

File:

- [audit-usage.ts](/home/percy/works/mbos-v1/agentsmith/src/lib/api/endpoints/audit-usage.ts)

Changes:

- numeric strings can now parse as numbers
- more key aliases are accepted:
  - snake_case
  - camelCase
  - common alternates like `limit`, `usagePct`, `endpointId`, `endpointName`
- more tolerant mapping for:
  - `kind`
  - `window`
  - `metric`

Intent:

- avoid losing all limit data because backend naming or serialization differs slightly

### 6. Resource policy fallback added

This is the most important functional change.

Problem observed:

- user configured endpoint limits in Resource Policy UI
- `Usage` still showed "no endpoint limit data"
- selected endpoint could exist, but `limits/summary` might not project that configuration back yet

Current fallback behavior:

1. If selected endpoint is `all`, do nothing.
2. If selected endpoint exists in `limits/summary`, use `limits/summary`.
3. Otherwise:
   - load endpoint resource policy via `useResourcePolicy`
   - merge root endpoint rules
   - if current user is known, merge subject override rules for that user
   - convert these policy keys to Usage cards:
     - `endpoint.requests_per_minute`
     - `endpoint.requests_per_5_hours`
     - `endpoint.requests_per_day`
     - `endpoint.spending_usd_per_minute`
     - `endpoint.spending_usd_per_5_hours`
     - `endpoint.spending_usd_per_day`

Important implementation detail:

- fallback uses configured values as `max`
- fallback currently sets:
  - `used = 0`
  - `remaining = max`
  - `usagePct = 0`

This means:

- the fallback is currently a configuration projection, not a real usage consumption snapshot
- it is still useful to show the user what limit dimensions exist
- it does not yet calculate actual remaining values from backend usage counters

## Current Known State

### Confirmed good

1. Worktree is clean after commit `3d52893`.
2. Tests passing:
   - `npm run test -- src/components/audit-usage/__tests__/UsagePage.test.tsx`
3. Typecheck passing:
   - `npx tsc --noEmit`
4. Frontend was restarted on `http://localhost:3001`.

### Still unresolved / uncertain

The main unresolved question is:

- why the user still saw "current response has no data" or effectively empty endpoint limits after configuring resource policy

Possible explanations:

1. The selected endpoint id in Usage is not the same id as the endpoint being configured in Resource Policy.
2. `useResourcePolicy` call may be returning no matching `rate_limits` / `spending_limits` for that endpoint in the user’s live environment.
3. The configured rule may exist only in a form not currently matched by the fallback mapping.
4. The configured subject override may not match `currentUserId` / `defaultEndUserId`.
5. Backend resource policy route may be returning root policy only, empty rules, or data under a shape not yet handled.

At handoff time, the UI and fallback logic are implemented, but the live environment behavior has not yet been validated end-to-end against the exact endpoint the user configured.

## What The Next Engineer Should Do

### Immediate next step

Add a temporary debug panel to the `Usage` page for the selected endpoint.

Recommended debug payloads:

1. `selectedEndpointId`
2. `effectiveEndUserId`
3. `hasLimitsForSelectedEndpoint`
4. `limitsSummary?.endpoints.length`
5. `resourcePolicyQuery.data`
6. `fallbackEndpointFromPolicy`

Reason:

- this will immediately tell whether the backend is returning policy rules and whether the frontend fallback mapper is producing cards

### If backend returns policy but UI still empty

Check these mappings in [UsagePage.tsx](/home/percy/works/mbos-v1/agentsmith/src/components/audit-usage/UsagePage.tsx):

- user subject match:
  - `subject.subject_type === 'user'`
  - `subject.subject_id === effectiveEndUserId`
- rule key mapping:
  - minute
  - 5 hours
  - day
  - spending per minute / 5 hours / day

### If backend policy route returns empty rules

Then the bug is not in Usage rendering.

Likely next action:

1. inspect Resource Policy save path
2. inspect endpoint policy fetch route
3. verify that the saved config in Resource Policy page is the same resource and subject combination

### If backend `limits/summary` should be authoritative

Then coordinate with backend to ensure `GET /limits/summary` returns:

1. endpoint-grouped entries
2. minute / 5h / day windows
3. rate and spending snapshots
4. actual `used`, `remaining`, and `usage_pct`

That would allow removing or downgrading the resource-policy fallback.

## Recommended Technical Direction

Short term:

1. Keep the current fallback.
2. Add explicit debug visibility for live diagnosis.
3. Confirm whether configured subject override and selected endpoint match the current user/session.

Medium term:

1. Make `limits/summary` the single authoritative source for Usage limit cards.
2. Keep resource-policy fetch only as an optional fallback or remove it if backend projection becomes reliable.
3. Introduce a clear UI distinction:
   - configured limit
   - consumed usage
   - remaining capacity

Right now the fallback only guarantees configured dimensions are visible, not live remaining values.

## Validation Checklist

After the next change, validate in this order:

1. Open Resource Policy page and note exact endpoint id.
2. Confirm the current logged-in user id.
3. Open Usage page.
4. Select the same endpoint id.
5. Verify the page shows cards for:
   - minute rate
   - 5h rate
   - day rate
   - minute spending
   - 5h spending
   - day spending
6. Toggle:
   - `all`
   - `rate`
   - `spending`
7. Confirm:
   - `all` shows all dimensions
   - `rate` hides spending
   - `spending` hides rate

## Commands Used Recently

Useful local commands for the next engineer:

```bash
npm run test -- src/components/audit-usage/__tests__/UsagePage.test.tsx
npx tsc --noEmit
make web
```

## Current Runtime Note

At handoff time the frontend dev server was restarted and listening on:

- `http://localhost:3001`

No guarantee is made that the process will still be alive when the next engineer picks this up. Restart with:

```bash
make web
```
