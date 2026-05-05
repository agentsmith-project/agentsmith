# Chat Frontend Contract

Scope: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/chat`

## 1. Module Boundaries
- `page.tsx`: route param validation, permission gate, hook wiring, cross-hook coordination.
- `src/lib/chat`: business logic and state derivation (`model-config-store`, data/mutation hooks, streaming orchestration, composer actions, variants, view model).
- `src/components/chat`: presentational composition and interaction rendering (`ThreadsPane`, `ChatHeader`, `MessageList`, `Composer`, dialogs).

## 2. Interaction Invariants
- Active session is required for sending; no active thread must show explicit CTA (`New Chat`) and disabled composer.
- Composer state machine is canonicalized in `src/lib/chat/composer-state.ts`:
  - `no_thread`
  - `need_endpoint`
  - `editing`
  - `streaming`
  - `pending`
  - `ready`
- Send binding is mandatory:
  - endpoint binding (`endpoint_id` + `model`)
- Header model presentation contract:
  - Endpoint session: primary label = endpoint name, secondary label = routed model id
- Thread pane contract:
  - Show streaming indicator per thread
  - Show aggregate generating count badge
  - Show no-active-thread hint when sessions exist but none selected

## 3. Attachment and Capability Contract
- Attachment send requires multimodal capability from the active execution binding.
- On non-multimodal endpoint/model capability:
  - Hide attachment actions in composer
  - Keep text send available
  - Frontend must pre-block attachment input attempts with explicit message
- Image attachments must be transformed into `data:image/*;base64,...` payloads before upstream proxy send.
- Backend must fail fast with `422 VALIDATION_ERROR` (`chat_attachment_image_data_url_unavailable`) when image attachment bytes cannot be resolved to a data URL.
- Supported attachment entry points:
  - local file picker
  - file-library picker
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
- Integration/execution behavior: `e2e/integration-chat.spec.ts`
- The removed `external_agent_id` field is negative-contract evidence only; payloads containing it are rejected by the backend with `400 unsupported_field`.
- Any change to invariants in sections 2-4 must update tests in all three layers.

## 6. Stream Error Mapping Contract
- Stream errors must show user-visible toast with deterministic copy and no forced redirect/navigation side effects.
- Chat stream errors are endpoint/model/provider errors. Chat does not dispatch Agent Runners or surface runner transport errors.
- Frontend mapping should use centralized resolver (`resolveErrorMessageByCode`) to avoid per-module ad-hoc `if/else` chains.
