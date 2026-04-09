# Common Rules

## Authentication

Use Bearer token auth. Prefer reading simple Jira credentials from AgentSmith Context Store:

```text
scope=task or user
key=credentials.jira_base_url
key=credentials.jira_token
```

Rules:

- read `credentials.jira_base_url` and `credentials.jira_token` through `mbos-context`
- if the base URL is not present in context, pass `--base-url` explicitly
- if the token is not present in context, set it first through `mbos-context`

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

- inspect `credentials.jira_base_url` and `credentials.jira_token` through `mbos-context` before assuming auth inputs
- If the issue key is unknown, search first
- If editing fields, inspect `editmeta` first
- If transitioning, inspect transitions with field expansion first
- If JQL becomes long or complex, force POST search
