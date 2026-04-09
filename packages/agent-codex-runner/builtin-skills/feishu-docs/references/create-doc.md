# create-doc

Use for creating a new Feishu document from Markdown or polling an async creation task.

## Input Schema

Top-level properties:

- `title: string`
- `markdown: string`
- `wiki_node: string`
- `wiki_space: string`
- `folder_token: string`
- `task_id: string`

## Parameter Rules

- `wiki_node`, `wiki_space`, and `folder_token` are mutually exclusive
- Effective location priority is:
  `wiki_node > wiki_space > folder_token > personal root`
- If `task_id` is provided, treat the call as async status lookup instead of new creation

## Hard Rules

- Do not repeat `title` as the first H1 in the body
- Do not handwrite a table of contents
- Do not write media via token attributes; use URL-based forms only
- Do not write raw `<whiteboard>` tags; use `mermaid` or `plantuml` code blocks
- Do not write raw `@username`; resolve the user and use `<mention-user id="ou_xxx">`
- For long content, prefer creating the shell doc first and then appending with `update-doc`

## Practical Syntax Guidance

Default style when the user has no explicit formatting preference:

- use `<grid>` for side-by-side comparison
- use `<callout>` for warnings, notes, or highlights
- use fenced code blocks for code
- use `mermaid` first for diagrams
- use standard markdown checklists for todos

## Typical Usage

Create a doc:

```bash
python3 ~/.agents/skills/feishu-docs/scripts/feishu_mcp.py call-tool create-doc --params '{"title":"项目计划","wiki_node":"wikcnXXXX","markdown":"## 目标\n\n- 目标 1"}'
```

Poll async task:

```bash
python3 ~/.agents/skills/feishu-docs/scripts/feishu_mcp.py call-tool create-doc --params '{"task_id":"task_xxx"}'
```

## When To Re-check Live Schema

If the work depends on extended Feishu markdown syntax or embedded component rules, inspect `tools-list` first because this tool carries a long live description.
