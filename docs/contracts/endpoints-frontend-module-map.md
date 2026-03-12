# Endpoints Frontend Module Contract

Applies to route:
`src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/endpoints/page.tsx`

## 1. Module Boundaries

- Route page (`page.tsx`)
  - validates URL params
  - applies permission gate
  - composes page-level component only
- View component
  - `src/components/endpoints/EndpointsPage.tsx`
  - owns toolbar/dialog/table composition
- Data hooks
  - `src/lib/endpoints/use-endpoints-data.ts`
  - `src/lib/endpoints/use-endpoints-mutations.ts`
- Table contract
  - `src/lib/endpoints/use-endpoints-table-columns.tsx`
  - row actions are callback-driven and typed

## 2. Permission and Behavior Rules

- Read access requires one of:
  - `project:endpoint:use`
  - `project:manage`
- Mutations require:
  - `project:manage`
- No compatibility fallback paths.
- Fail fast on invalid payload and invalid params.

## 3. Data and API Contract

- Endpoint payload follows `docs/contracts/endpoints-capability-contract.md`.
- When model catalog capability is enabled, catalog metadata and sync flow follow `docs/contracts/model-catalog-project-pricing-contract.md`.
- Frontend must not call remote provider catalogs at runtime.
- Create/update/import/export must preserve capability semantics:
  - `chat_completion`
  - `multimodal_completion`
  - `embedding`
  - `reranker`
  - `image_generation`
  - `video_generation`

## 4. UX Contract

- Provider/model selection is capability-first.
- Display name shown to user should prioritize endpoint display name.
- Model id remains visible as secondary metadata.
- Chat model selector only lists completion-capable endpoints.

## 5. Test Contract

- Route unit tests:
  - URL validation
  - permission denied
  - successful render
- Hook tests:
  - data query enable/disable behavior
  - create/update/delete/import mutation success + failure
- E2E:
  - endpoint create/edit/delete/import/export flows
  - CORS-safe update path (PUT preflight allowed)
