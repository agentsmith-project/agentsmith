import type { ProjectDTO, SourceDTO, SourceLibraryDTO } from '@mbos/contracts';

export interface ProjectRepoPort {
  listByWorkspace(workspaceId: string): Promise<ProjectDTO[]>;
  getById(workspaceId: string, projectId: string): Promise<ProjectDTO | null>;
  save(project: ProjectDTO): Promise<void>;
  update(
    workspaceId: string,
    projectId: string,
    patch: Partial<ProjectDTO>,
  ): Promise<ProjectDTO | null>;
  delete(workspaceId: string, projectId: string): Promise<boolean>;
}

export interface IdGeneratorPort {
  nextProjectId(): string;
}

export interface ClockPort {
  nowIso(): string;
}

export interface CachePort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
}

export interface JsonDocStorePort {
  get<T>(collection: string, id: string): Promise<T | null>;
  upsert<T>(collection: string, id: string, doc: T): Promise<void>;
  list<T>(collection: string, filter?: Record<string, string>): Promise<T[]>;
  delete(collection: string, id: string): Promise<void>;
}

export interface ObjectStorePort {
  putObject(
    bucket: string,
    key: string,
    body: Uint8Array,
    contentType?: string,
  ): Promise<void>;
  presignedGetObject(bucket: string, key: string, expirySeconds?: number): Promise<string>;
  getObject(bucket: string, key: string): Promise<Uint8Array>;
  deleteObject(bucket: string, key: string): Promise<void>;
}

export interface SourceRepoPort {
  listByProject(
    workspaceId: string,
    projectId: string,
    options?: { libraryId?: string },
  ): Promise<SourceDTO[]>;
  getById(workspaceId: string, projectId: string, sourceId: string): Promise<SourceDTO | null>;
  save(source: SourceDTO): Promise<void>;
  update(
    workspaceId: string,
    projectId: string,
    sourceId: string,
    patch: Partial<SourceDTO>,
  ): Promise<SourceDTO | null>;
  delete(workspaceId: string, projectId: string, sourceId: string): Promise<boolean>;
}

export interface SourceLibraryRepoPort {
  listByProject(workspaceId: string, projectId: string): Promise<SourceLibraryDTO[]>;
  getById(workspaceId: string, projectId: string, libraryId: string): Promise<SourceLibraryDTO | null>;
  save(library: SourceLibraryDTO): Promise<void>;
  update(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    patch: Partial<SourceLibraryDTO>,
  ): Promise<SourceLibraryDTO | null>;
  delete(workspaceId: string, projectId: string, libraryId: string): Promise<boolean>;
}
