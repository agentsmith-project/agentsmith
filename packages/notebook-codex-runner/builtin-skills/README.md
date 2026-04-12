# Builtin Skills Bundle

This directory is the repository-managed source for the builtin Codex skills that AgentSmith packages into the runner image.

Current builtin set:

- `mbos-context`
- `feishu-docs`
- `jira-ops`

Runtime dependency contract:

- each builtin skill keeps natural-language guidance in `SKILL.md`
- each builtin skill also ships `capabilities.json` for machine-readable dependency metadata
- shared deterministic helpers live under `.mbos-runtime/`

Runtime behavior:

- task-local install path visible to Codex: `$HOME/.agents/skills`
- runner checks builtin skill source availability from `MBOS_AGENT_BUILTIN_SKILLS_DIR` (optional) or the packaged repo fallback
- fail-fast when required builtin skills are missing (`MBOS_AGENT_BUILTIN_SKILLS_REQUIRED=1`)
- builtin skills are container-scoped admin skills; they are no longer copied into workspace `.codex/skills`
