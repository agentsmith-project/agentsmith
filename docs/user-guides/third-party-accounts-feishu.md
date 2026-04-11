# Personal Connections & Workspace Integrations

This guide reflects the current baseline:
- `Personal connections` is the user-owned credential center for Jira, GitHub, Gitee, and custom secret bundles.
- `Feishu` is not configured from that page.
- `Feishu` is a workspace-level integration that users connect only after a workspace administrator enables it.

## Scope

Use `Personal connections` for user-owned external credentials that agents or downstream tools may use on your behalf.

Current provider types in `Personal connections`:
- `Jira`
- `GitHub`
- `Gitee`
- `Custom`

These credentials are user-scoped. They are not project endpoint credentials and they do not enable workspace Feishu by themselves.

## Workspace integrations model

Feishu is split into two layers:

1. Workspace admin setup
   - open `工作区设置 -> Feishu integration`
   - configure `App ID`, `App Secret`, `Redirect URI`
   - complete one Feishu verification flow
   - enable Feishu for the workspace

2. User personal connection
   - open the current workspace `Workspace integrations` surface
   - connect your own Feishu account
   - the token remains user-scoped, but is bound to the current `workspace_id`

Once Feishu is enabled, it becomes available across all projects in the current workspace.

## Callback model

The current product truth is a single locale-neutral Feishu callback per workspace, for example:

```bash
http://localhost:3001/workspaces/<workspace-id>/feishu/callback
```

The same technical callback is used for:
- workspace admin verification
- user Feishu connection

The system distinguishes the flow internally through `state.intent`.

## Recommended manual verification

### Workspace integrations / Feishu
1. Open the target workspace
2. Use `工作区设置`
3. Open `Feishu integration`
4. Save the workspace Feishu app credentials
5. Complete the admin verification flow
6. Enable Feishu
7. Open the same workspace `Workspace integrations` surface
8. Connect your own Feishu account
9. Confirm the workspace integrations page shows Feishu as connected

### Personal connections / Jira
1. Open `User -> Personal connections`
2. Create a `Jira` connection
3. Fill display name, base URL, account email, and API token
4. Save
5. Re-open and confirm the token is no longer displayed in plaintext

## Notes

- Feishu is not part of the generic personal-connections create dialog.
- `Personal connections` remains the right entry for Jira, GitHub, Gitee, and custom secret bundles.
- `Custom` is for simple secret bundles only. It is not a custom OAuth provider system.
