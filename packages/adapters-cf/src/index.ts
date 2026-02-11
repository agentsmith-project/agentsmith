import type { ProjectDTO } from '@mbos/contracts';
import type { ObjectStorePort, ProjectRepoPort } from '@mbos/ports';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

// Placeholder Cloudflare adapter for future D1/R2/KV integration.
export class CfProjectRepoStub implements ProjectRepoPort {
  async listByWorkspace(_workspaceId: string): Promise<ProjectDTO[]> {
    return [];
  }

  async getById(_workspaceId: string, _projectId: string): Promise<ProjectDTO | null> {
    return null;
  }

  async save(_project: ProjectDTO): Promise<void> {
    return;
  }

  async update(
    _workspaceId: string,
    _projectId: string,
    _patch: Partial<ProjectDTO>,
  ): Promise<ProjectDTO | null> {
    return null;
  }

  async delete(_workspaceId: string, _projectId: string): Promise<boolean> {
    return false;
  }
}

export class CfObjectStoreStub implements ObjectStorePort {
  async putObject(
    _bucket: string,
    _key: string,
    _body: Uint8Array,
    _contentType?: string,
  ): Promise<void> {
    return;
  }

  async putObjectStream(
    _bucket: string,
    _key: string,
    _body: WebReadableStream<Uint8Array>,
  ): Promise<void> {
    return;
  }

  async presignedGetObject(
    _bucket: string,
    _key: string,
    _expirySeconds?: number,
  ): Promise<string> {
    return '';
  }

  async getObject(_bucket: string, _key: string): Promise<Uint8Array> {
    return new Uint8Array();
  }

  async getObjectStream(): Promise<{
    body: WebReadableStream<Uint8Array>;
    sizeBytes?: number;
    contentType?: string;
    etag?: string;
    lastModified?: string;
    metadata?: Record<string, string>;
  }> {
    return { body: new ReadableStream<Uint8Array>() as unknown as WebReadableStream<Uint8Array> };
  }

  async statObject(): Promise<{
    key: string;
    sizeBytes: number;
    contentType?: string;
    etag?: string;
    lastModified: string;
    metadata?: Record<string, string>;
  }> {
    throw new Error('not_implemented');
  }

  async listObjects(): Promise<{
    prefix: string;
    objects: Array<{ key: string; sizeBytes: number; etag?: string; lastModified: string }>;
    commonPrefixes: string[];
    nextContinuationToken: string | null;
  }> {
    return { prefix: '', objects: [], commonPrefixes: [], nextContinuationToken: null };
  }

  async copyObject(): Promise<void> {
    throw new Error('not_implemented');
  }

  async deleteObject(_bucket: string, _key: string): Promise<void> {
    return;
  }

  async deleteMany(): Promise<void> {
    return;
  }
}
