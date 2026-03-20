# Feishu Tooling

Use the local helper script:

```bash
python3 ./.codex/skills/feishu-docs/scripts/feishu_mcp.py tools-list
python3 ./.codex/skills/feishu-docs/scripts/feishu_mcp.py call-tool search-doc --params '{"query":"roadmap"}'
```

Credential source:

- Search upward from the current working directory for `.codex/credential` (prefer `feishu/` if present)
- Inspect files in that directory directly and extract credentials from self-describing content
- Do not assume fixed file names or formats
- Override with `--credential-dir /abs/path/to/.codex/credential` when needed

Known tool names from the current Feishu remote MCP setup:

- `search-doc`
- `fetch-doc`
- `update-doc`
- `create-doc`
- `list-docs`
- `search-user`
- `get-user`
- `fetch-file`
- `get-comments`
- `add-comments`

## Which Reference To Read

- Read [common.md](/home/percy/.codex/skills/feishu-docs/references/common.md) for credential discovery, transport, and return-shape rules
- Read [search-doc.md](/home/percy/.codex/skills/feishu-docs/references/search-doc.md) before paginated search or owner/time filtering
- Read [fetch-doc.md](/home/percy/.codex/skills/feishu-docs/references/fetch-doc.md) before document reads
- Read [create-doc.md](/home/percy/.codex/skills/feishu-docs/references/create-doc.md) before document creation
- Read [update-doc.md](/home/percy/.codex/skills/feishu-docs/references/update-doc.md) before any body edit
- Read [add-comments.md](/home/percy/.codex/skills/feishu-docs/references/add-comments.md) before comment creation
- Read [simple-tools.md](/home/percy/.codex/skills/feishu-docs/references/simple-tools.md) for `search-user`, `get-user`, `fetch-file`, `get-comments`, and `list-docs`

## Notes

- Default whitelist includes all currently enabled Feishu tools:
  `search-user,get-user,fetch-file,search-doc,create-doc,fetch-doc,update-doc,list-docs,get-comments,add-comments`
- `call-tool` defaults the whitelist to the tool being called
- For multi-step work, widen `--allowed-tools` only to the minimum needed
- If auth expires, run `python3 ./.codex/skills/feishu-docs/scripts/feishu_mcp.py refresh-token`
