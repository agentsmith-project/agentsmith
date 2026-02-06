/**
 * Confirmation Dialog Primitive
 *
 * Reusable confirmation dialog for destructive actions with:
 * - Loading states during async operation
 * - Error handling with toast notification
 * - Controlled and uncontrolled modes
 * - Destructive variant styling
 * - i18n support
 *
 * @example
 * ```tsx
 * // Uncontrolled with trigger
 * <ConfirmationDialog
 *   title={t('delete_confirm_title')}
 *   description={t('delete_confirm_message', { name })}
 *   confirmText={t('delete')}
 *   onConfirm={handleDelete}
 *   trigger={<Button variant="destructive">Delete</Button>}
 * />
 *
 * // Controlled mode
 * <ConfirmationDialog
 *   open={showDialog}
 *   onOpenChange={setShowDialog}
 *   title="Are you sure?"
 *   description="This action cannot be undone."
 *   confirmText="Delete"
 *   onConfirm={handleDelete}
 * />
 * ```
 */

'use client';

import * as React from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { handleErrorForToast } from '@/lib/api/errors';

export interface ConfirmationDialogProps {
  /** Dialog title */
  title: React.ReactNode;
  /** Dialog description (optional) */
  description?: React.ReactNode;
  /** Text for confirm button (default: "Confirm") */
  confirmText?: string;
  /** Text for cancel button (default: "Cancel") */
  cancelText?: string;
  /** Whether this is a destructive action (default: true) */
  variant?: 'destructive' | 'default';
  /** Async confirm handler */
  onConfirm: () => Promise<void> | void;
  /** Success callback after confirm succeeds */
  onSuccess?: () => void;
  /** Element that triggers the dialog (uncontrolled mode) */
  trigger?: React.ReactNode;
  /** Whether dialog is open (controlled mode) */
  open?: boolean;
  /** Callback when dialog open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Optional context string for error messages */
  errorContext?: string;
  /** Disable confirm button */
  confirmDisabled?: boolean;
  /** Optional test ID for e2e testing */
  testId?: string;
}

export function ConfirmationDialog({
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'destructive',
  onConfirm,
  onSuccess,
  trigger,
  open: controlledOpen,
  onOpenChange,
  errorContext,
  confirmDisabled = false,
  testId,
}: ConfirmationDialogProps) {
  // Support both controlled and uncontrolled modes
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = onOpenChange || setInternalOpen;

  const [isConfirming, setIsConfirming] = React.useState(false);

  const handleConfirm = async () => {
    setIsConfirming(true);
    try {
      await onConfirm();
      setOpen(false);
      onSuccess?.();
    } catch (error) {
      handleErrorForToast(error, errorContext);
    } finally {
      setIsConfirming(false);
    }
  };

  // Prevent closing if currently confirming
  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen || !isConfirming) {
      setOpen(newOpen);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      <AlertDialogContent data-testid={testId}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={isConfirming}
            data-testid={testId ? `${testId}__cancel-btn` : undefined}
          >
            {cancelText}
          </Button>
          <Button
            variant={variant === 'destructive' ? 'destructive' : 'action'}
            onClick={handleConfirm}
            disabled={isConfirming || confirmDisabled}
            data-testid={testId ? `${testId}__confirm-btn` : undefined}
          >
            {isConfirming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmText}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
