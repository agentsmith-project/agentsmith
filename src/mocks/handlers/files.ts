import { http, HttpResponse } from 'msw';
import type { FileLibrary } from '@/lib/api/types';
import { DOC_FIXTURES_ENABLED } from '../doc-fixtures/mode';
import { docFileLibraries } from '../doc-fixtures/workspace-projects';
import { docObjectDbByLibraryId } from '../doc-fixtures/files';
import { VISUAL_TEST_REFERENCE_NOW_ISO } from '@/lib/mock-time';

type ObjectRow =
  | { kind: 'prefix'; prefix: string; name: string }
  | { kind: 'object'; key: string; name: string; size_bytes: number; content_type: string; etag?: string; last_modified: string; content?: string };

const sourceLibraries: FileLibrary[] = DOC_FIXTURES_ENABLED ? [...docFileLibraries] : [
  {
    id: 'lib_shared_default',
    workspace_id: 'ws_default',
    project_id: 'proj_001',
    name: 'Shared Docs',
    description: 'Default shared library',
    visibility: 'shared' as const,
    provider: 's3' as const,
    bucket: 'mbos-proj-001-shared-docs',
    status: 'ready' as const,
    filesystem_name: 'flib-ws-default-proj-001-shared-docs',
    created_by_user_id: 'user_001',
    created_at: new Date('2026-02-01T00:00:00Z').toISOString(),
    updated_at: new Date('2026-02-01T00:00:00Z').toISOString(),
  },
  {
    id: 'lib_policy_rules',
    workspace_id: 'ws_default',
    project_id: 'proj_001',
    name: 'Policy Rules',
    description: 'Shared policy and governance references',
    visibility: 'shared' as const,
    provider: 's3' as const,
    bucket: 'mbos-proj-001-policy-rules',
    status: 'ready' as const,
    filesystem_name: 'flib-ws-default-proj-001-policy-rules',
    created_by_user_id: 'user_001',
    created_at: new Date('2026-02-02T00:00:00Z').toISOString(),
    updated_at: new Date('2026-02-02T00:00:00Z').toISOString(),
  },
  {
    id: 'lib_product_specs',
    workspace_id: 'ws_default',
    project_id: 'proj_001',
    name: 'Product Specs',
    description: 'Shared product and API specifications',
    visibility: 'shared' as const,
    provider: 's3' as const,
    bucket: 'mbos-proj-001-product-specs',
    status: 'ready' as const,
    filesystem_name: 'flib-ws-default-proj-001-product-specs',
    created_by_user_id: 'user_001',
    created_at: new Date('2026-02-03T00:00:00Z').toISOString(),
    updated_at: new Date('2026-02-03T00:00:00Z').toISOString(),
  },
  {
    id: 'lib_large_bench',
    workspace_id: 'ws_default',
    project_id: 'proj_001',
    name: 'Large Bench',
    description: 'Large directory benchmark fixture',
    visibility: 'shared' as const,
    provider: 's3' as const,
    bucket: 'mbos-proj-001-large-bench',
    status: 'ready' as const,
    filesystem_name: 'flib-ws-default-proj-001-large-bench',
    created_by_user_id: 'user_001',
    created_at: new Date('2026-02-04T00:00:00Z').toISOString(),
    updated_at: new Date('2026-02-04T00:00:00Z').toISOString(),
  },
];

export const mockFileNowIso = () => VISUAL_TEST_REFERENCE_NOW_ISO;
const nowIso = mockFileNowIso;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const failOnceCounters: Record<string, number> = {};

function shouldFailOnce(kind: 'delete' | 'download', key: string) {
  const marker = kind === 'delete' ? '__fail_once_delete__' : '__fail_once_download__';
  if (!key.includes(marker)) return false;
  const bucket = `${kind}:${key}`;
  const count = failOnceCounters[bucket] ?? 0;
  if (count > 0) return false;
  failOnceCounters[bucket] = count + 1;
  return true;
}

const objectDbByLibraryId: Record<string, ObjectRow[]> = DOC_FIXTURES_ENABLED
  ? (docObjectDbByLibraryId as Record<string, ObjectRow[]>)
  : {
  lib_shared_default: [
    { kind: 'prefix', prefix: 'docs/', name: 'docs' },
    { kind: 'prefix', prefix: 'images/', name: 'images' },
    { kind: 'object', key: 'README.txt', name: 'README.txt', size_bytes: 42, content_type: 'text/plain', etag: '"etag1"', last_modified: nowIso(), content: 'Hello from Shared Docs\n' },
    { kind: 'object', key: 'docs/mbos-contracts.md', name: 'mbos-contracts.md', size_bytes: 1200, content_type: 'text/markdown', etag: '"etag2"', last_modified: nowIso(), content: '# Contracts\n' },
    { kind: 'object', key: 'images/logo.png', name: 'logo.png', size_bytes: 2048, content_type: 'image/png', etag: '"etag3"', last_modified: nowIso() },
  ],
  lib_policy_rules: [
    { kind: 'object', key: 'policies/README.md', name: 'README.md', size_bytes: 900, content_type: 'text/markdown', etag: '"etag4"', last_modified: nowIso(), content: '# Policies\n' },
  ],
  lib_product_specs: [
    { kind: 'object', key: 'specs/api/openapi.json', name: 'openapi.json', size_bytes: 1500, content_type: 'application/json', etag: '"etag5"', last_modified: nowIso(), content: '{\"openapi\":\"3.0.0\"}' },
  ],
  lib_large_bench: Array.from({ length: 260 }).map((_, index) => {
    const name = `bulk-${String(index + 1).padStart(4, '0')}.txt`;
    return {
      kind: 'object' as const,
      key: name,
      name,
      size_bytes: 100 + index,
      content_type: 'text/plain',
      etag: `"bulk-${index + 1}"`,
      last_modified: nowIso(),
      content: `bulk file ${index + 1}`,
    };
  }),
};

function normalizePrefix(prefix: string | null): string {
  if (!prefix) return '';
  if (prefix === '/') return '';
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
}

function basename(path: string) {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const idx = trimmed.lastIndexOf('/');
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

function toFileLibraryEntries(items: ReturnType<typeof listObjects>) {
  return items.map((item) =>
    item.kind === 'prefix'
      ? {
          kind: 'directory' as const,
          path: item.prefix,
          name: item.name,
        }
      : {
          kind: 'file' as const,
          path: item.key,
          name: item.name,
          size_bytes: item.size_bytes,
          content_type: item.content_type,
          modified_at: item.last_modified,
          etag: item.etag,
        });
}

function listObjects(
  libraryId: string,
  prefix: string,
  options?: {
    search?: string;
    sortBy?: 'name' | 'size_bytes' | 'last_modified';
    sortOrder?: 'asc' | 'desc';
  },
) {
  const db = objectDbByLibraryId[libraryId] ?? [];
  const normalized = normalizePrefix(prefix);
  const search = options?.search?.trim().toLowerCase() ?? '';
  const hasSearch = search.length > 0;
  const sortBy = options?.sortBy ?? 'name';
  const sortOrder = options?.sortOrder ?? 'asc';
  const sortFactor = sortOrder === 'desc' ? -1 : 1;

  const prefixes = new Set<string>();
  const objects: ObjectRow[] = [];

  for (const row of db) {
    if (row.kind !== 'object') continue;
    // Hide folder markers from file rows; represent them as prefixes.
    if (row.key.endsWith('/')) {
      if (normalized && !row.key.startsWith(normalized)) continue;
      if (row.key !== normalized) prefixes.add(row.key);
      continue;
    }
    if (normalized && !row.key.startsWith(normalized)) continue;
    const rest = row.key.slice(normalized.length);
    const slash = rest.indexOf('/');
    if (slash >= 0) {
      const folder = `${normalized}${rest.slice(0, slash + 1)}`;
      prefixes.add(folder);
      continue;
    }
    objects.push(row);
  }

  let prefixItems: ObjectRow[] = Array.from(prefixes)
    .map((p) => ({ kind: 'prefix' as const, prefix: p, name: basename(p) }))
    .sort((a, b) => {
      if (a.kind !== 'prefix' || b.kind !== 'prefix') return 0;
      return a.name.localeCompare(b.name) * sortFactor;
    });

  let objectItems = objects
    .slice()
    .sort((a, b) => {
      if (a.kind !== 'object' || b.kind !== 'object') return 0;
      if (sortBy === 'size_bytes') return (a.size_bytes - b.size_bytes) * sortFactor;
      if (sortBy === 'last_modified') return a.last_modified.localeCompare(b.last_modified) * sortFactor;
      return a.name.localeCompare(b.name) * sortFactor;
    })
    .map((o) => ({
      kind: 'object' as const,
      key: (o as Extract<ObjectRow, { kind: 'object' }>).key,
      name: (o as Extract<ObjectRow, { kind: 'object' }>).name,
      size_bytes: (o as Extract<ObjectRow, { kind: 'object' }>).size_bytes,
      content_type: (o as Extract<ObjectRow, { kind: 'object' }>).content_type,
      etag: (o as Extract<ObjectRow, { kind: 'object' }>).etag,
      last_modified: (o as Extract<ObjectRow, { kind: 'object' }>).last_modified,
    }));

  if (hasSearch) {
    prefixItems = prefixItems.filter((item) => item.kind === 'prefix' && item.name.toLowerCase().includes(search));
    objectItems = objectItems.filter((item) => item.kind === 'object' && item.name.toLowerCase().includes(search));
  }

  return [...prefixItems, ...objectItems];
}

export const fileHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/file-libraries', ({ params }) => {
    const projectId = String(params.prj ?? '');
    const workspaceId = String(params.ws ?? '');
    return HttpResponse.json({
      items: sourceLibraries.filter(
        (item) => item.project_id === projectId && item.workspace_id === workspaceId,
      ),
    });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/file-libraries', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      description?: string;
    };
    if (!body.name) {
      return HttpResponse.json(
        { error_code: 'VALIDATION_ERROR', message: 'invalid_request' },
        { status: 400 },
      );
    }
    const now = nowIso();
    const id = `flib_${Date.now()}`;
    const slug = body.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'filelib';
    const created = {
      id,
      workspace_id: String(params.ws ?? ''),
      project_id: String(params.prj ?? ''),
      name: body.name,
      description: body.description ?? '',
      visibility: 'shared' as const,
      provider: 'juicefs' as const,
      bucket: `jfs-lib-${id}`,
      status: 'ready' as const,
      filesystem_name: `flib-${slug}`.slice(0, 63),
      created_by_user_id: 'user_001',
      created_at: now,
      updated_at: now,
    };
    sourceLibraries.push(created);
    objectDbByLibraryId[id] = [];
    return HttpResponse.json(created, { status: 201 });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/file-libraries/:id', ({ params }) => {
    const library = sourceLibraries.find((item) => item.id === params.id);
    if (!library) {
      return HttpResponse.json({ error_code: 'RESOURCE_NOT_FOUND', message: 'file_library_not_found' }, { status: 404 });
    }
    return HttpResponse.json(library);
  }),
  http.patch('/api/v1/workspaces/:ws/projects/:prj/file-libraries/:id', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as { name?: string; description?: string };
    const index = sourceLibraries.findIndex((item) => item.id === params.id);
    if (index === -1) {
      return HttpResponse.json({ error_code: 'RESOURCE_NOT_FOUND', message: 'file_library_not_found' }, { status: 404 });
    }
    sourceLibraries[index] = {
      ...sourceLibraries[index],
      ...body,
      updated_at: nowIso(),
    };
    return HttpResponse.json(sourceLibraries[index]);
  }),
  http.delete('/api/v1/workspaces/:ws/projects/:prj/file-libraries/:id', ({ params }) => {
    const index = sourceLibraries.findIndex((item) => item.id === params.id);
    if (index === -1) {
      return HttpResponse.json({ error_code: 'RESOURCE_NOT_FOUND', message: 'file_library_not_found' }, { status: 404 });
    }
    const hasObjects = (objectDbByLibraryId[String(params.id ?? '')] ?? []).some((row) => row.kind === 'object' && !row.key.endsWith('/'));
    if (hasObjects) {
      return HttpResponse.json({ error_code: 'RESOURCE_CONFLICT', message: 'file_library_not_empty' }, { status: 409 });
    }
    sourceLibraries.splice(index, 1);
    delete objectDbByLibraryId[String(params.id ?? '')];
    return HttpResponse.json(null, { status: 204 });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/file-libraries/:id/backend', ({ params }) => {
    const library = sourceLibraries.find((item) => item.id === params.id);
    if (!library) {
      return HttpResponse.json({ error_code: 'RESOURCE_NOT_FOUND', message: 'file_library_backend_not_found' }, { status: 404 });
    }
    return HttpResponse.json({
      library_id: library.id,
      filesystem_name: library.filesystem_name,
      provisioning_status: library.status,
      gateway_status: 'ready',
      postgres: {
        host: 'localhost',
        port: 15432,
        database: `jfs_lib_${library.id}`,
        username: `jfsu_${library.id}`,
      },
      minio: {
        endpoint: 'http://localhost:19000',
        bucket: library.bucket,
        region: 'us-east-1',
      },
    });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/file-libraries/:id/storage-credential-exchange', ({ params }) => {
    const library = sourceLibraries.find((item) => item.id === params.id);
    if (!library) {
      return HttpResponse.json({ error_code: 'RESOURCE_NOT_FOUND', message: 'file_library_mount_access_not_found' }, { status: 404 });
    }
    return HttpResponse.json({
      client_mount_access: {
        filesystem_name: library.filesystem_name,
        metadata_url: `postgres://jfsu_${library.id}:secret@files.example.com:15432/jfs_lib_${library.id}`,
        storage_bucket_url: `https://files.example.com:19000/${library.filesystem_name}`,
        recommended_mount_path: `~/Agentsmith/${library.name}`,
        platform_notes: [
          'Linux requires FUSE support.',
          'macOS requires macFUSE.',
          'Windows requires JuiceFS-supported filesystem dependencies.',
        ],
        recommended_mount_commands: {
          linux: `juicefs mount 'postgres://jfsu_${library.id}:secret@files.example.com:15432/jfs_lib_${library.id}' '$HOME/Agentsmith/${library.name}' --bucket 'https://files.example.com:19000/${library.filesystem_name}'`,
          macos: `juicefs mount 'postgres://jfsu_${library.id}:secret@files.example.com:15432/jfs_lib_${library.id}' '$HOME/Agentsmith/${library.name}' --bucket 'https://files.example.com:19000/${library.filesystem_name}'`,
          windows: `juicefs mount "postgres://jfsu_${library.id}:secret@files.example.com:15432/jfs_lib_${library.id}" X: --bucket "https://files.example.com:19000/${library.filesystem_name}"`,
        },
        created_at: nowIso(),
      },
    });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/file-libraries/:id/desktop-mount-access', ({ params, request }) => {
    const library = sourceLibraries.find((item) => item.id === params.id);
    if (!library) {
      return HttpResponse.json({ error_code: 'RESOURCE_NOT_FOUND', message: 'file_library_mount_access_not_found' }, { status: 404 });
    }
    const url = new URL(request.url);
    return HttpResponse.json({
      desktop_mount_access: {
        filesystem_name: library.filesystem_name,
        metadata_url: `postgres://jfsu_${library.id}:secret@files.example.com:15432/jfs_lib_${library.id}`,
        storage_bucket_url: `https://files.example.com:19000/${library.filesystem_name}`,
        deployment_base_url: `${url.protocol}//${url.host}`,
        default_mount_roots: {
          linux: '~/AgentSmith',
          macos: '~/AgentSmith',
          windows: '%USERPROFILE%\\AgentSmith',
        },
        windows_requires_drive_letter: true,
        created_at: nowIso(),
      },
    });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/file-libraries/:id/entries', ({ params, request }) => {
    const libraryId = String(params.id ?? '');
    const url = new URL(request.url);
    const path = normalizePrefix(url.searchParams.get('path'));
    const pageSize = Number(url.searchParams.get('page_size') ?? '200');
    const safePageSize = Number.isFinite(pageSize) ? Math.min(Math.max(Math.floor(pageSize), 1), 1000) : 200;
    const continuationToken = url.searchParams.get('continuation_token');
    const offset = continuationToken ? Number(continuationToken) : 0;
    const safeOffset = Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0;
    const items = toFileLibraryEntries(listObjects(libraryId, path, {
      search: url.searchParams.get('search') ?? undefined,
      sortBy: (url.searchParams.get('sort_by') as 'name' | 'size_bytes' | 'last_modified' | 'modified_at' | null)?.replace('modified_at', 'last_modified') as 'name' | 'size_bytes' | 'last_modified' | undefined,
      sortOrder: (url.searchParams.get('sort_order') as 'asc' | 'desc' | null) ?? undefined,
    }));
    const pagedItems = items.slice(safeOffset, safeOffset + safePageSize);
    const nextToken = safeOffset + safePageSize < items.length ? String(safeOffset + safePageSize) : null;
    return HttpResponse.json({
      path,
      items: pagedItems,
      next_continuation_token: nextToken,
    });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/file-libraries/:id/folders', async ({ params, request }) => {
    const libraryId = String(params.id ?? '');
    const body = (await request.json().catch(() => ({}))) as { path?: string };
    const prefix = normalizePrefix(body.path ?? '');
    if (!prefix) return HttpResponse.json({ error_code: 'invalid_file_library_directory_path', message: 'invalid_file_library_directory_path' }, { status: 400 });
    const db = objectDbByLibraryId[libraryId] ?? (objectDbByLibraryId[libraryId] = []);
    const exists = db.some((r) => r.kind === 'object' && r.key === prefix);
    if (!exists) {
      db.push({
        kind: 'object',
        key: prefix,
        name: basename(prefix),
        size_bytes: 0,
        content_type: 'application/x-directory',
        etag: `"${Date.now()}"`,
        last_modified: nowIso(),
      });
    }
    return HttpResponse.json(null, { status: 204 });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/file-libraries/:id/delete', async ({ params, request }) => {
    const libraryId = String(params.id ?? '');
    const body = (await request.json().catch(() => ({}))) as { paths?: string[] };
    const paths = (body.paths ?? []).filter(Boolean);
    const db = objectDbByLibraryId[libraryId] ?? (objectDbByLibraryId[libraryId] = []);
    const results = paths.map((path) => {
      if (shouldFailOnce('delete', path)) {
        return { path, status: 'error', error_code: 'simulated_failure', message: 'simulated_failure' };
      }
      if (path.endsWith('/')) {
        objectDbByLibraryId[libraryId] = db.filter((r) => r.kind !== 'object' || !r.key.startsWith(path));
        return { path, status: 'deleted' };
      }
      const idx = db.findIndex((r) => r.kind === 'object' && r.key === path);
      if (idx >= 0) db.splice(idx, 1);
      return { path, status: 'deleted' };
    });
    return HttpResponse.json({ results });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/file-libraries/:id/move', async ({ params, request }) => {
    const libraryId = String(params.id ?? '');
    const body = (await request.json().catch(() => ({}))) as { from_path?: string; to_path?: string; overwrite?: boolean };
    const fromPath = String(body.from_path ?? '');
    const toPath = String(body.to_path ?? '');
    if (!fromPath || !toPath) {
      return HttpResponse.json({ error_code: 'invalid_file_library_move_request', message: 'invalid_file_library_move_request' }, { status: 400 });
    }
    const db = objectDbByLibraryId[libraryId] ?? (objectDbByLibraryId[libraryId] = []);
    const exists = db.some((r) => r.kind === 'object' && r.key === toPath);
    if (exists && !body.overwrite) {
      return HttpResponse.json({ error_code: 'destination_exists', message: 'destination_exists' }, { status: 409 });
    }
    const srcIdx = db.findIndex((r) => r.kind === 'object' && r.key === fromPath);
    if (srcIdx === -1) {
      return HttpResponse.json({ error_code: 'object_not_found', message: 'object_not_found' }, { status: 404 });
    }
    const src = db[srcIdx] as Extract<ObjectRow, { kind: 'object' }>;
    db.splice(srcIdx, 1);
    db.push({ ...src, key: toPath, name: basename(toPath), last_modified: nowIso() });
    return HttpResponse.json(null, { status: 204 });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/file-libraries/:id/meta', ({ params, request }) => {
    const libraryId = String(params.id ?? '');
    const url = new URL(request.url);
    const path = url.searchParams.get('path') ?? '';
    const db = objectDbByLibraryId[libraryId] ?? [];
    const obj = db.find((r) => r.kind === 'object' && r.key === path) as Extract<ObjectRow, { kind: 'object' }> | undefined;
    if (!obj) return HttpResponse.json({ error_code: 'object_not_found', message: 'object_not_found' }, { status: 404 });
    return HttpResponse.json({
      key: obj.key,
      size_bytes: obj.size_bytes,
      content_type: obj.content_type,
      etag: obj.etag,
      last_modified: obj.last_modified,
      user_metadata: {},
    });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/file-libraries/:id/share-link', async ({ params, request }) => {
    const libraryId = String(params.id ?? '');
    const body = (await request.json().catch(() => ({}))) as { path?: string; expires_in_seconds?: number };
    const path = String(body.path ?? '').trim();
    const expiresInSeconds = Number(body.expires_in_seconds ?? 900);
    if (!path) {
      return HttpResponse.json({ error_code: 'invalid_file_library_share_link_request', message: 'invalid_file_library_share_link_request' }, { status: 400 });
    }
    const db = objectDbByLibraryId[libraryId] ?? [];
    const obj = db.find((r) => r.kind === 'object' && r.key === path) as Extract<ObjectRow, { kind: 'object' }> | undefined;
    if (!obj) {
      return HttpResponse.json({ error_code: 'object_not_found', message: 'object_not_found' }, { status: 404 });
    }
    const expiresAt = new Date(new Date(nowIso()).getTime() + expiresInSeconds * 1000).toISOString();
    const url = `https://mock-juicefs.local/${encodeURIComponent(libraryId)}/${encodeURIComponent(path)}?X-Amz-Expires=${expiresInSeconds}&X-Amz-Signature=mock`;
    return HttpResponse.json({
      key: path,
      url,
      expires_at: expiresAt,
    });
  }),
  http.post('/api/v1/workspaces/:ws/projects/:prj/file-libraries/:id/upload', async ({ params, request }) => {
    const libraryId = String(params.id ?? '');
    const form = await request.formData();
    const file = form.get('file');
    const prefix = normalizePrefix((form.get('prefix') as string | null) ?? '');
    const overwrite = ((form.get('overwrite') as string | null) ?? '').toLowerCase() === 'true';
    if (!(file instanceof File)) {
      return HttpResponse.json({ error_code: 'invalid_request', message: 'file_is_required' }, { status: 400 });
    }
    if (file.name.includes('slow-upload')) {
      await sleep(1200);
    }
    const path = `${prefix}${file.name}`;
    const db = objectDbByLibraryId[libraryId] ?? (objectDbByLibraryId[libraryId] = []);
    const existingIndex = db.findIndex((r) => r.kind === 'object' && r.key === path);
    if (existingIndex >= 0 && !overwrite) {
      return HttpResponse.json({ error_code: 'destination_exists', message: 'destination_exists' }, { status: 409 });
    }
    const contentType = file.type || 'application/octet-stream';
    const content = contentType.startsWith('text/') ? await file.text().catch(() => '') : undefined;
    const row: Extract<ObjectRow, { kind: 'object' }> = {
      kind: 'object',
      key: path,
      name: basename(path),
      size_bytes: file.size,
      content_type: contentType,
      etag: `"${Date.now()}"`,
      last_modified: nowIso(),
      content,
    };
    if (existingIndex >= 0 && overwrite) db.splice(existingIndex, 1);
    db.push(row);
    return HttpResponse.json({
      kind: 'file',
      path: row.key,
      name: row.name,
      size_bytes: row.size_bytes,
      content_type: row.content_type,
      etag: row.etag,
      modified_at: row.last_modified,
    }, { status: 201 });
  }),
  http.get('/api/v1/workspaces/:ws/projects/:prj/file-libraries/:id/download', ({ params, request }) => {
    const libraryId = String(params.id ?? '');
    const url = new URL(request.url);
    const path = url.searchParams.get('path') ?? '';
    const db = objectDbByLibraryId[libraryId] ?? [];
    const obj = db.find((r) => r.kind === 'object' && r.key === path) as Extract<ObjectRow, { kind: 'object' }> | undefined;
    if (!obj) return HttpResponse.json({ error_code: 'object_not_found', message: 'object_not_found' }, { status: 404 });
    if (shouldFailOnce('download', path)) {
      return HttpResponse.json({ error_code: 'simulated_failure', message: 'simulated_failure' }, { status: 500 });
    }
    const bytes = obj.content ? new TextEncoder().encode(obj.content) : new Uint8Array([1, 2, 3, 4]);
    return new HttpResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': obj.content_type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename=\"${basename(path) || 'download'}\"`,
      },
    });
  }),
];
