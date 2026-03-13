'use client';

import type { MouseEvent } from 'react';

import { ChatDeleteDialog } from '@/components/chat/ChatDeleteDialog';
import { ChatLibraryPickerDialog } from '@/components/chat/ChatLibraryPickerDialog';
import type { FilesAPI } from '@/lib/api/endpoints/files';

import { AddUrlDialog } from './AddUrlDialog';

interface ChatDialogsProps {
  addLibraryAttachmentPending: boolean;
  addUrlOpen: boolean;
  addUrlPending: boolean;
  deleteThreadDialogOpen: boolean;
  localeLabels: {
    confirm: string;
    message: string;
    cancel: string;
    title: string;
  };
  libraryPickerOpen: boolean;
  onConfirmDeleteThread: (event: MouseEvent<HTMLButtonElement>) => Promise<void>;
  onLibraryPickerOpenChange: (open: boolean) => void;
  onOpenAddUrlChange: (open: boolean) => void;
  onOpenDeleteThreadChange: (open: boolean) => void;
  onPickLibraryObject: (input: {
    libraryId: string;
    key: string;
    name: string;
    contentType?: string;
  }) => void;
  onSubmitUrl: () => void;
  onUrlInputChange: (value: string) => void;
  projectId: string;
  sourcesAPI: FilesAPI;
  t: (key: string) => string;
  urlInput: string;
  workspaceId: string;
}

export function ChatDialogs({
  addLibraryAttachmentPending,
  addUrlOpen,
  addUrlPending,
  deleteThreadDialogOpen,
  libraryPickerOpen,
  localeLabels,
  onConfirmDeleteThread,
  onLibraryPickerOpenChange,
  onOpenAddUrlChange,
  onOpenDeleteThreadChange,
  onPickLibraryObject,
  onSubmitUrl,
  onUrlInputChange,
  projectId,
  sourcesAPI,
  t,
  urlInput,
  workspaceId,
}: ChatDialogsProps) {
  return (
    <>
      <ChatDeleteDialog
        open={deleteThreadDialogOpen}
        onOpenChange={onOpenDeleteThreadChange}
        onConfirm={onConfirmDeleteThread}
        labels={localeLabels}
      />
      <ChatLibraryPickerDialog
        open={libraryPickerOpen}
        onOpenChange={onLibraryPickerOpenChange}
        workspaceId={workspaceId}
        projectId={projectId}
        sourcesAPI={sourcesAPI}
        loading={addLibraryAttachmentPending}
        onPickObject={onPickLibraryObject}
      />
      <AddUrlDialog
        isPending={addUrlPending}
        open={addUrlOpen}
        t={t}
        urlInput={urlInput}
        onConfirm={onSubmitUrl}
        onOpenChange={onOpenAddUrlChange}
        onUrlInputChange={onUrlInputChange}
      />
    </>
  );
}
