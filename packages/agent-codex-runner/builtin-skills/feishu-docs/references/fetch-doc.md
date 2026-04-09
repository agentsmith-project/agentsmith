# fetch-doc

Use for reading document content as Markdown.

## Input Schema

- `doc_id: string` required
  Accepts a document ID or document URL. Do not pass a title.
- `limit: integer` optional
  Maximum character count to return
- `offset: integer` optional
  Character offset for pagination

## Calling Guidance

- Prefer a full fetch unless the user explicitly asks to page through a large document
- If the user only gives a title, resolve it with `search-doc` first
- Use `offset` and `limit` only when the document is too large to fetch at once or the user wants a slice

## Typical Usage

```bash
python3 ~/.agents/skills/feishu-docs/scripts/feishu_mcp.py call-tool fetch-doc --params '{"doc_id":"https://gw8cavjn6kt.feishu.cn/wiki/xxxx"}'
```
