# Chat Frontend Contract

Scope: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/chat`

## 1. Module Boundaries
- `page.tsx`: route param validation, permission gate, hook wiring, cross-hook coordination.
- `src/lib/chat`: business logic and state derivation (`runtime-store`, data/mutation hooks, streaming orchestration, composer actions, variants, view model).
- `src/components/chat`: presentational composition and interaction rendering (`ThreadsPane`, `ChatHeader`, `MessageList`, `Composer`, dialogs).

## 2. Interaction Invariants
- Active session is required for sending; no active thread must show explicit CTA (`New Chat`) and disabled composer.
- Composer state machine is canonicalized in `src/lib/chat/composer-state.ts`:
  - `no_thread`
  - `need_endpoint`
  - `editing`
  - `streaming`
  - `pending`
  - `error_recoverable`
  - `ready`
- Endpoint binding is mandatory for send (`endpoint_id` and `model` non-empty).
- Header model presentation contract:
  - Primary label: endpoint name
  - Secondary label: routed model id
- Thread pane contract:
  - Show streaming indicator per thread
  - Show aggregate generating count badge
  - Show no-active-thread hint when sessions exist but none selected

## 3. Attachment and Capability Contract
- Attachment send requires endpoint capability `multimodal_completion`.
- On non-multimodal endpoint:
  - Hide attachment actions in composer
  - Keep text send available
  - Frontend must pre-block attachment input attempts with explicit message
- Supported attachment entry points:
  - local file picker
  - source-library picker
  - drag-and-drop into composer
  - paste files/images into composer textarea
- Attachments are message-scoped snapshots and are persisted with the user message before stream send.

## 4. Layout and UX Rules
- Default layout is `standard`; `ultrawide` is explicit opt-in.
- Layout toggle is topbar-owned (`topbar__layout-toggle`), project-global.
- Chat layout changes must not remount shell/topbar/sidebar.

## 5. Testing Contract
- Hook/view-model tests: `src/lib/chat/__tests__`
- Component tests: `src/components/chat/__tests__`
- Integration/runtime behavior: `e2e/integration-chat.spec.ts`
- Any change to invariants in sections 2-4 must update tests in all three layers.
