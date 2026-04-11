# Personal Connections & Workspace Feishu

This guide reflects the current baseline:

- `Personal connections` is the user-owned credential center for Jira, GitHub, Gitee, and custom secret bundles.
- `Feishu` is no longer configured or connected from that page.
- `Feishu` is now a **workspace-level integration** that users connect from the current workspace after a workspace administrator enables it.

## Scope

Use `Personal connections` for user-owned external credentials that agents or downstream tools may use on your behalf.

Current provider types in `Personal connections`:

- `Jira` via API token bundle
- `GitHub` via token bundle or SSH keypair
- `Gitee` via SSH keypair
- `Custom` via free-form secret bundle

These credentials are user-scoped. They are not project endpoint credentials and they do not enable workspace Feishu by themselves.

## Security Model

- Secret fields are encrypted at rest on the backend.
- Secret values are masked in UI responses.
- When editing an existing connection, leaving a secret field empty keeps the existing stored secret unchanged.

Environment variables for backend encryption:

```bash
USER_EXTERNAL_CONNECTIONS_SECRET_KEY=<strong-random-secret>
```

If not set, the backend falls back to `AGENTSMITH_SECRET_KEY`, then to a development-only default.

## Workspace Feishu Model

Feishu is split into two layers:

1. **Workspace admin setup**
   - A workspace administrator opens `工作区设置 -> 飞书接入`
   - They configure:
     - `App ID`
     - `App Secret`
     - `Redirect URI`
   - They must complete one Feishu login verification themselves
   - They explicitly enable Feishu for the workspace

2. **User personal connection**
   - A user opens the current workspace `Connections` page
   - They connect their own Feishu account
   - Their token stays user-scoped, but it is bound to the current `workspace_id`

Once Feishu is enabled, it becomes available across all projects in the current workspace.

## Workspace Feishu Callback

The current product truth is a **single locale-neutral Feishu callback** per workspace, for example:

```bash
http://localhost:3001/workspaces/<workspace-id>/feishu/callback
```

The same technical callback is used for:

- workspace admin verification
- user personal Feishu connection

The system distinguishes the flow internally through `state.intent`.

## Recommended Manual Verification

### Workspace Feishu

1. Open the target workspace home page
2. Use the `工作区设置` entry
3. Open `Feishu integration`
4. Save the workspace Feishu app credentials
5. Complete the admin Feishu verification flow
6. Enable Feishu
7. Open the same workspace `Connections` page
8. Connect your own Feishu account
9. Confirm the workspace connections page shows Feishu as connected

### Jira

1. Open `User -> Personal connections`
2. Create a `Jira` connection
3. Fill:
   - display name
   - base URL
   - account email
   - API token
4. Save
5. Re-open the connection and confirm the token field is no longer displayed in plaintext

### GitHub SSH

1. Open `User -> Personal connections`
2. Create a `GitHub` connection
3. Select `SSH Keypair`
4. Fill:
   - display name
   - git host
   - public key
   - private key
5. Save
6. Re-open and confirm the private key field can be left empty during edits

## Notes

- Feishu is not part of the generic create dialog anymore.
- `Personal connections` remains the right entry for Jira, GitHub, Gitee, and custom secret bundles.
- `Custom` should only be used for simple secret bundles in MVP. It is not a custom OAuth provider system.
