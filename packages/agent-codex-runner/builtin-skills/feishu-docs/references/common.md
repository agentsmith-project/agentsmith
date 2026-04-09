# Common Calling Notes

## Transport

Use:

```bash
python3 ~/.agents/skills/feishu-docs/scripts/feishu_mcp.py call-tool <tool-name> --params '<json object>'
```

Notebook tasks now expose the current user's managed Feishu connection through AgentSmith Context Store:

```text
scope=user
key=managed_credentials.feishu
```

The helper script reads that managed connection automatically through the notebook execution API.

## Credential Contract

- `tools-list` / `call-tool` need an access token for `X-Lark-MCP-UAT`.
- `refresh-token` refreshes the managed Feishu connection through AgentSmith.
- If required values are missing, reconnect or repair the managed Feishu connection in AgentSmith instead of editing workspace files.

## Return Format

The helper script prints the remote JSON-RPC response as-is.

Common patterns:

- `tools/list`: `result.tools` is already structured JSON
- `tools/call`: many Feishu tools return `result.content`, often a single item:
  - `result.content[0].type == "text"`
  - `result.content[0].text` is frequently another JSON string

When consuming `tools/call` results in code:

1. Parse the outer JSON response
2. Read `result.content`
3. If the first item is text and looks like JSON, parse that string too

## Tool Discovery

If a call contract is unclear, inspect the live schema first:

```bash
python3 ~/.agents/skills/feishu-docs/scripts/feishu_mcp.py tools-list
```

Read the tool-specific reference file before calling any complex mutation tool.
