---
name: jira-ops
description: Operate Jira with a bearer token for common issue workflows such as searching issues, reading issue details, adding comments, editing fields, and transitioning status. Use when the user wants to work with a Jira site over HTTP API, especially when the current notebook task or workspace stores Jira credentials under MBOS_TASK_CREDENTIAL_DIR/jira or .codex/credential/jira and requests must clear proxy environment variables before access.
---

# Jira Ops

## Overview

Use a local helper script to perform common Jira REST operations with Bearer token auth. Default to inspecting Jira credentials from `MBOS_TASK_CREDENTIAL_DIR/jira` when present, otherwise from the current workspace under `.codex/credential/jira`, and clear proxy environment variables before every request.

## Quick Start

Validate auth:

```bash
python /etc/codex/skills/jira-ops/scripts/jira_ops.py \
  myself
```

## Workflow

1. Read [common.md](/etc/codex/skills/jira-ops/references/common.md) first.
2. Inspect `MBOS_TASK_CREDENTIAL_DIR/jira/` or `.codex/credential/jira/` in the current workspace. Do not assume fixed file names or formats; read the files and use their self-describing contents to identify the Jira token and, if present, the base URL.
3. If the issue key is unknown, use [jql.md](/etc/codex/skills/jira-ops/references/jql.md) and search before mutating.
4. If the user wants a common action, follow [workflows.md](/etc/codex/skills/jira-ops/references/workflows.md).
5. Before field edits, inspect `editmeta` if field names or allowed values are unclear.
6. Before transitions, inspect transitions with expanded field metadata.
7. Before mutating, prefer reading the issue or narrowing the search so the target is unambiguous.

## Supported Actions

- authenticate with `myself`
- search issues with JQL
- read issue details
- inspect editable field metadata
- add comments
- list transitions
- transition issues
- edit basic fields via JSON

## Safety Rules

- Always clear proxy environment variables before Jira access
- Prefer inspecting task/workspace credentials in `MBOS_TASK_CREDENTIAL_DIR/jira` or `.codex/credential/jira` over hard-coded tokens in commands
- Search first if the issue key is uncertain
- Read transitions with `--expand-fields` before transitioning an issue
- Read `editmeta` before editing unfamiliar fields or custom fields
- Use `search --use-post` for long or complex JQL
- For field edits, send only the fields the user asked to change
- Prefer script-based calls over ad hoc curl unless debugging transport details

## Resources

- `scripts/jira_ops.py`: helper for common Jira REST calls
- `references/common.md`: auth, proxy, TLS rules
- `references/jql.md`: common JQL patterns
- `references/workflows.md`: common action recipes
