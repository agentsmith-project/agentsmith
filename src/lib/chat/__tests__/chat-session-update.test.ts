import { describe, expect, it, vi } from 'vitest';
import type { ChatSession } from '@/lib/api/types';
import {
  applyChatSessionUpdate,
  type ChatSessionUpdateData,
  type PendingSessionUpdateOptions,
  chatSessionUpdateFields,
  mergeSessionWithPendingUpdate,
} from '@/lib/chat/chat-session-update';

interface DeferredPromise<T> {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
}

function createDeferredPromise<T>(): DeferredPromise<T> {
  let reject: DeferredPromise<T>['reject'] | null = null;
  const promise = new Promise<T>((_resolve, nextReject) => {
    reject = nextReject;
  });

  if (!reject) {
    throw new Error('Failed to capture deferred promise reject handler');
  }

  return { promise, reject };
}

describe('chat-session-update helpers', () => {
  it('rolls back pending model binding patch when update fails', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error('update failed'));
    const setPendingSessionUpdate = vi.fn();

    await expect(
      applyChatSessionUpdate({
        input: {
          sessionId: 'sess_1',
          data: {
            endpoint_id: 'ep_2',
            model: 'claude-3-7-sonnet',
          },
        },
        mutateAsync,
        setPendingSessionUpdate,
      }),
    ).rejects.toThrow('update failed');

    expect(setPendingSessionUpdate).toHaveBeenNthCalledWith(1, 'sess_1', {
      endpoint_id: 'ep_2',
      model: 'claude-3-7-sonnet',
    });
    expect(setPendingSessionUpdate).toHaveBeenNthCalledWith(2, 'sess_1', null, {
      onlyIfCurrentPatch: {
        endpoint_id: 'ep_2',
        model: 'claude-3-7-sonnet',
      },
    });
  });

  it('does not let an older failed model binding update clear a newer pending patch', async () => {
    let currentPendingPatch: Record<string, ChatSessionUpdateData | undefined> = {};
    const firstUpdate = createDeferredPromise<never>();
    const mutateAsync = vi.fn()
      .mockImplementationOnce(() => firstUpdate.promise)
      .mockResolvedValueOnce(undefined);
    const setPendingSessionUpdate = (
      sessionId: string,
      patch: ChatSessionUpdateData | null,
      options?: PendingSessionUpdateOptions,
    ) => {
      if (patch) {
        currentPendingPatch = {
          ...currentPendingPatch,
          [sessionId]: patch,
        };
        return;
      }

      if (
        options?.onlyIfCurrentPatch
        && currentPendingPatch[sessionId] !== options.onlyIfCurrentPatch
      ) {
        return;
      }

      const { [sessionId]: _removed, ...rest } = currentPendingPatch;
      currentPendingPatch = rest;
    };

    const firstRequest = applyChatSessionUpdate({
      input: {
        sessionId: 'sess_1',
        data: {
          endpoint_id: 'ep_old',
          model: 'model-old',
        },
      },
      mutateAsync,
      setPendingSessionUpdate,
    });

    await Promise.resolve();

    await applyChatSessionUpdate({
      input: {
        sessionId: 'sess_1',
        data: {
          endpoint_id: 'ep_new',
          model: 'model-new',
        },
      },
      mutateAsync,
      setPendingSessionUpdate,
    });

    firstUpdate.reject(new Error('old update failed'));

    await expect(firstRequest).rejects.toThrow('old update failed');
    expect(currentPendingPatch['sess_1']).toEqual({
      endpoint_id: 'ep_new',
      model: 'model-new',
    });
  });

  it('does not treat external_agent_id as a supported session update field', () => {
    expect(chatSessionUpdateFields).not.toContain('external_agent_id');
  });

  it('merges endpoint/model while a pending endpoint switch is in flight', () => {
    const session: ChatSession = {
      id: 'sess_1',
      project_id: 'proj_1',
      title: 'Session',
      model: 'gpt-4o',
      endpoint_id: 'ep_1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      message_count: 0,
      total_tokens: 0,
    };

    expect(
      mergeSessionWithPendingUpdate(session, {
        endpoint_id: 'ep_2',
        model: 'claude-3-7-sonnet',
      }),
    ).toMatchObject({
      endpoint_id: 'ep_2',
      model: 'claude-3-7-sonnet',
    });
  });
});
