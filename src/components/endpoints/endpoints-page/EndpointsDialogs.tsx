'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import type { Endpoint } from '@/lib/api/types';

import { CreateEndpointDialog } from '../CreateEndpointDialog';
import { EditEndpointDialog } from '../EditEndpointDialog';

interface EndpointsDialogsProps {
  canManageEndpoints: boolean;
  createDialogOpen: boolean;
  deleteConfirmOpen: boolean;
  editDialogOpen: boolean;
  endpointToDelete: Endpoint | null;
  importDialogOpen: boolean;
  importBulkPending: boolean;
  importPayloadText: string;
  projectId: string;
  selectedEndpoint: Endpoint | null;
  t: (key: string, values?: Record<string, string>) => string;
  workspaceId: string;
  onConfirmDelete: () => void;
  onCreateDialogOpenChange: (open: boolean) => void;
  onEditDialogOpenChange: (open: boolean) => void;
  onImport: () => void;
  onImportDialogOpenChange: (open: boolean) => void;
  onImportPayloadTextChange: (value: string) => void;
  onInvalidateEndpoints: () => void;
  onResetDeleteTarget: () => void;
}

export function EndpointsDialogs({
  canManageEndpoints,
  createDialogOpen,
  deleteConfirmOpen,
  editDialogOpen,
  endpointToDelete,
  importDialogOpen,
  importBulkPending,
  importPayloadText,
  projectId,
  selectedEndpoint,
  t,
  workspaceId,
  onConfirmDelete,
  onCreateDialogOpenChange,
  onEditDialogOpenChange,
  onImport,
  onImportDialogOpenChange,
  onImportPayloadTextChange,
  onInvalidateEndpoints,
  onResetDeleteTarget,
}: EndpointsDialogsProps) {
  return (
    <>
      <CreateEndpointDialog
        open={canManageEndpoints && createDialogOpen}
        onOpenChange={onCreateDialogOpenChange}
        workspaceId={workspaceId}
        projectId={projectId}
        onSuccess={onInvalidateEndpoints}
      />

      {selectedEndpoint ? (
        <EditEndpointDialog
          open={editDialogOpen}
          onOpenChange={onEditDialogOpenChange}
          workspaceId={workspaceId}
          projectId={projectId}
          endpoint={selectedEndpoint}
          onSuccess={() => {
            onInvalidateEndpoints();
            onEditDialogOpenChange(false);
          }}
        />
      ) : null}

      <AlertDialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          if (!open) onResetDeleteTarget();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('delete_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('delete_confirm_description', { name: endpointToDelete?.name || '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('delete_confirm_cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                onConfirmDelete();
              }}
              className="bg-error text-white hover:bg-error/90"
            >
              {t('delete_confirm_action')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={importDialogOpen} onOpenChange={onImportDialogOpenChange}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('import_dialog_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('import_dialog_description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <textarea
            value={importPayloadText}
            onChange={(event) => onImportPayloadTextChange(event.target.value)}
            rows={16}
            className="w-full rounded-sm border border-subtle bg-surface-high px-3 py-2 text-sm font-mono text-primary"
            data-testid="endpoints__import-textarea"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{t('import_cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                onImport();
              }}
              disabled={importBulkPending}
              data-testid="endpoints__import-confirm"
            >
              {t('import_confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
