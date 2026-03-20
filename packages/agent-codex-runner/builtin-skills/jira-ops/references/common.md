# Common Rules

## Authentication

Use Bearer token auth. Prefer inspecting credentials from the current notebook workspace credential root when available:

```text
MBOS_TASK_CREDENTIAL_DIR/jira/
```

Otherwise inspect the shared workspace credential root:

```text
.codex/credential/jira/
```

Do not assume fixed file names or fixed formats.

Rules:

- inspect the files actually present in `MBOS_TASK_CREDENTIAL_DIR/jira/` or `.codex/credential/jira/`
- treat the contents as self-describing
- locate the Jira token from the file contents
- locate the Jira base URL from the file contents if present
- if the base URL is not present in credentials, pass `--base-url` explicitly

If needed, override discovery with:

```bash
python ./.codex/skills/jira-ops/scripts/jira_ops.py \
  --credential-dir /abs/path/to/.codex/credential/jira \
  myself
```

## Proxy Rule

Always clear proxy environment variables before Jira access.

This skill's script already clears:

- `http_proxy`
- `https_proxy`
- `HTTP_PROXY`
- `HTTPS_PROXY`
- `all_proxy`
- `ALL_PROXY`
- `no_proxy`
- `NO_PROXY`

If you do not use the script, replicate this behavior manually.

## API Version

Default to Jira REST API v2 paths unless the site proves otherwise.

For Jira 9.12.x, this skill assumes the common Server/Data Center v2 REST endpoints.

## TLS

The helper script accepts self-signed or private CA certificates by using an unverified SSL context.
Only use that against trusted internal Jira sites.

## Weak-Model Guidance

- inspect `MBOS_TASK_CREDENTIAL_DIR/jira/` or `.codex/credential/jira/` before assuming auth inputs
- If the issue key is unknown, search first
- If editing fields, inspect `editmeta` first
- If transitioning, inspect transitions with field expansion first
- If JQL becomes long or complex, force POST search
