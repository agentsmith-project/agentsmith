# Third-Party Accounts & Feishu OAuth

This guide covers the user-scoped `Third-Party Accounts` module and the current Feishu OAuth setup.

## Scope

Use `Third-Party Accounts` for user-owned external credentials that agents or downstream tools may use on your behalf.

Current provider types:

- `Feishu` via OAuth account binding
- `Jira` via API token bundle
- `GitHub` via token bundle or SSH keypair
- `Gitee` via SSH keypair
- `Custom` via free-form secret bundle

These connections are user-scoped. They are not project endpoint credentials.

## Security Model

- Secret fields are encrypted at rest on the backend.
- Secret values are masked in UI responses.
- When editing an existing connection, leaving a secret field empty keeps the existing stored secret unchanged.

Environment variables for backend encryption:

```bash
USER_EXTERNAL_CONNECTIONS_SECRET_KEY=<strong-random-secret>
```

If not set, the backend falls back to `AGENTSMITH_SECRET_KEY`, then to a development-only default.

## Feishu OAuth Configuration

Required backend environment variables:

```bash
FEISHU_APP_ID=<your-feishu-app-id>
FEISHU_APP_SECRET=<your-feishu-app-secret>
FEISHU_OAUTH_REDIRECT_URI=<callback-uri>
```

Optional overrides:

```bash
FEISHU_OAUTH_AUTHORIZE_URL=https://accounts.feishu.cn/open-apis/authen/v1/authorize
FEISHU_OAUTH_TOKEN_URL=https://open.feishu.cn/open-apis/authen/v2/oauth/token
FEISHU_OAUTH_SCOPES=offline_access
FEISHU_OAUTH_REFRESH_RUNNER_ENABLED=true
FEISHU_OAUTH_REFRESH_RUNNER_INTERVAL_MS=300000
```

## Feishu Callback Modes

The system currently supports two callback modes.

### 1. Product Mode: AgentSmith Handles the Callback

Recommended for normal usage.

Set Feishu redirect URI to an AgentSmith page, for example:

```bash
http://localhost:3001/zh-CN/user/third-party-accounts/feishu/callback
```

Or in production:

```bash
https://<your-domain>/<locale>/user/third-party-accounts/feishu/callback
```

Flow:

1. Open `User -> Third-Party Accounts`
2. Click `Connect Feishu`
3. Complete Feishu login
4. Feishu redirects back to AgentSmith
5. AgentSmith exchanges the code and stores the connection automatically

### 2. Local Test Mode: Manual Callback URL Paste

Use this when Feishu is configured to redirect to a local helper address instead of AgentSmith.

Current local test callback example:

```bash
http://127.0.0.1:18181/callback
```

Flow:

1. Click `Connect Feishu`
2. Complete Feishu login in the opened browser tab
3. Copy the full callback URL after redirect
4. Paste it into the Feishu bind dialog
5. AgentSmith parses `code` and `state`, exchanges the token, and stores the connection

## Manual Verification Checklist

### Jira

1. Open `User -> Third-Party Accounts`
2. Create a `Jira` connection
3. Fill:
   - display name
   - base URL
   - account email
   - API token
4. Save
5. Re-open the connection and confirm the token field is no longer displayed in plaintext

### GitHub SSH

1. Create a `GitHub` connection
2. Select `SSH Keypair`
3. Fill:
   - display name
   - git host
   - public key
   - private key
4. Save
5. Re-open and confirm the private key field can be left empty during edits

### Feishu

1. Confirm backend env vars are configured
2. Click `Connect Feishu`
3. Complete login
4. Confirm a `Feishu` OAuth account appears in the table
5. Click the refresh action and confirm token refresh succeeds

## Notes

- `Feishu` is bound through its dedicated OAuth flow, not through the generic create dialog.
- `Custom` should only be used for simple secret bundles in MVP. It is not a custom OAuth provider system.
