import type { ProjectDTO } from '@mbos/contracts';
import type { ProjectRepoPort } from '@mbos/ports';

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

export class CfObjectStoreStub {
  async putObject(
    _bucket: string,
    _key: string,
    _body: Uint8Array,
    _contentType?: string,
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

  async deleteObject(_bucket: string, _key: string): Promise<void> {
    return;
  }
}
