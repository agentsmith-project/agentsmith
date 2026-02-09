import { useCallback, useState, type MouseEvent } from 'react';

export interface ThreadToDelete {
  id: string;
  title?: string;
}

interface UseChatDeleteDialogArgs {
  deleteSession: (sessionId: string) => void;
  stopStreamingSession: (sessionId: string, reason?: 'user' | 'replace') => Promise<boolean>;
}

interface UseChatDeleteDialogResult {
  deleteThreadDialogOpen: boolean;
  setDeleteThreadDialogOpen: (open: boolean) => void;
  threadToDelete: ThreadToDelete | null;
  setThreadToDelete: (thread: ThreadToDelete | null) => void;
  handleConfirmDeleteThread: (e: MouseEvent<HTMLButtonElement>) => Promise<void>;
}

export function useChatDeleteDialog(args: UseChatDeleteDialogArgs): UseChatDeleteDialogResult {
  const { deleteSession, stopStreamingSession } = args;

  const [deleteThreadDialogOpen, setDeleteThreadDialogOpen] = useState(false);
  const [threadToDelete, setThreadToDelete] = useState<ThreadToDelete | null>(null);

  const handleConfirmDeleteThread = useCallback(async (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (!threadToDelete) return;
    const stopped = await stopStreamingSession(threadToDelete.id, 'replace');
    if (!stopped) return;
    deleteSession(threadToDelete.id);
    setDeleteThreadDialogOpen(false);
    setThreadToDelete(null);
  }, [deleteSession, stopStreamingSession, threadToDelete]);

  return {
    deleteThreadDialogOpen,
    setDeleteThreadDialogOpen,
    threadToDelete,
    setThreadToDelete,
    handleConfirmDeleteThread,
  };
}
