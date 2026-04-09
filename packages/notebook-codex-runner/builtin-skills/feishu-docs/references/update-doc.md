# update-doc

Use for modifying an existing document. This is the most sensitive mutation tool.

## Input Schema

Top-level properties:

- `mode: string` required
- `doc_id: string`
- `markdown: string`
- `new_title: string`
- `selection_by_title: string`
- `selection_with_ellipsis: string`
- `task_id: string`

Allowed `mode` values:

- `overwrite`
- `append`
- `replace_range`
- `replace_all`
- `insert_before`
- `insert_after`
- `delete_range`

## Parameter Rules

- `task_id` means async status query
- `selection_by_title` and `selection_with_ellipsis` are alternatives
- `replace_range` and insert modes expect a unique match
- `replace_all` allows multiple matches

## Selection Rules

`selection_with_ellipsis`:

- range match: `开头内容...结尾内容`
- exact match: `完整内容`
- literal `...` must be escaped as `\\.\\.\\.`

`selection_by_title`:

- format like `## 章节标题`
- selects the whole section until the next same-level or higher heading

## Best Practices

- Prefer local edits over `overwrite`
- Fetch the document first if the target location is ambiguous
- Keep replacement spans as small as possible
- Avoid replacing regions that contain media, whiteboards, sheets, or other non-rebuildable blocks
- For multiple changes, prefer multiple small updates over one full rewrite
- Be careful with insert modes: larger locator spans move the insertion boundary

## Typical Usage

Append:

```bash
python3 ~/.agents/skills/feishu-docs/scripts/feishu_mcp.py call-tool update-doc --params '{"doc_id":"docx123","mode":"append","markdown":"## 新章节\n\n追加内容"}'
```

Replace by title:

```bash
python3 ~/.agents/skills/feishu-docs/scripts/feishu_mcp.py call-tool update-doc --params '{"doc_id":"docx123","mode":"replace_range","selection_by_title":"## 功能说明","markdown":"## 功能说明\n\n更新后的内容"}'
```

Insert after an exact or range match:

```bash
python3 ~/.agents/skills/feishu-docs/scripts/feishu_mcp.py call-tool update-doc --params '{"doc_id":"docx123","mode":"insert_after","selection_with_ellipsis":"```python...```","markdown":"**输出示例**"}'
```

## When To Re-check Live Schema

If the user asks for complex formatting preservation, warning interpretation, or whiteboard repair, inspect `tools-list` first because the live description contains more operational guidance than this summary.
