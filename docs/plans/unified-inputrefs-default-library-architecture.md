# Unified Input References + Default File Library Architecture (Draft)

Status: active architecture direction (post-release refactor target)

## Summary

This document defines a cleaner long-term architecture for file inputs across Chat and Notebook:

- All user-provided files (uploads, library objects, future URL imports) enter the system via a **File Library object layer**
- Chat / Notebook / Agents consume inputs through a unified **Input Reference** model
- `source` becomes a derived/processed capability (AI Ready / indexing), not a parallel primary file entry path

This addresses current inconsistency:

- Chat can select library objects and effectively passes content directly to runtime
- Notebook currently attaches `sources` and uses a compatibility bridge for library objects

The goal is to converge to a single mental model and execution model.

## Product Principles

1. **Single source of truth for user files**
- User files live in file libraries (`source-libraries/.../objects`)

2. **References over copies**
- Chat/Notebook should attach references (`InputRef`) instead of creating duplicate platform records unless explicitly needed

3. **Runtime decides consumption strategy**
- UI selects input references
- Runtime chooses how to consume them (inline upload, tool fetch, local cache, preprocessing)

4. **Derived processing is optional and explicit**
- AI Ready / chunking / embeddings are derived states or derived records, not the primary file identity

## Target Data Model

### InputRef (unified)

```ts
type InputRef =
  | {
      kind: 'library_object';
      library_id: string;
      key: string;
      name: string;
      content_type?: string;
      size_bytes?: number;
    }
  | {
      kind: 'source';
      source_id: string;
      name?: string;
      ai_ready_status?: 'idle' | 'preparing' | 'ready' | 'failed' | 'cancelled';
    }
  | {
      kind: 'url';
      url: string;
      imported_object_ref?: { library_id: string; key: string };
    }
  | {
      kind: 'artifact';
      task_id: string;
      artifact_id: string;
      task_relative_path?: string;
    };
```

### Notebook Task / Chat Session attachment direction

Short-term compatibility:
- Keep `attached_source_ids` for existing Notebook APIs
- Add a new `attached_inputs` shape in parallel for future migration

Long-term:
- Replace `attached_source_ids` with `attached_inputs: InputRef[]`

## Default File Library (System-Managed)

### Decision

Introduce a **per-user, per-project default library** for transient uploads and imports.

Properties:
- System-managed
- Must exist (lazy-created if missing)
- Not deletable by user
- Visibility fixed (`shared` or product-defined default)

### Suggested usage paths

- `chat/<chat_id>/uploads/...`
- `notebook/<task_id>/uploads/...`
- `imports/url/<yyyy-mm>/...`
- `artifacts/<task_id>/...` (optional default save target)

This provides traceability, easier quota accounting, and predictable cleanup semantics.

## Runtime Consumption Model

### Rule

UI does not decide content transport strategy.

Examples:
- Chat runtime may resolve `library_object` by downloading and sending inline to provider (today-compatible)
- Notebook/Codex runtime may resolve `library_object` via skill/tool fetch into local working dir
- Future runtimes may pre-stage files into a sandbox mount

The UI only attaches `InputRef`.

## Migration Path (Phased)

### Phase 1 (completed)
- Notebook migrated from `attached_source_ids` to unified `attached_inputs` (`/tasks/:taskId/inputs`)
- Notebook supports direct `library_object` refs
- Runner manifest (`.mbos/task-inputs.json`) includes `kind`
- `notebook-inputs` skill helper supports fetching `library_object` refs

### Phase 2 (in progress)
- Chat local uploads and library picks share a unified object-first attachment path
- Chat local uploads now:
  - ensure a default personal library
  - upload object to `chat/<session_id>/uploads/`
  - create attachment from the library object
- Backend provides `GET /source-libraries/default-personal` (idempotent ensure route)

### Phase 3 (next)
- Replace front-end "default personal library" conventions with backend-enforced system-managed semantics (now implemented with `system_managed_kind=default_personal_uploads` + protected rename/delete semantics)
- Introduce shared backend/runtime input resolver interfaces for Chat/Notebook/Agents

### Phase 4 (Derived processing alignment)
- `source` records become explicitly derived from `library_object`
- AI Ready state and indexing become part of derived processing pipeline, not file identity

## Current Transitional Areas

- Chat still consumes inputs through the existing attachment runtime path (provider-oriented payloads), even though uploads/picks now converge on `library_object` provenance.
- Backend default personal library now carries an explicit system-managed marker (`system_managed_kind=default_personal_uploads`) and is protected on standard library routes.
- Remaining follow-up hardening (optional): data migration to eliminate any legacy name-based fallback checks.

### Progress update (2026-02)
- Notebook task inputs use `attached_inputs` and `/tasks/:taskId/inputs` (`source` + `library_object`)
- Notebook "Add URL" now stores URL notes as default personal library objects, then attaches them as `library_object` input refs (object-first)
- Chat local uploads and library selections are object-first and use backend `default-personal` ensure route
- Chat attachments and user message requests now carry `input_ref` provenance (`inputs: InputRef[]` for user messages)

## Benefits of This Architecture

1. **Consistent UX**
- “Everything goes into file library first, then gets referenced”

2. **Better auditability**
- provenance of files and reuse across Chat/Notebook/Agents

3. **Cleaner quota/policy model**
- storage and runtime consumption can be measured/enforced on shared primitives

4. **Less duplicated ingestion logic**
- one object layer, many consumers

## Risks / Design Considerations

1. **Backward compatibility**
- Existing Notebook APIs and data use `attached_source_ids`
- migration must be incremental

2. **Runtime-specific behavior still differs**
- Unified input references do not mean unified transport implementation
- this is expected and acceptable

3. **Security**
- Tool-based fetchers (Notebook/Codex) still depend on API auth strategy
- SSE ticket/JWT query and runtime bearer propagation remain separate concerns

## Recommended Next Concrete Step

Implement backend-enforced system-managed default personal libraries (explicit marker/flags), then migrate Chat/Notebook UI and library management screens to respect those invariants without relying on naming conventions.
