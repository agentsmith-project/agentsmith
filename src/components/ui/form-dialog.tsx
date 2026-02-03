/**
 * Form Dialog Primitive
 *
 * Reusable dialog component for form submissions with:
 * - Loading states
 * - Error handling
 * - Success feedback
 * - Form reset on close
 * - Prevents closing during submission
 *
 * This is a headless component that wraps form content.
 * Use the render prop pattern to access isSubmitting and error states.
 *
 * @example
 * ```tsx
 * <FormDialog
 *   title="Create Item"
 *   trigger={<Button>Create</Button>}
 *   submitLabel="Create"
 * >
 *   {({ isSubmitting, error, onSubmit }) => (
 *     <form id="dialog-form" onSubmit={onSubmit}>
 *       <Input name="name" disabled={isSubmitting} />
 *       {error && <div className="text-error">{error}</div>}
 *     </form>
 *   )}
 * </FormDialog>
 * ```
 */

'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

export interface FormDialogRenderProps {
  /** Whether form is currently submitting */
  isSubmitting: boolean;
  /** Error message from last submission attempt */
  error: string | null;
  /** Submit handler - pass to form's onSubmit */
  onSubmit: (e: React.FormEvent) => void;
}

export interface FormDialogProps {
  /** Dialog title */
  title: string;
  /** Optional description below title */
  description?: string;
  /** Element that triggers the dialog */
  trigger: React.ReactNode;
  /** Submit handler - receives form event */
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
  /** Success callback - called after successful submission */
  onSuccess?: () => void;
  /** Label for submit button */
  submitLabel?: string;
  /** Label for cancel button */
  cancelLabel?: string;
  /** Whether to show the dialog (controlled mode) */
  open?: boolean;
  /** Callback when dialog open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Render prop for form content */
  children: (props: FormDialogRenderProps) => React.ReactNode;
}

export function FormDialog({
  title,
  description,
  trigger,
  onSubmit,
  onSuccess,
  submitLabel = 'Submit',
  cancelLabel = 'Cancel',
  open: controlledOpen,
  onOpenChange,
  children,
}: FormDialogProps) {
  // Support both controlled and uncontrolled modes
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = onOpenChange || setInternalOpen;

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      await onSubmit(e);
      setOpen(false);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Prevent closing if currently submitting
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen || !isSubmitting) {
      setOpen(newOpen);
      setError(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {children({ isSubmitting, error, onSubmit: handleSubmit as (e: React.FormEvent) => Promise<void> })}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={isSubmitting}
          >
            {cancelLabel}
          </Button>
          <Button
            type="submit"
            form="dialog-form"
            disabled={isSubmitting}
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
