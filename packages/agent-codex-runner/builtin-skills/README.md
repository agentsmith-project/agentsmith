# Builtin Skills Bundle

This directory is the repository-managed source for the builtin Codex skills that AgentSmith packages into the runner image.

Current builtin set:

- `feishu-docs`
- `jira-ops`

Runtime behavior:

- image install path: `/etc/codex/skills`
- runner checks skill availability from `MBOS_AGENT_BUILTIN_SKILLS_DIR` (default `/etc/codex/skills`)
- fail-fast when required builtin skills are missing (`MBOS_AGENT_BUILTIN_SKILLS_REQUIRED=1`)
- builtin skills are container-scoped admin skills; they are no longer copied into workspace `.codex/skills`
