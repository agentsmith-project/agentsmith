# Archive

This directory holds historical design notes and phase documents that are no longer part of the current product or release truth.

Suggested subfolders:

- `handoff/`: point-in-time handoff notes
- `refactor-notes/`: completed engineering cleanup notes
- `env-specific/`: environment- or site-specific runbooks kept only as examples

Current release documentation must stay in the main `docs/` tree and describe only the active model:

- task-owned workspaces
- JuiceFS CSI
- workspace-scoped Feishu integration
- `gate-*`, `lane-*`, `manual-*`, and `release-*` entrypoints

Do not move archived concepts back into the main docs tree without an explicit product decision.
