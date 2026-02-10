# Chat Frontend Module Map (2026-02-10)

This document defines responsibility boundaries for the chat page implementation under:
`src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/chat`.

## 1. Composition Boundary

- `page.tsx`
- Owns route param validation, permission gates, data/mutation hook wiring, and cross-hook orchestration only.
- Must not grow back into a UI-heavy monolith.

## 2. State and Runtime Hooks (`src/lib/chat`)

- `use-chat-data.ts`
- Query orchestration for sessions, messages, attachments, and endpoint options.

- `use-chat-mutations.ts`
- Session/message/attachment mutation orchestration and cache invalidation.

- `use-chat-streaming.ts`
- SSE runtime, stream/session stop control, stream-id recovery after refresh, and stream state machine.

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
- Derived UI state (`activeStreamStatus`, `mergedStreamingSessionIds`, `disabled`) from runtime + local state.

## 3. UI Components (`src/components/chat`)

- `ThreadsPane.tsx`
- Thread list and thread actions UI.

- `ChatMainPane.tsx`
- Main pane composition (`ChatHeader`, `MessageList`, `Composer`) and empty/loading states.

- `ChatDeleteDialog.tsx`
- Delete confirmation dialog rendering.

## 4. Guardrails

- Keep business logic in hooks; keep components primarily presentational.
- For new chat behavior:
1. Update or add a hook in `src/lib/chat`.
2. Keep `page.tsx` limited to wiring and cross-hook coordination.
3. Add/adjust tests:
- Hook/view-model unit tests in `src/lib/chat/__tests__`.
- Component tests in `src/components/chat/__tests__`.
- Integration behavior in `e2e/integration-chat.spec.ts` when runtime behavior changes.
