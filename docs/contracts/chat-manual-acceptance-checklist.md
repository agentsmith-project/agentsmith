# Chat Manual Acceptance Checklist

This checklist is the release gate for chat UX/runtime changes.

## 1. Access and Session

- Login and navigate to `/workspaces/{ws}/projects/{project}/chat`.
- Confirm thread list, main pane, and composer render.
- Refresh page and confirm user stays in authenticated chat route.
- Re-open an existing thread and confirm message history is visible.

## 2. Streaming and Stop

- Send a prompt and confirm assistant output streams incrementally.
- Click `Stop` during generation:
- Confirm partial assistant output remains visible after stop.
- Refresh page and confirm partial output still exists.
- Start a second generation after stop and confirm it proceeds normally.

## 3. Thread Isolation and Switching

- Start streaming in thread A.
- Switch to thread B while thread A is still running.
- Confirm thread A shows running indicator in thread list.
- Confirm thread B does not receive leaked assistant output from thread A.
- Switch back to thread A and confirm streaming content is correct.

## 4. Branch/Edit Behavior

- Edit a historical user message and trigger regenerate.
- Confirm new assistant response appears in the same branch context immediately.
- Confirm no duplicate temporary bubble remains after generation completes.
- Switch variants and confirm chain rendering is stable.

## 5. Thread List UX

- Confirm compact row height remains stable when thread is generating.
- Confirm row shows title + compact meta (age/message count) + status icons.
- Confirm active row keeps actions trigger visible.
- Confirm create, rename, star/pin, and delete actions all work.

## 6. Layout Modes

- Standard viewport (<1920): confirm no layout toggle is shown.
- Ultrawide viewport (>=1920): confirm layout toggle appears in chat header.
- Toggle to ultrawide:
- Confirm thread pane width expands and message area uses wider max width.
- Refresh page and confirm layout mode preference persists.
- Toggle back to standard and confirm widths revert.

## 7. Visual Baseline

- Run chat visual baseline test:
- `npm run test:e2e -- --project=visual e2e/visual.spec.ts --grep "chat"`
- Review screenshot diff and confirm only intentional visual changes are present.

## 8. Required Automated Checks

- `npm test -- chat`
- `npm run test:e2e -- e2e/chat.spec.ts --project=chromium --workers=1`
- `npm run test:e2e -- --project=visual e2e/visual.spec.ts --grep "chat"`
- `npx tsc --noEmit`
- `npm run lint`
