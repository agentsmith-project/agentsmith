export interface EnsureFileLibraryGatewayInput {
  libraryId: string;
  filesystemName: string;
  metadataUrl: string;
  storageBucketUrl?: string;
}

export interface EnsureFileLibraryGatewayResult {
  loopbackUrl: string;
  port: number;
  status: 'starting' | 'ready' | 'degraded';
  lastStartedAt: string;
}

export interface FileLibraryGatewayHealth {
  status: 'ready' | 'degraded' | 'failed' | 'stopped';
  checkedAt: string;
  lastError?: string;
}

export interface FileLibraryGatewayManager {
  ensureGateway(input: EnsureFileLibraryGatewayInput): Promise<EnsureFileLibraryGatewayResult>;
  getHealth(libraryId: string): Promise<FileLibraryGatewayHealth>;
  stopGateway(libraryId: string): Promise<void>;
  reconcile?(): Promise<void>;
  shutdown?(): Promise<void>;
}
