# Sources Object Browser Contract (MinIO-like) (2026-02-10)

This document defines the **backend API contract** that the frontend Sources module relies on when implementing
a MinIO Console-like object browser and file manager.

Non-goals in this contract:

- AIReady / indexing / docdb / vectordb.
- Plugin processing (to be defined later in a separate contract).

All endpoints are scoped by `workspace_id` + `project_id` from the URL.

## 1. Concepts

### 1.1 Library

A **library** is the user's "bucket-like" workspace namespace for storing objects.

Backend mapping:

- A project uses an object-store bucket determined by deployment configuration.
- One library maps to a stable `object_prefix` within that bucket (S3-style key prefix).
- The `object_prefix` mapping must be stable and immutable for the lifetime of the library.

### 1.2 Folder

Folders are virtual and represented by object **prefixes**.

Frontend rules:

- A "folder row" is a prefix returned by list API.
- "Create folder" writes a folder marker object (`<prefix>/`) or an equivalent backend-native mechanism.

### 1.3 Object

An object is identified by `(library_id, key)` where `key` is an S3-style object key (may contain `/`).

## 2. API Endpoints

All responses use JSON unless explicitly noted.

### 2.1 Libraries

1. `GET /workspaces/{ws}/projects/{project}/source-libraries`

Response:
```json
{
  "items": [
    {
      "id": "lib_123",
      "workspace_id": "ws_default",
      "project_id": "proj_001",
      "name": "Shared Docs",
      "description": "Default shared library",
      "visibility": "shared",
      "provider": "s3",
      "bucket": "mbos-shared-bucket",
      "object_prefix": "ws_default/proj_001/lib_123/",
      "created_by_user_id": "user_001",
      "created_at": "2026-02-01T00:00:00Z",
      "updated_at": "2026-02-01T00:00:00Z"
    }
  ]
}
```

Notes:

- `object_prefix` is backend-managed and used to scope all object keys inside a shared bucket.
- `provider` and `bucket` are optional response fields for ops/debug visibility.

2. `POST /workspaces/{ws}/projects/{project}/source-libraries`

Request:
```json
{ "name": "My Library", "description": "optional", "visibility": "shared" }
```

Response: `201` with the created library object.

3. `PATCH /workspaces/{ws}/projects/{project}/source-libraries/{libraryId}`

Request:
```json
{ "name": "Renamed", "description": "optional" }
```

Response: `200` with updated library.

4. `DELETE /workspaces/{ws}/projects/{project}/source-libraries/{libraryId}`

Behavior:

- If the library is not empty, backend must fail-fast with `409 library_not_empty`.
- If it is empty, delete the library metadata and return `204`.

### 2.2 List Objects (browse)

`GET /workspaces/{ws}/projects/{project}/source-libraries/{libraryId}/objects`

Query:

- `prefix`: string, optional. Current folder prefix. Must be normalized:
  - empty string means root.
  - non-empty must end with `/` to represent a folder.
- `delimiter`: string, required. Must be exactly `/` (otherwise `400`).
- `page_size`: int, optional. default `200`, max `1000`.
- `continuation_token`: string, optional. Pagination token for next page (MVP uses a key-based token, opaque to UI).
- `search`: string, optional. Case-insensitive substring match on display `name`.
- `sort_by`: enum, optional. One of `name | size_bytes | last_modified`, default `name`.
- `sort_order`: enum, optional. One of `asc | desc`, default `asc`.

Response:
```json
{
  "prefix": "docs/",
  "items": [
    { "kind": "prefix", "prefix": "docs/specs/", "name": "specs" },
    {
      "kind": "object",
      "key": "docs/readme.md",
      "name": "readme.md",
      "size_bytes": 1234,
      "content_type": "text/markdown",
      "etag": "\"...\"",
      "last_modified": "2026-02-10T12:00:00Z"
    }
  ],
  "next_continuation_token": "opaque-token-or-null"
}
```

Rules:

- Items must be stable-sorted for a given response (`prefix` rows first, then objects; both sorted by `name`).
- `name` for objects is the final path segment (after last `/`).
- `prefix` rows must include a normalized trailing `/`.
- When `sort_by` is `size_bytes` or `last_modified`, sorting applies to object rows; prefix rows remain name-sorted.

Frontend consumption guidance:

- The object list is rendered with virtualization and incremental loading.
- UI requests additional pages with `continuation_token` when the user scrolls near list end.
- `next_continuation_token = null` means no more pages.

### 2.3 Create Folder

`POST /workspaces/{ws}/projects/{project}/source-libraries/{libraryId}/folders`

Request:
```json
{ "prefix": "docs/specs/" }
```

Behavior:

- If folder already exists, return `200` (idempotent).
- Otherwise create a folder marker and return `201`.

### 2.4 Upload Object

MVP upload (simple, backend-managed multipart):

`POST /workspaces/{ws}/projects/{project}/source-libraries/{libraryId}/objects/upload`

Request: `multipart/form-data`

- `file`: binary
- `prefix`: string, optional (target folder prefix, normalized with trailing `/` when non-empty)
- `overwrite`: boolean, optional (default `false`)

Response:
```json
{
  "key": "docs/readme.md",
  "size_bytes": 1234,
  "content_type": "text/markdown",
  "etag": "\"...\"",
  "last_modified": "2026-02-10T12:00:00Z"
}
```

### 2.5 Download Object

`GET /workspaces/{ws}/projects/{project}/source-libraries/{libraryId}/objects/download?key=...`

Response:

- `200` streaming body with correct `Content-Type` and `Content-Disposition`.
- Missing/empty `key` is rejected with `400 invalid_key`.

### 2.6 Delete Objects

`POST /workspaces/{ws}/projects/{project}/source-libraries/{libraryId}/objects/delete`

Request:
```json
{ "keys": ["docs/readme.md", "docs/specs/"] }
```

Rules:

- Deleting a prefix means delete all objects under that prefix (backend must implement recursive delete).
- Operation must be best-effort but returns a complete result list.

Response:
```json
{
  "results": [
    { "key": "docs/readme.md", "status": "deleted" },
    { "key": "docs/specs/", "status": "deleted" }
  ]
}
```

### 2.7 Rename / Move

`POST /workspaces/{ws}/projects/{project}/source-libraries/{libraryId}/objects/move`

Request:
```json
{
  "from_key": "docs/readme.md",
  "to_key": "docs/README.md",
  "overwrite": false
}
```

Rules:

- Must be atomic from the user's perspective (backend may implement copy+delete).
- Moving a prefix performs a recursive move.
- If `overwrite=false` and destination exists, return `409 destination_exists`.

Client behavior guidance:

- On `409 destination_exists`, the UI should prompt the user to either:
  - cancel, or
  - retry with `overwrite=true`.

### 2.8 Object Details

`GET /workspaces/{ws}/projects/{project}/source-libraries/{libraryId}/objects/meta?key=...`

Response:
```json
{
  "key": "docs/readme.md",
  "size_bytes": 1234,
  "content_type": "text/markdown",
  "etag": "\"...\"",
  "last_modified": "2026-02-10T12:00:00Z",
  "user_metadata": { "x-amz-meta-foo": "bar" }
}
```

### 2.9 Create Temporary Share Link

`POST /workspaces/{ws}/projects/{project}/source-libraries/{libraryId}/objects/share-link`

Request:
```json
{
  "key": "docs/readme.md",
  "expires_in_seconds": 3600
}
```

Rules:

- `key` uses the same validation as download/meta (`400 invalid_key`).
- `expires_in_seconds` is optional, default `900`, valid range `60..604800`.
- Backend returns a time-limited pre-signed URL (S3-compatible semantics).

Response:
```json
{
  "key": "docs/readme.md",
  "url": "https://...signed-url...",
  "expires_at": "2026-02-11T12:00:00Z",
  "expires_in_seconds": 3600
}
```

## 3. Error Model

Errors must be JSON:
```json
{ "error_code": "library_not_empty", "message": "Library is not empty", "request_id": "optional" }
```

Required codes:

- `404 library_not_found`
- `404 object_not_found`
- `409 library_not_empty`
- `409 destination_exists`
- `400 invalid_prefix`
- `400 invalid_key`

## 4. Frontend Acceptance Tests (Baseline)

Playwright (`e2e/sources.spec.ts`) must cover:

- List libraries and select one.
- Browse folders via breadcrumb.
- Create folder.
- Upload file into current folder.
- Rename/move file.
- Delete file (and folder prefix).
- Download file (assert response headers and file bytes are non-empty).
- Selection summary visibility (selected count + clear selection).
- Selection model:
  - default single-select (clicking an object selects it for preview)
  - enter multi-select via `Ctrl/Cmd+click` or `Shift+click` range selection
  - keep multi-select active until explicit exit (`Esc`)
- Drag-and-drop upload into current folder.
- Batch download for multi-selected files (folder prefixes are not downloaded).
- `Up` action for current prefix navigation.
- Upload conflict handling (`destination_exists`) with two explicit choices:
  - overwrite existing object
  - keep both by auto-renaming (`name (n).ext`)
- Upload progress and cancel:
  - frontend shows per-file upload progress
  - user can cancel current upload
  - cancellation aborts the in-flight upload request without partial write in object list
- Batch operation result panel:
  - delete/download collect failed keys
  - frontend shows failed key list
  - retry action runs only on failed keys
- Library switch restore rule:
  - restore folder/query/selection state only when switching libraries within the same Sources page session
  - refresh or leaving Sources resets to default entry state (no cross-session restore)
  - only `library_id` remains URL-persisted; folder/query/sort are session-local state

Integration coverage (`e2e/integration-sources.spec.ts`) must validate the same flow against
real Node API + MinIO + Keycloak (no MSW).

## 5. Details Panel UX Contract (2026-02-11 Update)

The file details panel must provide two tabs:

- `Overview` (default): user-friendly info and content preview when possible.
- `Technical`: raw object key/meta for operations and debugging.

Behavior rules:

1. Empty/multi-selection states remain explicit:
- No selected row: show empty hint.
- Multi-selected rows: show only selection count.
- Selected folder prefix: show folder prefix path only.

2. For a selected object, metadata is fetched via:
- `GET .../objects/meta?key=...`

3. Preview uses the existing download endpoint (MVP does not add a dedicated preview API):
- `GET .../objects/download?key=...`
- Frontend decides preview mode by `content_type` plus filename extension:
  - Image preview: common image MIME/ext (`png`, `jpg`, `jpeg`, `webp`, `gif`, `svg`, etc.)
  - PDF preview: `application/pdf` or `.pdf`
  - Text preview: `text/*` and common text-like types (`json`, `md`, `csv`, `xml`, `yaml`, etc.)
  - Others: unsupported-preview placeholder

4. Technical tab includes:
- key, type, size, modified time, etag
- user metadata JSON (empty object when absent)
- copy-key action

5. No migration-time fallback flags are introduced for this behavior.

6. Overview tab action set:
- download object
- copy object path (key)
- generate temporary share link

7. Preview section supports expanded modal preview for image/pdf/text.
