/**
 * File-library recovery hooks.
 *
 * Save points and restore operate on the selected file library as a whole.
 */

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { toast } from '@/components/ui/toast';
import { FilesAPI, getApiClient } from '@/lib/api';
import type {
  FileLibraryOperationProjection,
  FileLibraryVersionOperation,
  FileLibraryRestoreOperation,
  GetFileLibraryActiveOperationResponse,
} from '@/lib/api/types';
import { APIError, handleErrorForToast } from '@/lib/api/errors';
import { queryKeys } from '@/lib/query-keys';

const ACTIVE_FILE_LIBRARY_OPERATION_REFETCH_INTERVAL_MS = 2_000;
const SAVE_POINTS_OPERATION_PENDING_REFETCH_INTERVAL_MS = 2_000;
const FILE_LIBRARY_VERSION_OPERATION_LOOKUP_REFETCH_INTERVAL_MS = 2_000;

type FileLibraryRecoveryMutationOptions = {
  suppressErrorToast?: boolean;
};

type CreateFileLibrarySavePointVariables = {
  workspaceId: string;
  projectId: string;
  libraryId: string;
  message?: string;
  idempotencyKey?: string;
};

export type FileLibraryVersionOperationWithResult = FileLibraryVersionOperation & {
  result_save_point_id?: string;
};

function generateSavePointIdempotencyKey(): string {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `save_point_${suffix}`;
}

function isVersionOperationActive(operation: FileLibraryVersionOperation | null | undefined) {
  return operation?.status === 'accepted' || operation?.status === 'running';
}

function isVersionOperationTerminal(operation: FileLibraryVersionOperation | null | undefined) {
  return operation?.status === 'succeeded'
    || operation?.status === 'failed'
    || operation?.status === 'recovery_required';
}

function shouldKeepTerminalVersionOperation(
  current: FileLibraryVersionOperation | null | undefined,
  next: FileLibraryVersionOperation | null | undefined,
) {
  return !!current
    && !!next
    && current.id === next.id
    && isVersionOperationTerminal(current)
    && isVersionOperationActive(next);
}

type FileLibraryVersionOperationLookup =
  | FileLibraryOperationProjection
  | FileLibraryVersionOperation
  | FileLibraryRestoreOperation;

function isOperationProjection(operation: FileLibraryVersionOperationLookup): operation is FileLibraryOperationProjection {
  return 'operation_id' in operation && 'operation_state' in operation;
}

function isRestoreOperation(operation: FileLibraryVersionOperationLookup): operation is FileLibraryRestoreOperation {
  return !('kind' in operation)
    && 'id' in operation
    && 'file_library_id' in operation
    && 'source_save_point_id' in operation
    && 'status' in operation;
}

export function restoreOperationToVersionOperation(
  operation: FileLibraryRestoreOperation,
): FileLibraryVersionOperation {
  return {
    id: operation.id,
    kind: 'restore',
    file_library_id: operation.file_library_id,
    source_save_point_id: operation.source_save_point_id,
    status: operation.status === 'pending'
      ? 'accepted'
      : operation.status === 'restoring'
        ? 'running'
        : operation.status,
    ...(operation.failure_reason ? { failure_reason: operation.failure_reason } : {}),
    created_at: operation.created_at,
    updated_at: operation.updated_at,
  };
}

function hasApiErrorCode(error: unknown, codes: string[], rawTokens: string[]): boolean {
  const rawValues = error instanceof APIError
    ? [error.errorCode, error.message]
    : error instanceof Error
      ? [error.message]
      : [];
  const normalizedCodes = new Set(codes.map((code) => code.trim().toLowerCase()));
  return rawValues.some((value) => {
    const normalized = value.trim().toLowerCase();
    return normalizedCodes.has(normalized)
      || rawTokens.some((token) => normalized === token || normalized.includes(token));
  });
}

export function isFileLibraryOperationPendingError(error: unknown): boolean {
  return hasApiErrorCode(
    error,
    [
      'FILE_LIBRARY_OPERATION_PENDING',
      'FILE_LIBRARY_SAVE_POINT_OPERATION_PENDING',
      'FILE_LIBRARY_RESTORE_OPERATION_PENDING',
    ],
    [
      'file_library_operation_pending',
      'file_library_restore_operation_pending',
      'file_library_save_point_operation_pending',
      'file_library_save_point_create_pending',
      'file_library_save_point_list_pending',
    ],
  );
}

function activeVersionOperationResponse(
  operation: FileLibraryVersionOperation | null,
): GetFileLibraryActiveOperationResponse {
  return { operation };
}

function setActiveVersionOperationQueryData(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: ReturnType<typeof queryKeys.fileLibraries.activeOperation>,
  operation: FileLibraryVersionOperation | null,
) {
  queryClient.setQueryData<GetFileLibraryActiveOperationResponse>(
    queryKey,
    (current) => {
      const currentOperation = normalizeActiveVersionOperation(current?.operation);
      if (shouldKeepTerminalVersionOperation(currentOperation, operation)) {
        return activeVersionOperationResponse(currentOperation);
      }
      return activeVersionOperationResponse(operation);
    },
  );
}

function normalizeActiveVersionOperation(
  operation: FileLibraryVersionOperationLookup | null | undefined,
): FileLibraryVersionOperationWithResult | null {
  if (!operation) return null;
  if (isOperationProjection(operation)) return null;
  return isRestoreOperation(operation) ? restoreOperationToVersionOperation(operation) : operation;
}

export function getVersionOperationResultSavePointId(
  operation: FileLibraryVersionOperation | null | undefined,
): string | null {
  const value = (operation as FileLibraryVersionOperationWithResult | null | undefined)?.result_save_point_id;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function fileObjectQueryMatches(
  queryKey: readonly unknown[],
  workspaceId: string,
  projectId: string,
  libraryId: string,
) {
  if (queryKey[0] !== 'file-objects') return false;
  if (queryKey[1] === 'infinite') {
    return queryKey[2] === workspaceId
      && queryKey[3] === projectId
      && queryKey[4] === libraryId;
  }
  return queryKey[1] === workspaceId
    && queryKey[2] === projectId
    && queryKey[3] === libraryId;
}

function invalidateFileObjectCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  projectId: string,
  libraryId: string,
) {
  return queryClient.invalidateQueries({
    predicate: (query) => fileObjectQueryMatches(
      query.queryKey,
      workspaceId,
      projectId,
      libraryId,
    ),
  });
}

async function invalidateRestoreRelatedCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  projectId: string,
  libraryId: string,
  options: { includeActiveOperation?: boolean } = { includeActiveOperation: true },
) {
  const invalidations = [
    invalidateFileObjectCaches(queryClient, workspaceId, projectId, libraryId),
    queryClient.invalidateQueries({
      queryKey: queryKeys.fileLibraries.savePoints(workspaceId, projectId, libraryId),
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.fileLibraries.list(workspaceId, projectId),
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.fileLibraries.detail(workspaceId, projectId, libraryId),
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.taskFileTemplates.list(workspaceId, projectId),
    }),
  ];
  if (options.includeActiveOperation ?? true) {
    invalidations.push(queryClient.invalidateQueries({
      queryKey: queryKeys.fileLibraries.activeOperation(workspaceId, projectId, libraryId),
    }));
  }
  await Promise.all(invalidations);
}

export function useFileLibrarySavePoints(
  workspaceId: string,
  projectId: string,
  libraryId: string | null | undefined,
  options?: { enabled?: boolean },
) {
  const filesAPI = new FilesAPI(getApiClient());
  const safeLibraryId = libraryId ?? '';

  return useQuery({
    queryKey: queryKeys.fileLibraries.savePoints(workspaceId, projectId, safeLibraryId),
    queryFn: () => filesAPI.listSavePoints(workspaceId, projectId, safeLibraryId),
    enabled: (options?.enabled ?? true) && !!workspaceId && !!projectId && !!safeLibraryId,
    refetchInterval: (query) => (
      isFileLibraryOperationPendingError(query.state.error)
        ? SAVE_POINTS_OPERATION_PENDING_REFETCH_INTERVAL_MS
        : false
    ),
    refetchIntervalInBackground: true,
    retry: (failureCount, error) => (
      isFileLibraryOperationPendingError(error) ? false : failureCount < 1
    ),
    staleTime: 10_000,
  });
}

export function useFileLibraryActiveVersionOperation(
  workspaceId: string,
  projectId: string,
  libraryId: string | null | undefined,
  options?: { enabled?: boolean },
) {
  const queryClient = useQueryClient();
  const filesAPI = new FilesAPI(getApiClient());
  const safeLibraryId = libraryId ?? '';
  const lastActiveOperationRef = React.useRef<{
    workspaceId: string;
    projectId: string;
    libraryId: string;
    operation: FileLibraryVersionOperation;
  } | null>(null);
  const operationLookupInFlightRef = React.useRef<string | null>(null);
  const activeOperationKey = React.useMemo(
    () => queryKeys.fileLibraries.activeOperation(workspaceId, projectId, safeLibraryId),
    [projectId, safeLibraryId, workspaceId],
  );
  const query = useQuery({
    queryKey: activeOperationKey,
    queryFn: async () => {
      const response = await filesAPI.getActiveFileLibraryOperation(workspaceId, projectId, safeLibraryId);
      const nextOperation = normalizeActiveVersionOperation(response.operation);
      const currentOperation = normalizeActiveVersionOperation(
        queryClient.getQueryData<GetFileLibraryActiveOperationResponse>(activeOperationKey)?.operation,
      );
      if (shouldKeepTerminalVersionOperation(currentOperation, nextOperation)) {
        return activeVersionOperationResponse(currentOperation);
      }
      return response;
    },
    enabled: (options?.enabled ?? true) && !!workspaceId && !!projectId && !!safeLibraryId,
    refetchInterval: (activeQuery) => (
      isVersionOperationActive(normalizeActiveVersionOperation(activeQuery.state.data?.operation))
        ? ACTIVE_FILE_LIBRARY_OPERATION_REFETCH_INTERVAL_MS
        : false
    ),
    staleTime: 0,
  });

  const operation = normalizeActiveVersionOperation(query.data?.operation);
  React.useEffect(() => {
    if (!safeLibraryId || query.isLoading) return;
    if (isVersionOperationActive(operation)) {
      lastActiveOperationRef.current = operation
        ? { workspaceId, projectId, libraryId: safeLibraryId, operation }
        : null;
      return;
    }
    if (isVersionOperationTerminal(operation)) {
      lastActiveOperationRef.current = null;
      void invalidateRestoreRelatedCaches(queryClient, workspaceId, projectId, safeLibraryId, {
        includeActiveOperation: false,
      });
      return;
    }
    const lastActive = lastActiveOperationRef.current;
    if (
      !operation
      && lastActive
      && lastActive.workspaceId === workspaceId
      && lastActive.projectId === projectId
      && lastActive.libraryId === safeLibraryId
    ) {
      const operationId = lastActive.operation.id;
      void invalidateRestoreRelatedCaches(queryClient, workspaceId, projectId, safeLibraryId, {
        includeActiveOperation: false,
      });
      if (operationLookupInFlightRef.current !== operationId) {
        operationLookupInFlightRef.current = operationId;
        const operationLookupApi = new FilesAPI(getApiClient());
        void operationLookupApi.getFileLibraryVersionOperation(
          workspaceId,
          projectId,
          operationId,
        )
          .then((resolvedOperation) => {
            const normalizedResolvedOperation = normalizeActiveVersionOperation(resolvedOperation);
            operationLookupInFlightRef.current = null;
            const currentLastActive = lastActiveOperationRef.current;
            if (
              currentLastActive?.operation.id !== operationId
              || currentLastActive.workspaceId !== workspaceId
              || currentLastActive.projectId !== projectId
              || currentLastActive.libraryId !== safeLibraryId
            ) {
              return;
            }
            if (
              normalizedResolvedOperation?.file_library_id
              && normalizedResolvedOperation.file_library_id !== safeLibraryId
            ) {
              lastActiveOperationRef.current = null;
              return;
            }
            setActiveVersionOperationQueryData(
              queryClient,
              activeOperationKey,
              normalizedResolvedOperation,
            );
            if (isVersionOperationActive(normalizedResolvedOperation)) {
              lastActiveOperationRef.current = {
                workspaceId,
                projectId,
                libraryId: safeLibraryId,
                operation: normalizedResolvedOperation,
              };
              return;
            }
            lastActiveOperationRef.current = null;
            if (isVersionOperationTerminal(normalizedResolvedOperation)) {
              void invalidateRestoreRelatedCaches(queryClient, workspaceId, projectId, safeLibraryId, {
                includeActiveOperation: false,
              });
            }
          })
          .catch(() => {
            operationLookupInFlightRef.current = null;
            lastActiveOperationRef.current = null;
            void invalidateRestoreRelatedCaches(queryClient, workspaceId, projectId, safeLibraryId, {
              includeActiveOperation: false,
            });
          });
      }
      return;
    }
    if (!operation) {
      lastActiveOperationRef.current = null;
    }
  }, [
    activeOperationKey,
    operation,
    operation?.id,
    operation?.status,
    projectId,
    query.isLoading,
    queryClient,
    safeLibraryId,
    workspaceId,
  ]);

  return query;
}

export function useFileLibraryVersionOperationLookup(
  workspaceId: string,
  projectId: string,
  libraryId: string | null | undefined,
  operationId: string | null | undefined,
  options?: { enabled?: boolean },
) {
  const queryClient = useQueryClient();
  const filesAPI = new FilesAPI(getApiClient());
  const safeLibraryId = libraryId ?? '';
  const safeOperationId = operationId ?? '';
  const terminalHandledRef = React.useRef<string | null>(null);
  const versionOperationKey = React.useMemo(
    () => [
      'file-library-version-operation',
      workspaceId,
      projectId,
      safeOperationId,
    ] as const,
    [projectId, safeOperationId, workspaceId],
  );
  const query = useQuery<FileLibraryVersionOperationWithResult | null>({
    queryKey: versionOperationKey,
    queryFn: async () => {
      const nextOperation = normalizeActiveVersionOperation(
        await filesAPI.getFileLibraryVersionOperation(workspaceId, projectId, safeOperationId),
      );
      const currentOperation = queryClient.getQueryData<FileLibraryVersionOperationWithResult | null>(
        versionOperationKey,
      );
      if (shouldKeepTerminalVersionOperation(currentOperation, nextOperation)) {
        return currentOperation;
      }
      return nextOperation;
    },
    enabled: (options?.enabled ?? true)
      && !!workspaceId
      && !!projectId
      && !!safeLibraryId
      && !!safeOperationId,
    refetchInterval: (operationQuery) => (
      isVersionOperationActive(operationQuery.state.data)
        ? FILE_LIBRARY_VERSION_OPERATION_LOOKUP_REFETCH_INTERVAL_MS
        : false
    ),
    refetchIntervalInBackground: true,
    staleTime: 0,
  });

  React.useEffect(() => {
    const operation = query.data;
    if (!operation || !isVersionOperationTerminal(operation) || !safeLibraryId) return;
    const resultSavePointId = getVersionOperationResultSavePointId(operation);
    const terminalKey = [
      workspaceId,
      projectId,
      safeLibraryId,
      operation.id,
      operation.status,
      operation.updated_at,
      resultSavePointId ?? '',
    ].join(':');
    if (terminalHandledRef.current === terminalKey) return;
    terminalHandledRef.current = terminalKey;
    if (operation.file_library_id && operation.file_library_id !== safeLibraryId) return;

    const activeOperationKey = queryKeys.fileLibraries.activeOperation(workspaceId, projectId, safeLibraryId);
    setActiveVersionOperationQueryData(queryClient, activeOperationKey, operation);
    const invalidations = [
      queryClient.invalidateQueries({
        queryKey: activeOperationKey,
      }),
    ];
    if (
      operation.kind === 'restore'
      || operation.status === 'failed'
      || operation.status === 'recovery_required'
    ) {
      invalidations.push(queryClient.invalidateQueries({
        queryKey: queryKeys.fileLibraries.detail(workspaceId, projectId, safeLibraryId),
      }));
    }
    if (operation.kind === 'restore') {
      void invalidateRestoreRelatedCaches(queryClient, workspaceId, projectId, safeLibraryId);
      return;
    }
    if (operation.status === 'succeeded' && resultSavePointId) {
      invalidations.push(
        queryClient.invalidateQueries({
          queryKey: queryKeys.fileLibraries.savePoints(workspaceId, projectId, safeLibraryId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.fileLibraries.detail(workspaceId, projectId, safeLibraryId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.fileLibraries.list(workspaceId, projectId),
        }),
      );
    }
    void Promise.all(invalidations);
  }, [
    projectId,
    query.data,
    queryClient,
    safeLibraryId,
    workspaceId,
  ]);

  return query;
}

export function useCreateFileLibrarySavePoint(options: FileLibraryRecoveryMutationOptions = {}) {
  const queryClient = useQueryClient();
  const filesAPI = new FilesAPI(getApiClient());
  const t = useTranslations('common.toast');
  const idempotencyKeysRef = React.useRef(new WeakMap<CreateFileLibrarySavePointVariables, string>());

  function resolveIdempotencyKey(variables: CreateFileLibrarySavePointVariables) {
    if (variables.idempotencyKey) {
      idempotencyKeysRef.current.set(variables, variables.idempotencyKey);
      return variables.idempotencyKey;
    }
    const existing = idempotencyKeysRef.current.get(variables);
    if (existing) return existing;
    const next = generateSavePointIdempotencyKey();
    idempotencyKeysRef.current.set(variables, next);
    return next;
  }

  return useMutation({
    mutationFn: (variables: CreateFileLibrarySavePointVariables) => filesAPI.createSavePoint(
      variables.workspaceId,
      variables.projectId,
      variables.libraryId,
      { message: variables.message },
      { idempotencyKey: resolveIdempotencyKey(variables) },
    ),
    onSuccess: async (operation, variables) => {
      const savePointsKey = queryKeys.fileLibraries.savePoints(
        variables.workspaceId,
        variables.projectId,
        variables.libraryId,
      );
      const activeOperationKey = queryKeys.fileLibraries.activeOperation(
        variables.workspaceId,
        variables.projectId,
        variables.libraryId,
      );
      setActiveVersionOperationQueryData(
        queryClient,
        activeOperationKey,
        operation,
      );
      void queryClient.invalidateQueries({
        queryKey: activeOperationKey,
      });
      void queryClient.invalidateQueries({
        queryKey: savePointsKey,
      });
      if (operation.status === 'succeeded') {
        toast.success(t('create_success'));
      }
    },
    onError: async (error: unknown, variables) => {
      if (isFileLibraryOperationPendingError(error)) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.fileLibraries.savePoints(
            variables.workspaceId,
            variables.projectId,
            variables.libraryId,
          ),
        });
      }
      if (options.suppressErrorToast) return;
      handleErrorForToast(error, 'useCreateFileLibrarySavePoint');
    },
  });
}

export function useRestoreFileLibrary(options: FileLibraryRecoveryMutationOptions = {}) {
  const queryClient = useQueryClient();
  const filesAPI = new FilesAPI(getApiClient());
  const t = useTranslations('common.toast');

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      libraryId,
      savePointId,
      idempotencyKey,
    }: {
      workspaceId: string;
      projectId: string;
      libraryId: string;
      savePointId: string;
      idempotencyKey: string;
    }) => filesAPI.restoreFileLibrary(
      workspaceId,
      projectId,
      libraryId,
      {
        save_point_id: savePointId,
      },
      { idempotencyKey },
    ),
    onSuccess: async (operation, variables) => {
      const activeOperationKey = queryKeys.fileLibraries.activeOperation(
        variables.workspaceId,
        variables.projectId,
        variables.libraryId,
      );
      setActiveVersionOperationQueryData(
        queryClient,
        activeOperationKey,
        restoreOperationToVersionOperation(operation),
      );
      void invalidateRestoreRelatedCaches(
        queryClient,
        variables.workspaceId,
        variables.projectId,
        variables.libraryId,
      );
      if (operation.status === 'succeeded') {
        toast.success(t('update_success'));
      }
    },
    onError: (error: unknown) => {
      if (options.suppressErrorToast) return;
      handleErrorForToast(error, 'useRestoreFileLibrary');
    },
  });
}

export function useReleaseFileLibraryRuntimeAccess(options: FileLibraryRecoveryMutationOptions = {}) {
  const queryClient = useQueryClient();
  const filesAPI = new FilesAPI(getApiClient());

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      libraryId,
    }: {
      workspaceId: string;
      projectId: string;
      libraryId: string;
    }) => filesAPI.releaseRuntimeAccess(workspaceId, projectId, libraryId),
    onSuccess: async (_release, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.fileLibraries.activeOperation(
            variables.workspaceId,
            variables.projectId,
            variables.libraryId,
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.fileLibraries.savePoints(
            variables.workspaceId,
            variables.projectId,
            variables.libraryId,
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.fileLibraries.list(
            variables.workspaceId,
            variables.projectId,
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.fileLibraries.detail(
            variables.workspaceId,
            variables.projectId,
            variables.libraryId,
          ),
        }),
        invalidateFileObjectCaches(
          queryClient,
          variables.workspaceId,
          variables.projectId,
          variables.libraryId,
        ),
        queryClient.invalidateQueries({
          queryKey: queryKeys.tasks.scope(variables.workspaceId, variables.projectId),
        }),
      ]);
    },
    onError: (error: unknown) => {
      if (options.suppressErrorToast) return;
      handleErrorForToast(error, 'useReleaseFileLibraryRuntimeAccess');
    },
  });
}
