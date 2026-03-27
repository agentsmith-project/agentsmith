# JuiceFS File Libraries Architecture

This document defines the target architecture for the AgentSmith Files rewrite.

## Summary

- Project-level file libraries are first-class resources.
- One file library maps to one JuiceFS filesystem.
- Web access uses a JuiceFS S3 Gateway managed by AgentSmith.
- Local access uses `juicefs mount`.
- PostgreSQL and MinIO are shared infrastructure instances.
- Each file library gets isolated backend resources:
  - dedicated PostgreSQL metadata database
  - dedicated PostgreSQL metadata user/password
  - dedicated MinIO bucket
  - dedicated MinIO backend user/policy

## Core Model

### File Library

A file library is the product object users create and manage inside a project.

Required fields:
- `id`
- `workspace_id`
- `project_id`
- `name`
- `description`
- `status`
- `filesystem_name`
- `created_by_user_id`
- `created_at`
- `updated_at`

### File Library Backend

Backend mapping managed only by AgentSmith:
- `filesystem_name`
- PostgreSQL metadata database connection
- MinIO backend bucket and credentials
- Gateway internal credentials
- provisioning state
- runtime health

### Access Surfaces

#### Web

AgentSmith backend starts and manages a loopback-only JuiceFS Gateway per file library.

Frontend never connects to the gateway directly. All access goes through AgentSmith files APIs.

#### Local

Users exchange mount access using AgentSmith auth and run:

```bash
juicefs mount <metadata_url> <mountpoint>
```

The default exchange response exposes:
- `filesystem_name`
- `metadata_url`
- platform mount instructions

The default exchange response does **not** expose:
- backend MinIO credentials
- gateway internal credentials

## Provisioning Rules

For each file library, AgentSmith must:

1. create PostgreSQL metadata role + database
2. create MinIO bucket + backend user + policy
3. run `juicefs format`
4. persist backend mapping
5. mark the library `ready`

If any step fails, AgentSmith must roll back already-created resources and mark the library `failed`.

## Runtime Rules

### Library Status

- `creating`
- `ready`
- `degraded`
- `failed`
- `deleting`

### Delete

- non-empty libraries must fail fast
- force-delete is out of scope for v1

### Gateway

- one gateway process per file library
- loopback-only listener
- internal credentials only
- on-demand start
- health checks and restart support

## Security Rules

- metadata credentials are per-library and must never be shared across libraries
- backend MinIO credentials are per-library and are not returned by default to normal users
- reveal/exchange actions must be audited
- AgentSmith admin provisioning credentials stay server-side only

## Release Validation

Before release, the file library line must pass:

```bash
npx tsc --noEmit
npm run contracts:check-openapi
npm run openapi:check-generated
npm run test:files:backend-real:smoke
npm run test:files:backend-real:sync
```

Mock lane coverage must also include:
- Files page CRUD and browser flows
- mount access dialog
- create/delete dialogs
- non-empty delete denial

Real-lane checks must prove:
- provisioning succeeds with real PostgreSQL + MinIO + JuiceFS
- Web file operations succeed through the managed gateway
- local `juicefs mount` sees Web mutations
- Web/API sees local mount mutations
