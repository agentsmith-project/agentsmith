# Chat Frontend Module Map (2026-02-10)

This document defines responsibility boundaries for the chat page implementation under:
`src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/chat`.

## 1. Composition Boundary

- `page.tsx`
- Owns route param validation, permission gates, data/mutation hook wiring, and cross-hook orchestration only.
- Must not grow back into a UI-heavy monolith.

## 2. State and Runtime Hooks (`src/lib/chat`)

- `runtime-store.ts`
- Global (non-persistent) runtime store for chat streaming state.
- Holds per-session `streamId` and streaming assistant state so refresh/resume, branch switching, and stop controls do not depend on component-local memory.

- `use-chat-data.ts`
- Query orchestration for sessions, messages, attachments, and endpoint options.

- `use-chat-mutations.ts`
- Session/message/attachment mutation orchestration and cache invalidation.

- `use-chat-streaming.ts`
- SSE runtime, stream/session stop control, stream-id recovery after refresh, and stream state machine.
- Uses `runtime-store.ts` as the single source of truth for per-session runtime state.

- `use-chat-thread-actions.ts`
- Thread-level actions (select/create/rename/pin/star/delete request, endpoint switch).

- `use-chat-message-actions.ts`
- Message edit/regenerate branch actions.

- `use-chat-delete-dialog.ts`
- Delete-thread dialog state + confirm action.

- `use-chat-composer-actions.ts`
- Composer send and attachment-pick orchestration.

- `use-chat-variants.ts`
- Variant selection and auto-variant activation handling.

- `chat-view-model.ts`
- Derived UI state (`activeStreamStatus`, `mergedStreamingSessionIds`, `disabled`) from runtime store + queries + local UI state.

- `use-chat-layout-mode.ts`
- Viewport-aware layout mode orchestration (`standard|ultrawide`) with localStorage preference persistence.

## 3. UI Components (`src/components/chat`)

- `ThreadsPane.tsx`
- Thread list and thread actions UI.
- Supports `layoutMode` (`standard|ultrawide`) for compact/default and wide-display widths.

- `ChatMainPane.tsx`
- Main pane composition (`ChatHeader`, `MessageList`, `Composer`) and empty/loading states.
- Owns layout mode propagation to `ChatHeader` / `MessageList` / `Composer`.

- `ChatDeleteDialog.tsx`
- Delete confirmation dialog rendering.

- `ChatHeader.tsx`
- Session title/model control.

- `page.tsx`
- Owns the chat page header actions (including ultrawide layout toggle `chat__layout-toggle`).

- `MessageList.tsx` / `Composer.tsx`
- Respect `layoutMode` to cap content width:
- `standard`: keep dense, module-consistent readable width.
- `ultrawide`: expand chat content area without remounting shell/sidebar/topbar.

## 4. Guardrails

- Keep business logic in hooks; keep components primarily presentational.
- Default layout must remain aligned with other module pages (readability first); ultrawide is opt-in only.
- No migration toggles or temporary fallback flags for layout behavior.
- Layout toggle only affects chat content area; must not trigger shell/topbar/sidebar flicker or full-page remount.
- For new chat behavior:
1. Update or add a hook in `src/lib/chat`.
2. Keep `page.tsx` limited to wiring and cross-hook coordination.
3. Add/adjust tests:
- Hook/view-model unit tests in `src/lib/chat/__tests__`.
- Component tests in `src/components/chat/__tests__`.
- Integration behavior in `e2e/integration-chat.spec.ts` when runtime behavior changes.

## 5. Closeout Status

- Status: `completed` (Phase: chat structure split + stream recoverability baseline)
- Baseline commits include:
  - `6eb388f` (`ChatMainPane` + `ChatDeleteDialog` extraction)
  - `f4e5a62` (refresh recovery + dual stop-path integration coverage)
  - `655797d` (temporary backlog merged into canonical contracts)
- Verified baseline:
  - `npm test -- chat`
  - `npm run test:e2e -- e2e/chat.spec.ts --project=chromium --workers=1`
  - `npm run test:e2e -- --project=visual e2e/visual.spec.ts --grep "chat"`
  - `npx tsc --noEmit`
  - `npm run lint`

## 6. Next-Phase Boundary

- Chat refactor is considered stable at current module boundaries.
- Next work should focus on new capability delivery (not page-size driven split), and any new behavior must follow this map.
