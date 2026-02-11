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
- If it is empty, delete the bucket/namespace and return `204`.

### 2.2 List Objects (browse)

`GET /workspaces/{ws}/projects/{project}/source-libraries/{libraryId}/objects`

Query:

- `prefix`: string, optional. Current folder prefix. Must be normalized:
  - empty string means root.
  - non-empty must end with `/` to represent a folder.
- `delimiter`: string, required. Always `/`.
- `page_size`: int, optional. default `200`, max `1000`.
- `continuation_token`: string, optional. Opaque pagination token.

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
