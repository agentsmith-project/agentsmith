# Builtin Skills Bundle

This directory is the repository-managed source of builtin skills auto-mounted by `@mbos/agent-codex-runner` for every task.

Current builtin set (MVP):

- `.system`
- `feishu-docs`
- `jira-ops`

Default runner behavior:

- source dir: `<repo>/packages/agent-codex-runner/builtin-skills`
- mounted into task workspace path: `./.codex/skills/`
- fail-fast when required builtin skills are missing (`MBOS_AGENT_BUILTIN_SKILLS_REQUIRED=1`)
