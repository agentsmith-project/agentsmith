---
name: jira-ops
description: Operate Jira with a bearer token for common issue workflows such as searching issues, reading issue details, adding comments, editing fields, and transitioning status. Use when the user wants to work with a Jira site over HTTP API and the current runner session stores simple Jira credentials in AgentSmith Context Store.
---

# Jira Ops

## Overview

Use a local helper script to perform common Jira REST operations with Bearer token auth. The helper resolves the machine-readable `jira-auth` credential dependency from AgentSmith runtime context, and clears proxy environment variables before every request.

## Quick Start

Validate auth:

```bash
python ~/.agents/skills/jira-ops/scripts/jira_ops.py \
  myself
```

## Workflow

1. Read [common.md](references/common.md) first.
2. Resolve the `jira-auth` runtime credential dependency first. It checks `task` context before `member` context. If it is missing, fail fast and ask the user or agent to populate it through AgentSmith context tooling.
3. If the issue key is unknown, use [jql.md](references/jql.md) and search before mutating.
4. If the user wants a common action, follow [workflows.md](references/workflows.md).
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
- Prefer the shared `jira-auth` runtime credential dependency over hard-coded tokens in commands
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
