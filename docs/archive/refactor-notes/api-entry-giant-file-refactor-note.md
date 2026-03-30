# API Entry Giant-File Refactor Note

## Scope

This refactor line focused on reducing the maintenance risk of oversized files in
`packages/api-entry-node`, `packages/application`, `packages/adapters-private`,
and `src/lib/api/types`.

The goal was structural cleanup only:

- keep runtime behavior unchanged
- keep contracts unchanged
- keep existing gates green
- move shared helpers and domain tests into stable submodules

## Completed

### Request pipeline

- `packages/api-entry-node/src/request-handler.ts` was reduced to a thin top-level request pipeline.
- Internal and governance-only route handling was extracted into:
  - `packages/api-entry-node/src/request-handler/internal-routes.ts`
  - `packages/api-entry-node/src/request-handler/route-kind-guards.ts`
  - `packages/api-entry-node/src/request-handler/required-project-permissions.ts`
  - `packages/api-entry-node/src/request-handler/governance-route-utils.ts`
  - `packages/api-entry-node/src/request-handler/build-upstream-url.ts`

### Mega integration test reduction

- `packages/api-entry-node/src/index.test.ts` was reduced from the previous mega-test shape into a thin integration smoke file.
- Domain coverage was moved into:
  - `packages/api-entry-node/src/__integration__/project-routes.integration.test.ts`
  - `packages/api-entry-node/src/__integration__/project-file-libraries.integration.test.ts`
  - `packages/api-entry-node/src/__integration__/project-lifecycle-governance.integration.test.ts`
  - `packages/api-entry-node/src/__integration__/project-members-governance.integration.test.ts`
  - `packages/api-entry-node/src/__integration__/endpoint-routes.integration.test.ts`
  - `packages/api-entry-node/src/__integration__/endpoint-capabilities.integration.test.ts`
  - `packages/api-entry-node/src/__integration__/endpoint-proxy-bridges.integration.test.ts`
  - `packages/api-entry-node/src/__integration__/chat-streams.integration.test.ts`
  - `packages/api-entry-node/src/__integration__/chat-sessions.integration.test.ts`
  - `packages/api-entry-node/src/__integration__/chat-attachments.integration.test.ts`
  - `packages/api-entry-node/src/__integration__/notebook-tasks.integration.test.ts`
  - `packages/api-entry-node/src/__integration__/notebook-task-artifacts.integration.test.ts`
  - `packages/api-entry-node/src/__integration__/notebook-task-events.integration.test.ts`
  - `packages/api-entry-node/src/__integration__/governance-admin.integration.test.ts`

Shared helpers were consolidated into:

- `packages/api-entry-node/src/__integration__/test-support.ts`
- `packages/api-entry-node/src/__integration__/chat-test-support.ts`

### Bucket-file cleanup

- `packages/application/src/index.ts` now only re-exports domain modules.
- `packages/adapters-private/src/index.ts` now only re-exports domain modules.
- `src/lib/api/types/index.ts` now only re-exports domain type modules.

### Audit usage split, phase 1

- Type definitions and pure utility helpers were extracted from
  `packages/api-entry-node/src/audit-usage-store.ts` into:
  - `packages/api-entry-node/src/audit-usage/types.ts`
  - `packages/api-entry-node/src/audit-usage/utils.ts`

## Intentional stop point

This refactor line intentionally stops here.

The following files are still sizeable, but were left for future focused tasks
instead of continuing this line indefinitely:

- `packages/api-entry-node/src/chat-stream-handler.ts`
- `packages/api-entry-node/src/audit-usage-store.ts`
- `packages/api-entry-node/src/task-route-handler.ts`

They are no longer blocked by the previous mega-entry and mega-test structure,
so future refactors can target them independently.

## Validation

This line was closed only after:

- `npx tsc --noEmit`
- targeted Vitest integration suites
- `npm run contracts:check-openapi`
- `npm run openapi:check-generated`

all passed.
