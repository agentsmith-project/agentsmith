import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type {
  FileLibraryDownloadResult,
  FileLibraryEntry,
  FileLibraryObjectMeta,
  FileLibraryStoragePort,
} from '../file-library-afscp-storage.js';
import { normalizeAfscpFileLibraryPath } from '../file-library-afscp-storage.js';
import { guessFileLibraryContentType } from '../file-library-content-type.js';
import type { NodeApiDeps } from '../node-api-deps.js';
import type {
  ProjectStorageBootstrapServicePort,
  ProjectStoragePreflightResult,
} from '../project-storage-bootstrap-service.js';

type StoredFileLibraryEntry =
  | {
      kind: 'directory';
      path: string;
      modifiedAt: string;
    }
  | {
      kind: 'file';
      path: string;
      body: Buffer;
      contentType: string;
      modifiedAt: string;
      etag: string;
    };

type StoredRepo = {
  namespaceId: string;
  repoId: string;
  projectStorageGeneration: number;
  entries: Map<string, StoredFileLibraryEntry>;
  savePoints: Map<string, { id: string; message?: string; createdAt: string }>;
};

type StoredTemplate = {
  namespaceId: string;
  sourceRepo: StoredRepo;
  sourceSavePointId: string;
};

type SeedFile = {
  path: string;
  body: string | Uint8Array;
  contentType?: string;
};

export interface InMemoryAfscpFileLibraryStorageAdapter extends FileLibraryStoragePort {
  seedFile(input: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
  } & SeedFile): void;
}

type AfscpReadyDeps = NodeApiDeps & {
  __afscpReadyFileLibraryTestDeps?: true;
};

const TEST_WIRING_READY = '__afscpReadyFileLibraryTestDeps';

function repoKey(input: { workspaceId: string; projectId: string; libraryId: string }): string {
  return `${input.workspaceId}:${input.projectId}:${input.libraryId}`;
}

function sanitizeNamespaceSegment(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'default';
}

function readyProjectStorage(input: { workspaceId: string; projectId: string }): ProjectStoragePreflightResult {
  return {
    status: 'ready',
    namespaceId: `ns_${sanitizeNamespaceSegment(input.workspaceId)}_${sanitizeNamespaceSegment(input.projectId)}`,
    stage: 'ready',
    generation: 1,
    nextAction: 'none',
    retryable: false,
    lastErrorCode: null,
  };
}

function createReadyProjectStorageBootstrapService(): ProjectStorageBootstrapServicePort {
  return {
    enabled: true,
    bootstrapProjectStorage: async () => undefined,
    reconcileProjectStorage: async () => undefined,
    ensureProjectStorageReady: async (input) => readyProjectStorage(input),
  };
}

function normalizeObjectPath(input: string): string {
  const normalized = normalizeAfscpFileLibraryPath(input);
  if (!normalized) {
    throw new Error('invalid_file_library_path');
  }
  return normalized;
}

function normalizeDirectoryPath(input: string): string {
  const normalized = normalizeAfscpFileLibraryPath(input);
  return normalized ? `${normalized}/` : '';
}

function pathName(path: string): string {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  return trimmed.split('/').at(-1) ?? trimmed;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toBuffer(input: string | Uint8Array): Buffer {
  return typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
}

function createEtag(body: Buffer): string {
  return `"test-${body.length}-${Date.now().toString(36)}"`;
}

function fileMeta(path: string, entry: Extract<StoredFileLibraryEntry, { kind: 'file' }>): FileLibraryObjectMeta {
  return {
    key: path,
    size_bytes: entry.body.length,
    content_type: entry.contentType,
    etag: entry.etag,
    last_modified: entry.modifiedAt,
    user_metadata: {
      'content-type': entry.contentType,
    },
  };
}

function presentEntry(entry: StoredFileLibraryEntry): FileLibraryEntry {
  if (entry.kind === 'directory') {
    return {
      kind: 'directory',
      path: entry.path,
      name: pathName(entry.path),
    };
  }
  return {
    kind: 'file',
    path: entry.path,
    name: pathName(entry.path),
    size_bytes: entry.body.length,
    content_type: entry.contentType,
    modified_at: entry.modifiedAt,
    etag: entry.etag,
  };
}

function ensureParentDirectories(repo: StoredRepo, path: string): void {
  const segments = path.split('/');
  segments.pop();
  let current = '';
  for (const segment of segments) {
    if (!segment) continue;
    current = current ? `${current}${segment}/` : `${segment}/`;
    if (!repo.entries.has(current)) {
      repo.entries.set(current, {
        kind: 'directory',
        path: current,
        modifiedAt: nowIso(),
      });
    }
  }
}

function sortEntries(
  entries: FileLibraryEntry[],
  sortBy: 'name' | 'size_bytes' | 'modified_at',
  sortOrder: 'asc' | 'desc',
): FileLibraryEntry[] {
  const direction = sortOrder === 'desc' ? -1 : 1;
  return entries.sort((left, right) => {
    if (sortBy === 'size_bytes') {
      const leftSize = left.kind === 'file' ? left.size_bytes : -1;
      const rightSize = right.kind === 'file' ? right.size_bytes : -1;
      return (leftSize - rightSize) * direction;
    }
    if (sortBy === 'modified_at') {
      const leftModified = left.kind === 'file' ? Date.parse(left.modified_at) : 0;
      const rightModified = right.kind === 'file' ? Date.parse(right.modified_at) : 0;
      return (leftModified - rightModified) * direction;
    }
    return left.name.localeCompare(right.name) * direction;
  });
}

async function readWebStream(stream: WebReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(Buffer.from(next.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function putFile(repo: StoredRepo, input: SeedFile): Extract<StoredFileLibraryEntry, { kind: 'file' }> {
  const path = normalizeObjectPath(input.path);
  const body = toBuffer(input.body);
  const entry: Extract<StoredFileLibraryEntry, { kind: 'file' }> = {
    kind: 'file',
    path,
    body,
    contentType: input.contentType ?? guessFileLibraryContentType(path) ?? 'application/octet-stream',
    modifiedAt: nowIso(),
    etag: createEtag(body),
  };
  ensureParentDirectories(repo, path);
  repo.entries.set(path, entry);
  return entry;
}

function createRepoId(libraryId: string): string {
  return `repo_${libraryId.replace(/[^A-Za-z0-9_-]+/g, '_')}`;
}

export function createInMemoryAfscpFileLibraryStorageAdapter(options: {
  initialFiles?: SeedFile[];
} = {}): InMemoryAfscpFileLibraryStorageAdapter {
  const repos = new Map<string, StoredRepo>();
  const templates = new Map<string, StoredTemplate>();

  const requireRepo = (input: { workspaceId: string; projectId: string; libraryId: string }): StoredRepo => {
    const repo = repos.get(repoKey(input));
    if (!repo) {
      throw new Error('file_library_afscp_mapping_not_found');
    }
    return repo;
  };

  const adapter: InMemoryAfscpFileLibraryStorageAdapter = {
    enabled: true,
    async createRepoForLibrary(input) {
      const key = repoKey(input);
      let repo = repos.get(key);
      if (!repo) {
        repo = {
          namespaceId: input.namespaceId,
          repoId: createRepoId(input.libraryId),
          projectStorageGeneration: input.projectStorageGeneration,
          entries: new Map(),
          savePoints: new Map(),
        };
        repos.set(key, repo);
        for (const initialFile of options.initialFiles ?? []) {
          putFile(repo, initialFile);
        }
      }
      return {
        namespaceId: repo.namespaceId,
        repoId: repo.repoId,
        operationId: `op_${input.libraryId}`,
        operationStatus: 'succeeded',
        projectStorageGeneration: repo.projectStorageGeneration,
      };
    },
    async deleteRepoForLibrary(input) {
      repos.delete(repoKey(input));
    },
    async assertEmpty(input) {
      const repo = requireRepo(input);
      if (repo.entries.size > 0) {
        throw new Error('file_library_not_empty');
      }
    },
    async listSavePoints(input) {
      const repo = requireRepo(input);
      return Array.from(repo.savePoints.values()).map((savePoint) => ({
        savePointId: savePoint.id,
        repoId: repo.repoId,
        ...(savePoint.message ? { message: savePoint.message } : {}),
        createdAt: savePoint.createdAt,
      }));
    },
    async createSavePoint(input) {
      const repo = requireRepo(input);
      const id = `sp_${sanitizeNamespaceSegment(input.libraryId)}_${repo.savePoints.size + 1}`;
      const createdAt = nowIso();
      repo.savePoints.set(id, { id, message: input.message, createdAt });
      return {
        operationId: `op_${sanitizeNamespaceSegment(input.libraryId)}_save_point`,
        operationStatus: 'succeeded',
        savePointId: id,
        createdAt,
      };
    },
    async restoreFileLibrary(input) {
      requireRepo(input);
      return {
        operationId: `op_${sanitizeNamespaceSegment(input.libraryId)}_restore`,
        operationStatus: 'succeeded',
        sourceSavePointId: input.savePointId,
      };
    },
    async reconcileRestoreOperation(input) {
      requireRepo(input);
      return {
        operationId: input.operationId,
        operationStatus: 'succeeded',
        sourceSavePointId: null,
      };
    },
    async createTemplateFromLibrary(input) {
      const repo = requireRepo(input);
      const sourceSavePointId = `sp_${sanitizeNamespaceSegment(input.libraryId)}_template_${templates.size + 1}`;
      repo.savePoints.set(sourceSavePointId, {
        id: sourceSavePointId,
        message: `Template source ${input.templateId}`,
        createdAt: nowIso(),
      });
      templates.set(input.templateId, {
        namespaceId: repo.namespaceId,
        sourceRepo: repo,
        sourceSavePointId,
      });
      return {
        operationId: `op_${sanitizeNamespaceSegment(input.libraryId)}_template_create`,
        operationStatus: 'succeeded',
        templateId: input.templateId,
        sourceSavePointId,
      };
    },
    async cloneTemplateToLibrary(input) {
      const template = templates.get(input.templateId);
      if (!template || template.namespaceId !== input.namespaceId) {
        throw new Error('file_library_template_clone_failed');
      }
      const repo: StoredRepo = {
        namespaceId: input.namespaceId,
        repoId: createRepoId(input.libraryId),
        projectStorageGeneration: input.projectStorageGeneration,
        entries: new Map(template.sourceRepo.entries),
        savePoints: new Map(),
      };
      repos.set(repoKey(input), repo);
      return {
        namespaceId: repo.namespaceId,
        repoId: repo.repoId,
        operationId: `op_${sanitizeNamespaceSegment(input.libraryId)}_template_clone`,
        operationStatus: 'succeeded',
        projectStorageGeneration: repo.projectStorageGeneration,
      };
    },
    async reconcileLibraryProvisioning(input) {
      const repo = requireRepo(input);
      return {
        namespaceId: repo.namespaceId,
        repoId: repo.repoId,
        operationId: `op_${sanitizeNamespaceSegment(input.libraryId)}_template_clone`,
        operationStatus: 'succeeded',
        projectStorageGeneration: repo.projectStorageGeneration,
        lastErrorCode: null,
      };
    },
    async listEntries(input) {
      const repo = requireRepo(input);
      const directoryPath = normalizeDirectoryPath(input.path);
      const children = new Map<string, StoredFileLibraryEntry>();

      for (const entry of repo.entries.values()) {
        if (!entry.path.startsWith(directoryPath) || entry.path === directoryPath) {
          continue;
        }
        const remainder = entry.path.slice(directoryPath.length);
        const [firstSegment] = remainder.split('/');
        if (!firstSegment) continue;
        const childPath = remainder.includes('/')
          ? `${directoryPath}${firstSegment}/`
          : entry.path;
        if (children.has(childPath)) continue;
        if (childPath.endsWith('/') && childPath !== entry.path) {
          children.set(childPath, {
            kind: 'directory',
            path: childPath,
            modifiedAt: entry.modifiedAt,
          });
        } else {
          children.set(childPath, entry);
        }
      }

      let items = Array.from(children.values()).map(presentEntry);
      if (input.search) {
        const needle = input.search.toLowerCase();
        items = items.filter((item) => item.name.toLowerCase().includes(needle));
      }
      sortEntries(items, input.sortBy, input.sortOrder);
      return {
        path: directoryPath,
        items: items.slice(0, input.pageSize),
        nextContinuationToken: items.length > input.pageSize ? items[input.pageSize - 1]?.path ?? null : null,
      };
    },
    async createFolder(input) {
      const repo = requireRepo(input);
      const folderPath = normalizeDirectoryPath(input.folderPath);
      if (!folderPath) {
        throw new Error('invalid_file_library_directory_path');
      }
      ensureParentDirectories(repo, folderPath);
      repo.entries.set(folderPath, {
        kind: 'directory',
        path: folderPath,
        modifiedAt: nowIso(),
      });
    },
    async deletePaths(input) {
      const repo = requireRepo(input);
      return input.paths.map((rawPath) => {
        const path = rawPath.endsWith('/') ? normalizeDirectoryPath(rawPath) : normalizeObjectPath(rawPath);
        const deleteKeys = Array.from(repo.entries.keys()).filter((key) => key === path || key.startsWith(path.endsWith('/') ? path : `${path}/`));
        if (deleteKeys.length === 0) {
          return { path: rawPath, status: 'not_found' };
        }
        for (const key of deleteKeys) {
          repo.entries.delete(key);
        }
        return { path: rawPath, status: 'deleted' };
      });
    },
    async moveEntry(input) {
      const repo = requireRepo(input);
      const fromPath = input.fromPath.endsWith('/') ? normalizeDirectoryPath(input.fromPath) : normalizeObjectPath(input.fromPath);
      const toPath = input.toPath.endsWith('/') ? normalizeDirectoryPath(input.toPath) : normalizeObjectPath(input.toPath);
      const moving = Array.from(repo.entries.entries()).filter(([key]) => key === fromPath || key.startsWith(fromPath.endsWith('/') ? fromPath : `${fromPath}/`));
      if (moving.length === 0) {
        throw new Error('file_library_object_not_found');
      }
      const destinationExists = Array.from(repo.entries.keys()).some((key) => key === toPath || key.startsWith(toPath.endsWith('/') ? toPath : `${toPath}/`));
      if (destinationExists && !input.overwrite) {
        throw new Error('file_library_destination_exists');
      }
      if (destinationExists) {
        for (const key of Array.from(repo.entries.keys())) {
          if (key === toPath || key.startsWith(toPath.endsWith('/') ? toPath : `${toPath}/`)) {
            repo.entries.delete(key);
          }
        }
      }
      for (const [key, entry] of moving) {
        repo.entries.delete(key);
        const nextPath = key === fromPath ? toPath : `${toPath}${key.slice(fromPath.length)}`;
        repo.entries.set(nextPath, {
          ...entry,
          path: nextPath,
          modifiedAt: nowIso(),
        });
      }
    },
    async uploadObject(input) {
      const repo = requireRepo(input);
      const objectPath = normalizeObjectPath(input.objectPath);
      if (!input.overwrite && repo.entries.has(objectPath)) {
        throw new Error('file_library_destination_exists');
      }
      const body = await readWebStream(input.body);
      return presentEntry(putFile(repo, {
        path: objectPath,
        body,
        contentType: input.contentType,
      })) as Extract<FileLibraryEntry, { kind: 'file' }>;
    },
    async downloadObject(input): Promise<FileLibraryDownloadResult> {
      const repo = requireRepo(input);
      const objectPath = normalizeObjectPath(input.objectPath);
      const entry = repo.entries.get(objectPath);
      if (!entry || entry.kind !== 'file') {
        throw new Error('file_library_object_not_found');
      }
      return {
        meta: fileMeta(objectPath, entry),
        download: {
          stream: Readable.from([entry.body]),
          cancel: async () => undefined,
        },
      };
    },
    async getObjectMeta(input): Promise<FileLibraryObjectMeta> {
      const repo = requireRepo(input);
      const objectPath = normalizeObjectPath(input.objectPath);
      const entry = repo.entries.get(objectPath);
      if (!entry || entry.kind !== 'file') {
        throw new Error('file_library_object_not_found');
      }
      return fileMeta(objectPath, entry);
    },
    seedFile(input) {
      putFile(requireRepo(input), input);
    },
  };

  return adapter;
}

export function configureAfscpReadyFileLibraryTestDeps(deps: NodeApiDeps): void {
  const testDeps = deps as AfscpReadyDeps;
  if (testDeps[TEST_WIRING_READY]) {
    return;
  }
  deps.projectStorageBootstrapService = createReadyProjectStorageBootstrapService();
  deps.fileLibraryStorageAdapter = createInMemoryAfscpFileLibraryStorageAdapter();
  testDeps[TEST_WIRING_READY] = true;
}
