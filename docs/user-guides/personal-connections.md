# Personal Connections

This guide reflects the current GA-scoped behavior:
- `Personal connections` stores user-owned custom secret bundles.
- These credentials are user-scoped and are not project endpoint credentials.
- This surface is not a provider registry and not a generic OAuth system.

## Scope

Use `Personal connections` only for simple external secrets that Agent tasks or downstream tools may use on your behalf.

The supported connection kind for this guide is `Custom`.

## Custom Secret Bundles

Create a custom connection when you need a small named bundle of fields. Mark sensitive fields as secret so saved values are not displayed in plaintext after creation.

Recommended manual verification:
1. Open `User -> Personal connections`.
2. Create a `Custom` connection.
3. Add one non-secret field and one secret field.
4. Save.
5. Re-open the connection and confirm the secret value is no longer displayed in plaintext.

## Notes

- Keep field names descriptive and provider-neutral.
- Do not store project endpoint API keys here; use Project secrets and Endpoint configuration for model access.
- Do not use custom secret bundles to model OAuth authorization flows.
