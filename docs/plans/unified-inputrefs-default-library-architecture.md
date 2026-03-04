# Unified Input References + Default File Library Architecture

Status: implemented architecture direction (active reference)

## Summary

This document defines a cleaner long-term architecture for file inputs across Chat and Notebook:

- All user-provided files (uploads, library objects, future URL imports) enter the system via a **File Library object layer**
- Chat / Notebook / Agents consume inputs through a unified **Input Reference** model
- `source` becomes a derived/processed capability (AI Ready / indexing), not a parallel primary file entry path

This architecture replaced the previous split behavior where Chat and Notebook used different primary file input paths.

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

Current direction:
- Notebook task inputs use `attached_inputs: InputRef[]`
- Chat user messages use `inputs: InputRef[]` (provider/runtime transport remains runtime-specific)

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
- `source-read` skill helper supports fetching `library_object` refs

### Phase 2 (completed)
- Chat local uploads and library picks share a unified object-first attachment path
- Chat local uploads now:
  - ensure a default personal library
  - upload object to `chat/<session_id>/uploads/`
  - create attachment from the library object
- Backend provides `GET /source-libraries/default-personal` (idempotent ensure route)

### Phase 3 (partially completed)
- Backend-enforced default personal library semantics implemented with `system_managed_kind=default_personal_uploads` + protected rename/delete semantics
- Shared backend/runtime input resolver extraction is in progress:
  - Chat input parsing/attachment resolution is centralized in `chat-input-refs.ts`
  - Notebook input detail/runtime mapping is centralized in `notebook-input-refs.ts`
  - Cross-runtime resolver contract (Chat + Notebook + Agents) remains a follow-up

### Phase 4 (Derived processing alignment)
- `source` records become explicitly derived from `library_object`
- AI Ready state and indexing become part of derived processing pipeline, not file identity

## Current Transitional Areas

- Chat still consumes inputs through the existing attachment runtime path (provider-oriented payloads), even though request semantics and provenance are `InputRef`-based.
- Shared backend/runtime input resolver interfaces are not yet centralized.
- Optional hardening remains for legacy data cleanup (eliminate any name-based fallback checks in existing data).

### Progress update (2026-02)
- Notebook task inputs use `attached_inputs` and `/tasks/:taskId/inputs` (`source` + `library_object`)
- Notebook "Add URL" now stores URL notes as default personal library objects, then attaches them as first-class `url` input refs (with imported object provenance)
- Notebook artifacts can be attached as first-class `artifact` input refs (output-to-input loop), while runtime consumption uses task artifact download
- Chat local uploads and library selections are object-first and use backend `default-personal` ensure route
- Notebook local uploads are object-first and attach `library_object` refs (no direct local-upload -> `source` shortcut)
- Chat attachments and user message requests now carry `input_ref` provenance (`inputs: InputRef[]` for user messages), including first-class `url` refs with optional imported object provenance
- `source` is treated as a derived/processed input type (AI-ready/indexed workflow), not the primary raw-file ingestion path for Chat/Notebook
- Backend source creation (`POST /projects/:projectId/sources`) now requires `library_id`, making source creation explicitly object-backed

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

1. **Runtime-specific behavior still differs**
- Unified input references do not mean unified transport implementation
- this is expected and acceptable
- Chat currently resolves `InputRef` through attachment snapshots (provider-oriented path), while Notebook/Codex resolves through manifest + skill/tool fetch

2. **Security**
- Tool-based fetchers (Notebook/Codex) still depend on API auth strategy
- SSE ticket/JWT query and runtime bearer propagation remain separate concerns

## Recommended Next Concrete Step

Continue extracting a cross-runtime backend input resolver interface for Chat/Notebook/Agents by layering a common resolver contract on top of the now-centralized chat (`chat-input-refs.ts`) and notebook (`notebook-input-refs.ts`) modules, then promote `url`/`artifact` handling to the same contract used by `library_object` and `source`.
