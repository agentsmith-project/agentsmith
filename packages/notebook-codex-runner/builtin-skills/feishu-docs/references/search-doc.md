# search-doc

Use for keyword search, recent-document retrieval, and filtered doc lookup.

## Input Schema

Top-level properties:

- `query: string`
  Empty is allowed and means recent/open-history style search.
- `filters: object`
- `page: object`

`filters` properties:

- `owners: string[]`
  Open IDs of document owners/authors.
- `sort_rule: "OPEN_TIME" | "EDIT_TIME" | "EDIT_TIME_ASC" | "CREATE_TIME"`
- `create_time: string`
  Format: `[YYYY-MM-DD, YYYY-MM-DD]`
- `create_time_relative: string`
  Format: `last_N_days`
- `open_time: string`
  Format: `[YYYY-MM-DD, YYYY-MM-DD]`
- `open_time_relative: string`
  Format: `last_N_days`

`page` properties:

- `offset: integer`
- `page_token: string`
- `size: integer`
  Range `1..20`, default `20`

## Hard Rules

- If searching for docs created by a specific person, get their `open_id` first with `get-user` or `search-user`
- Do not query time ranges larger than 3 months in a single request
- If the user asks for a bounded range like "2024" or "this year", cover the full range instead of stopping early
- Do not invent `owners` values

## Typical Usage

Search by keyword:

```bash
python3 ~/.agents/skills/feishu-docs/scripts/feishu_mcp.py call-tool search-doc --params '{"query":"csdata"}'
```

Search by owner and recent period:

```bash
python3 ~/.agents/skills/feishu-docs/scripts/feishu_mcp.py call-tool search-doc --params '{"query":"roadmap","filters":{"owners":["ou_xxx"],"sort_rule":"OPEN_TIME","open_time_relative":"last_30_days"}}'
```

## Return Notes

The outer response usually wraps a text item whose `text` field is another JSON object with:

- `code`
- `msg`
- `data.items`
- `data.has_more`
- `data.page_token`

For pagination, pass the returned `page_token` back in `page.page_token`.
