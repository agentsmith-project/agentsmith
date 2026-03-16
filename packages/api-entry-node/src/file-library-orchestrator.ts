export interface FileLibraryProvisioningInput {
  libraryId: string;
  workspaceId: string;
  projectId: string;
  libraryName: string;
  filesystemName: string;
  requestedByUserId: string;
}

export interface FileLibraryProvisioningResult {
  filesystemName: string;
  metadataUrl: string;
  postgres: {
    host: string;
    port: number;
    database: string;
    username: string;
  };
  minio: {
    endpoint: string;
    bucket: string;
    region?: string;
  };
}

export interface FileLibraryDeleteInput {
  libraryId: string;
  filesystemName: string;
}

export interface FileLibraryOrchestrator {
  provisionLibrary(input: FileLibraryProvisioningInput): Promise<FileLibraryProvisioningResult>;
  deleteLibrary(input: FileLibraryDeleteInput): Promise<void>;
}
