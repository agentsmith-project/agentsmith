# Cross-IDP Identity Linking Plan (Deferred)

Last updated: 2026-03-03  
Status: `deferred` (recorded, not scheduled)

## Background

The product needs to identify the same enterprise person across multiple IDPs (for example Keycloak, Feishu, WeCom, Google) when login emails are the same.

## Decision

Do not use `email` as the internal immutable primary key.  
Use:

1. Stable internal `user_id` as system primary key.
2. Identity binding model for cross-IDP mapping.
3. Verified email as matching signal and human-readable review key.

## Target Model

1. `users`
- `id` (immutable primary key)
- `primary_email`
- profile fields

2. `identity_bindings`
- `user_id`
- `provider`
- `issuer`
- `subject`
- `email_at_bind`
- `verified_at`
- `linked_by`

3. Audit records for:
- identity auto-link
- identity manual-link
- conflict / reject decisions

## Matching Policy

Auto-link only when all conditions are true:

1. `email` exists and `email_verified=true`
2. Same tenant/org scope
3. Exactly one existing user matches
4. No conflict on existing binding

Otherwise require manual link / admin review.

## Security Rules

1. Never auto-link with unverified email.
2. One `(provider, issuer, subject)` maps to exactly one `user_id`.
3. Email conflict defaults to deny + manual resolution.

## Scope (Future Work)

1. Auth callback flow refactor to binding-first lookup.
2. Legacy account migration from current Keycloak-only mapping.
3. Admin/operator UI for manual link and conflict handling.
4. Contract/gate/test updates for auth and member-governance paths.

## Out of Scope (Current Sprint)

1. No schema or runtime changes now.
2. No login flow changes now.
3. No migration execution now.

