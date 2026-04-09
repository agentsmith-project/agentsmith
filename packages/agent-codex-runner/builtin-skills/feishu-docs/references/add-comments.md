# add-comments

Use for adding full-document comments, not body edits.

## Input Schema

- `doc_id: string` required
- `elements: object[]` required

Each element requires `type` and may also require:

- `text` when `type == "text"`
- `open_id` when `type == "mention"`
- `url` when `type == "link"`

Allowed element types:

- `text`
- `mention`
- `link`

## Hard Rules

- This tool supports only text, mentions, and hyperlinks
- Do not attempt images, markdown blocks, files, screenshots, attachments, or other rich content
- Do not invent `open_id`; resolve it with `search-user` first
- Do not fabricate URLs

## Typical Usage

Plain text comment:

```bash
python3 ~/.agents/skills/feishu-docs/scripts/feishu_mcp.py call-tool add-comments --params '{"doc_id":"docx123","elements":[{"type":"text","text":"请确认这里的结论"}]}'
```

Mention + link:

```bash
python3 ~/.agents/skills/feishu-docs/scripts/feishu_mcp.py call-tool add-comments --params '{"doc_id":"docx123","elements":[{"type":"text","text":"请查看 "},{"type":"mention","open_id":"ou_xxx"},{"type":"link","url":"https://example.com"}]}'
```
