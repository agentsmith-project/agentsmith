# Feishu Tooling

Use the local helper script:

```bash
python3 ~/.agents/skills/feishu-docs/scripts/feishu_mcp.py tools-list
python3 ~/.agents/skills/feishu-docs/scripts/feishu_mcp.py call-tool search-doc --params '{"query":"roadmap"}'
```

Credential source:

- Resolve the `feishu-managed-user` runtime dependency, which currently projects the current workspace member's `managed_credentials.feishu`
- Do not browse workspace files for Feishu credentials
- If the managed connection is missing or stale, reconnect or refresh it in AgentSmith

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

- Read [common.md](common.md) for credential discovery, transport, and return-shape rules
- Read [search-doc.md](search-doc.md) before paginated search or owner/time filtering
- Read [fetch-doc.md](fetch-doc.md) before document reads
- Read [create-doc.md](create-doc.md) before document creation
- Read [update-doc.md](update-doc.md) before any body edit
- Read [add-comments.md](add-comments.md) before comment creation
- Read [simple-tools.md](simple-tools.md) for `search-user`, `get-user`, `fetch-file`, `get-comments`, and `list-docs`

## Notes

- Default whitelist includes all currently enabled Feishu tools:
  `search-user,get-user,fetch-file,search-doc,create-doc,fetch-doc,update-doc,list-docs,get-comments,add-comments`
- `call-tool` defaults the whitelist to the tool being called
- For multi-step work, widen `--allowed-tools` only to the minimum needed
- If auth expires, run `python3 ~/.agents/skills/feishu-docs/scripts/feishu_mcp.py refresh-token`
