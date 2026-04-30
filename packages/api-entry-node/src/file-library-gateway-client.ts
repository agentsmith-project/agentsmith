import http from 'node:http';
import https from 'node:https';
import { Client as MinioClient } from 'minio';
import type { NodeApiDeps } from './node-api-deps.js';
import {
  JsonDocProjectFileLibraryBackendRepo,
  JsonDocProjectFileLibraryCatalogRepo,
  JsonDocProjectFileLibraryMountAccessRepo,
} from './file-library-persistence.js';
import {
  getFileLibraryGatewayInternalCredentials,
  resolveFileLibraryStorageBucketUrlForGatewayRuntime,
} from './file-library-runtime.js';

function createAbortError(
  reason?: unknown,
  fallbackMessage = 'file_library_gateway_client_aborted',
): Error {
  if (reason instanceof Error && reason.name === 'AbortError') {
    return reason;
  }
  const error = new Error(
    reason instanceof Error
      ? reason.message
      : typeof reason === 'string' && reason.trim().length > 0
        ? reason
        : fallbackMessage,
  );
  error.name = 'AbortError';
  if (reason instanceof Error) {
    (error as Error & { cause?: unknown }).cause = reason;
  }
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined, fallbackMessage: string): void {
  if (signal?.aborted) {
    throw createAbortError(signal.reason, fallbackMessage);
  }
}

function bindAbortSignal(
  signal: AbortSignal | undefined,
  onAbort: (reason?: unknown) => void,
): () => void {
  if (!signal) {
    return () => {};
  }
  if (signal.aborted) {
    onAbort(signal.reason);
    return () => {};
  }
  const handleAbort = () => onAbort(signal.reason);
  signal.addEventListener('abort', handleAbort, { once: true });
  return () => signal.removeEventListener('abort', handleAbort);
}

function createAbortAwareTransport(
  baseTransport: typeof http | typeof https,
  signal?: AbortSignal,
): NonNullable<ConstructorParameters<typeof MinioClient>[0]['transport']> | undefined {
  if (!signal) {
    return undefined;
  }

  return {
    request(
      optionsOrUrl: string | URL | http.RequestOptions,
      optionsOrCallback?: http.RequestOptions | ((res: http.IncomingMessage) => void),
      maybeCallback?: (res: http.IncomingMessage) => void,
    ) {
      const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
      let response: http.IncomingMessage | null = null;
      let cleaned = false;
      let removeAbortListener: () => void = () => {};

      const handleIncoming = (incoming: http.IncomingMessage): void => {
        response = incoming;
        incoming.once('close', cleanup);
        incoming.once('end', cleanup);
        if (signal.aborted) {
          abortRequest(signal.reason);
          return;
        }
        if (callback) {
          callback(incoming);
        }
      };
      const request = typeof optionsOrCallback === 'object' && optionsOrCallback !== null
        ? (
          typeof optionsOrUrl === 'string' || optionsOrUrl instanceof URL
            ? baseTransport.request(optionsOrUrl, optionsOrCallback, handleIncoming)
            : baseTransport.request({ ...optionsOrUrl, ...optionsOrCallback }, handleIncoming)
        )
        : baseTransport.request(optionsOrUrl, handleIncoming);

      const cleanup = () => {
        if (cleaned) {
          return;
        }
        cleaned = true;
        removeAbortListener();
        request.removeListener('close', cleanup);
        request.removeListener('error', cleanup);
        response?.removeListener('close', cleanup);
        response?.removeListener('end', cleanup);
      };

      const abortRequest = (reason?: unknown) => {
        const error = createAbortError(reason, 'file_library_gateway_client_aborted');
        response?.destroy(error);
        request.destroy(error);
        cleanup();
      };

      removeAbortListener = bindAbortSignal(signal, abortRequest);
      request.once('close', cleanup);
      request.once('error', cleanup);

      if (signal.aborted) {
        abortRequest(signal.reason);
      }

      return request;
    },
  };
}

export function normalizeFileLibraryPath(input?: string | null): string {
  const value = (input ?? '').trim().replace(/^\/+/, '').replace(/\/{2,}/g, '/');
  if (!value) return '';
  const segments = value.split('/').filter(Boolean);
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new Error('invalid_file_library_path');
    }
  }
  return segments.join('/');
}

export function fileLibraryBucketName(filesystemName: string): string {
  return filesystemName;
}

export function guessFileLibraryContentType(path: string): string | undefined {
  const lower = path.toLowerCase();
  if (lower.endsWith('.txt') || lower.endsWith('.md')) return 'text/plain';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return undefined;
}

export async function getProjectFileLibraryRecord(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  libraryId: string;
}) {
  return new JsonDocProjectFileLibraryCatalogRepo(args.deps.docStore).getById(
    args.workspaceId,
    args.projectId,
    args.libraryId,
  );
}

export async function createFileLibraryGatewayClient(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  filesystemName: string;
  signal?: AbortSignal;
}): Promise<MinioClient> {
  const backend = await new JsonDocProjectFileLibraryBackendRepo(args.deps.docStore).getInternal(
    args.workspaceId,
    args.projectId,
    args.libraryId,
  );
  const mountAccess = await new JsonDocProjectFileLibraryMountAccessRepo(args.deps.docStore).getById(
    args.workspaceId,
    args.projectId,
    args.libraryId,
  );
  if (!backend?.internal_metadata_url) {
    throw new Error('file_library_backend_not_found');
  }
  if (!args.deps.fileLibraryGatewayManager) {
    throw new Error('file_library_gateway_unavailable');
  }
  throwIfAborted(args.signal, 'file_library_gateway_client_aborted');
  const ensureGatewayInput = {
    libraryId: args.libraryId,
    filesystemName: args.filesystemName,
    metadataUrl: backend.internal_metadata_url,
    storageBucketUrl: resolveFileLibraryStorageBucketUrlForGatewayRuntime(mountAccess?.storage_bucket_url),
    signal: args.signal,
  };
  const gateway = await args.deps.fileLibraryGatewayManager.ensureGateway(ensureGatewayInput);
  const url = new URL(gateway.loopbackUrl);
  const credentials = getFileLibraryGatewayInternalCredentials(args.libraryId);
  const baseTransport = url.protocol === 'https:' ? https : http;
  const transport = createAbortAwareTransport(baseTransport, args.signal);
  return new MinioClient({
    endPoint: url.hostname,
    port: Number(url.port),
    useSSL: url.protocol === 'https:',
    accessKey: credentials.accessKey,
    secretKey: credentials.secretKey,
    ...(transport ? { transport } : {}),
  });
}
