import type { FileLibraryCatalogDTO } from '@mbos/contracts';
import type { FileLibraryCatalogRepoPort, JsonDocStorePort } from '@mbos/ports';

export class JsonDocFileLibraryCatalogRepo implements FileLibraryCatalogRepoPort {
  private static readonly collection = 'file_libraries';

  constructor(private readonly docStore: JsonDocStorePort) {}

  async listByProject(workspaceId: string, projectId: string): Promise<FileLibraryCatalogDTO[]> {
    return this.docStore.list<FileLibraryCatalogDTO>(JsonDocFileLibraryCatalogRepo.collection, {
      workspace_id: workspaceId,
      project_id: projectId,
    });
  }

  async getById(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<FileLibraryCatalogDTO | null> {
    const library = await this.docStore.get<FileLibraryCatalogDTO>(
      JsonDocFileLibraryCatalogRepo.collection,
      libraryId,
    );
    if (!library) {
      return null;
    }

    if (library.workspace_id !== workspaceId || library.project_id !== projectId) {
      return null;
    }

    return library;
  }

  async save(library: FileLibraryCatalogDTO): Promise<void> {
    await this.docStore.upsert<FileLibraryCatalogDTO>(
      JsonDocFileLibraryCatalogRepo.collection,
      library.id,
      library,
    );
  }

  async update(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    patch: Partial<FileLibraryCatalogDTO>,
  ): Promise<FileLibraryCatalogDTO | null> {
    const existing = await this.getById(workspaceId, projectId, libraryId);
    if (!existing) {
      return null;
    }

    const updated: FileLibraryCatalogDTO = {
      ...existing,
      ...patch,
    };
    await this.save(updated);
    return updated;
  }

  async delete(workspaceId: string, projectId: string, libraryId: string): Promise<boolean> {
    const existing = await this.getById(workspaceId, projectId, libraryId);
    if (!existing) {
      return false;
    }

    await this.docStore.delete(JsonDocFileLibraryCatalogRepo.collection, libraryId);
    return true;
  }
}
