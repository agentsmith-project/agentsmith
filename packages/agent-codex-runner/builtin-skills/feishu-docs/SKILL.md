---
name: feishu-docs
description: Use for Feishu/Lark/飞书 document and wiki tasks when Codex should search, read, create, update, or comment on Feishu docs without registering a Codex MCP server. Trigger on requests about Feishu docs, Lark docs, knowledge base/wiki pages, comments, document search, or when the current workspace stores credentials under MBOS_TASK_CREDENTIAL_DIR or .codex/credential.
---

# Feishu Docs

## Overview

Call Feishu remote MCP directly over HTTP through a local helper script. Read credentials from `MBOS_TASK_CREDENTIAL_DIR` when present, otherwise from the current workspace under `.codex/credential` (prefer `feishu/` subdirectory if present), instead of loading Feishu as a Codex MCP server.

## Quick Start

Use the helper script in this skill:

```bash
python ./.codex/skills/feishu-docs/scripts/feishu_mcp.py tools-list
python ./.codex/skills/feishu-docs/scripts/feishu_mcp.py call-tool search-doc --params '{"query":"roadmap"}'
```

The helper script now defaults to the full Feishu tool whitelist. For tighter control on risky edits, still prefer passing a minimal `--allowed-tools` set explicitly.

## Workflow

1. Confirm `MBOS_TASK_CREDENTIAL_DIR` or the current workspace contains credential files, then inspect them directly. Do not assume fixed file names or fixed formats; use the file content to identify access token, refresh token, app id, and app secret.
2. If the request is vague about the target document, start with `search-doc`.
3. If the user provides a doc URL or doc id, use `fetch-doc`.
4. For edits, call only the specific mutation tool needed, for example `update-doc` or `add-comments`.
5. If the call fails with auth-related errors, run `python ./.codex/skills/feishu-docs/scripts/feishu_mcp.py refresh-token` from the workspace and retry once.

## Commands

List tools:

```bash
python ./.codex/skills/feishu-docs/scripts/feishu_mcp.py tools-list
```

Search docs:

```bash
python ./.codex/skills/feishu-docs/scripts/feishu_mcp.py call-tool search-doc --params '{"query":"quarterly planning"}'
```

Fetch a doc:

```bash
python ./.codex/skills/feishu-docs/scripts/feishu_mcp.py call-tool fetch-doc --params '{"doc_id":"https://example.feishu.cn/docx/..."}'
```

Update a doc with an explicit narrow whitelist:

```bash
python ./.codex/skills/feishu-docs/scripts/feishu_mcp.py call-tool update-doc --allowed-tools 'fetch-doc,update-doc' --params '{"doc_id":"docx123","requests":[]}'
```

Refresh the current workspace token:

```bash
python ./.codex/skills/feishu-docs/scripts/feishu_mcp.py refresh-token
```

## Tool Selection

Read [tooling.md](/home/percy/.codex/skills/feishu-docs/references/tooling.md) first to choose the right reference file.

Reference loading rules:

- Always read [common.md](/home/percy/.codex/skills/feishu-docs/references/common.md) before writing code that consumes tool output
- Read [search-doc.md](/home/percy/.codex/skills/feishu-docs/references/search-doc.md) for keyword search, owner filters, time filters, or pagination
- Read [fetch-doc.md](/home/percy/.codex/skills/feishu-docs/references/fetch-doc.md) before reading document bodies
- Read [create-doc.md](/home/percy/.codex/skills/feishu-docs/references/create-doc.md) before creating documents
- Read [update-doc.md](/home/percy/.codex/skills/feishu-docs/references/update-doc.md) before any document body mutation
- Read [add-comments.md](/home/percy/.codex/skills/feishu-docs/references/add-comments.md) before adding comments
- Read [simple-tools.md](/home/percy/.codex/skills/feishu-docs/references/simple-tools.md) for the lower-complexity tools

Practical defaults:

- Prefer `search-doc` before `list-docs` for user-driven lookup
- Prefer `fetch-doc` for reading a known document
- Use `search-user` before `add-comments` when the request requires `@` mentions
- Re-run `tools-list` if a call contract seems stale or ambiguous

## Failure Recovery

- If token or auth errors appear, run `python ./.codex/skills/feishu-docs/scripts/feishu_mcp.py refresh-token`
- If refresh fails, inspect and update the credential files under `MBOS_TASK_CREDENTIAL_DIR` or `.codex/credential`
- Do not re-register Feishu as a Codex MCP server for this skill; use the helper script directly

## Resources

- `scripts/feishu_mcp.py`: Direct Feishu remote MCP caller over HTTP
- `references/tooling.md`: Current tool names and whitelist guidance
