import type { ChatSession } from '@/lib/api/types';

export const chatSessionUpdateFields = [
  'title',
  'model',
  'endpoint_id',
  'external_agent_id',
  'pinned',
  'starred',
] as const;

export type ChatSessionUpdateField = (typeof chatSessionUpdateFields)[number];
export type ChatSessionUpdateData = Partial<Pick<ChatSession, ChatSessionUpdateField>>;
export interface PendingSessionUpdateOptions {
  onlyIfCurrentPatch?: ChatSessionUpdateData;
}

type ChatSessionComparableTruth = Partial<Record<ChatSessionUpdateField, string | boolean | null | undefined>>;

function normalizeComparableValue(
  field: ChatSessionUpdateField,
  value: string | boolean | null | undefined,
): string | boolean | undefined {
  if (field === 'external_agent_id' && value == null) {
    return undefined;
  }

  return value ?? undefined;
}

export function mergeSessionWithPendingUpdate(
  session: ChatSession | null,
  patch: ChatSessionUpdateData | undefined,
): ChatSession | null {
  if (!session || !patch) return session;
  return { ...session, ...patch };
}

export function doesSessionMatchPatch(
  session: ChatSessionComparableTruth | null | undefined,
  patch: ChatSessionUpdateData,
): boolean {
  if (!session) return false;

  return chatSessionUpdateFields.every((field) => {
    if (!(field in patch)) return true;

    return normalizeComparableValue(field, session[field]) === normalizeComparableValue(field, patch[field]);
  });
}

export function isExecutionTargetUpdate(data: ChatSessionUpdateData): boolean {
  return (
    'endpoint_id' in data
    || 'external_agent_id' in data
    || 'model' in data
  );
}

export async function applyChatSessionUpdate(args: {
  input: {
    sessionId: string;
    data: ChatSessionUpdateData;
  };
  mutateAsync: (input: {
    sessionId: string;
    data: ChatSessionUpdateData;
  }) => Promise<unknown>;
  setPendingSessionUpdate: (
    sessionId: string,
    patch: ChatSessionUpdateData | null,
    options?: PendingSessionUpdateOptions,
  ) => void;
}): Promise<void> {
  const { input, mutateAsync, setPendingSessionUpdate } = args;
  const patch = { ...input.data };
  const trackPendingExecutionTarget = isExecutionTargetUpdate(patch);

  if (trackPendingExecutionTarget) {
    setPendingSessionUpdate(input.sessionId, patch);
  }

  try {
    await mutateAsync({
      sessionId: input.sessionId,
      data: patch,
    });
  } catch (error) {
    if (trackPendingExecutionTarget) {
      setPendingSessionUpdate(input.sessionId, null, {
        onlyIfCurrentPatch: patch,
      });
    }
    throw error;
  }
}

export function fireAndForgetSessionUpdate(
  updateSession: (input: { sessionId: string; data: ChatSessionUpdateData }) => Promise<void> | void,
  input: { sessionId: string; data: ChatSessionUpdateData },
  options?: {
    onError?: (error: unknown) => void;
  },
): void {
  try {
    void Promise.resolve(updateSession(input)).catch((error) => {
      options?.onError?.(error);
    });
  } catch (error) {
    options?.onError?.(error);
    // Preserve the pre-mutateAsync fire-and-forget behavior for UI actions.
  }
}
