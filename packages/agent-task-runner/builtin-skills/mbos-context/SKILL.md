---
name: mbos-context
description: Use to read or write AgentSmith Context Store entries for member/task scope, to read project_member/project/workspace context, and to inspect read-only runtime projections. Trigger when the user asks to save preferences, notes, secrets, task memory, shared guidance, personal project bindings, or to inspect credentials without browsing local files.
---

# MBOS Context

## Overview

Use the local helper script to talk to the AgentSmith Context Store over the agent task execution API. This is the primary way to read or write member/task context, read project_member context, inspect simple credentials, inspect read-only runtime projections, and read shared project/workspace guidance.

## Quick Start

```bash
python3 ~/.agents/skills/mbos-context/scripts/context_cli.py list --scope member
python3 ~/.agents/skills/mbos-context/scripts/context_cli.py get --scope member --key prefs.editor
```

## Workflow

1. Prefer `mbos-context` over searching workspace files for preferences, notes, or credentials.
2. Use `scope=member` for current-workspace member memory, prefs, and simple credentials.
3. Use `scope=task` for task-local notes, scratch state, and temporary secrets owned by the current member.
4. Use `scope=project_member` to read current-project personal bindings, project-specific preferences, and member-private notes that only apply in this project. Agent execution tickets cannot write this scope.
5. Use `scope=project` or `scope=workspace` only for reads; those scopes are manually maintained in AgentSmith.
6. Keys under `managed_credentials.*` are read-only runtime projections when present.

## Commands

List visible entries:

```bash
python3 ~/.agents/skills/mbos-context/scripts/context_cli.py list --scope member
```

Read one entry:

```bash
python3 ~/.agents/skills/mbos-context/scripts/context_cli.py get --scope member --key credentials.github_token
```

Write one entry:

```bash
python3 ~/.agents/skills/mbos-context/scripts/context_cli.py put --scope task --key notes.current_task --content 'Remember to summarize the schema changes.'
```

Delete one entry:

```bash
python3 ~/.agents/skills/mbos-context/scripts/context_cli.py delete --scope task --key notes.current_task
```

## Key Conventions

- `prefs.*`: member preferences within the current workspace
- `notes.*`: free-form notes
- `memory.*`: longer-lived member or task memory
- `credentials.*`: simple writable credentials such as API keys or bearer tokens
- `managed_credentials.*`: read-only runtime projections
- `shared.*`: human-maintained shared context in project/workspace scope

## Safety Rules

- Do not copy secrets from Context Store into workspace files unless the user explicitly asks for that.
- Prefer `credentials.*` for simple tokens and API keys.
- Do not try to overwrite `managed_credentials.*`; those are read-only runtime projections.
- Agent execution tickets may write `member` and `task` scopes, but not `project_member`, `project`, or `workspace`.
- If an entry is JSON or YAML text, read and parse the content instead of assuming a fixed schema.
