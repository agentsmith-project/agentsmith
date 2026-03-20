# Common Calling Notes

## Transport

Use:

```bash
python ./.codex/skills/feishu-docs/scripts/feishu_mcp.py call-tool <tool-name> --params '<json object>'
```

Notebook tasks now expose the workspace credential root through:

```bash
MBOS_TASK_CREDENTIAL_DIR=./.codex/credential
```

The helper script prefers that directory automatically. If the environment variable is absent and the workspace does not contain `.codex/credential`, pass:

```bash
--credential-dir /abs/path/to/.codex/credential
```

## Credential Contract

- Inspect files under `MBOS_TASK_CREDENTIAL_DIR` or `.codex/credential` directly; do not assume fixed file names or formats.
- `tools-list` / `call-tool` need an access token for `X-Lark-MCP-UAT`.
- `refresh-token` needs three values discoverable from file content:
  - refresh token
  - app id (for example `FEISHU_APP_ID` / `client_id`)
  - app secret (for example `FEISHU_APP_SECRET` / `client_secret`)
- If values are missing, update the credential files with self-describing keys.

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
python ./.codex/skills/feishu-docs/scripts/feishu_mcp.py tools-list
```

Read the tool-specific reference file before calling any complex mutation tool.
