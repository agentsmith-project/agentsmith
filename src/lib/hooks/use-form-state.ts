/**
 * useFormState Hook
 *
 * Provides common form state management patterns for dialog forms.
 * Designed to work with React Query's useMutation.
 *
 * @example
 * ```tsx
 * const mutation = useMutation({ mutationFn: async (data) => api.create(data) });
 *
 * const formState = useFormState({
 *   initialValues: { name: '', description: '' },
 *   isPending: mutation.isPending,
 *   validate: (values) => values.name.trim().length > 0,
 *   onSubmit: (values) => mutation.mutate(values),
 *   onSuccess: () => { onClose(); onSuccess?.(); },
 *   onError: (error) => handleErrorForToast(error),
 * });
 *
 * return (
 *   <Dialog open={open} onOpenChange={formState.handleOpenChange}>
 *     <form onSubmit={formState.handleSubmit}>
 *       <Input {...formState.register('name')} />
 *       <Button type="submit" disabled={!formState.canSubmit}>Submit</Button>
 *     </form>
 *   </Dialog>
 * );
 * ```
 */

'use client';

import * as React from 'react';

export interface FormStateOptions<TValues> {
  /** Initial form values */
  initialValues: TValues;
  /** Whether mutation is pending */
  isPending?: boolean;
  /** Validation function - return true if valid */
  validate?: (values: TValues) => boolean;
  /** Submit handler */
  onSubmit: (values: TValues) => void;
  /** Success callback - called after successful submission */
  onSuccess?: () => void;
  /** Error callback - defaults to handleErrorForToast */
  onError?: (error: unknown) => void;
  /** Context for error messages */
  errorContext?: string;
  /** Reset values on open (default: true) */
  resetOnOpen?: boolean;
  /** Auto-focus on mount (selector or true for first input) */
  autoFocus?: string | boolean;
}

export interface FormStateReturn<TValues extends Record<string, unknown>> {
  /** Current form values */
  values: TValues;
  /** Update a single field value */
  setField: <K extends keyof TValues>(key: K, value: TValues[K]) => void;
  /** Update multiple field values */
  setFields: (updates: Partial<TValues>) => void;
  /** Register input props for a field */
  register: <K extends keyof TValues>(key: K) => {
    value: TValues[K];
    onChange: (value: TValues[K]) => void;
    disabled: boolean;
  };
  /** Whether form can be submitted */
  canSubmit: boolean;
  /** Reset form to initial values */
  reset: () => void;
  /** Submit handler */
  handleSubmit: (e?: React.FormEvent) => void;
  /** Handle dialog open change (prevents closing when pending) */
  handleOpenChange: (open: boolean) => void;
  /** Bind to Dialog component */
  dialogProps: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  };
}

/**
 * Hook for managing form state in dialogs
 *
 * Supports two modes:
 * - **Controlled**: Pass `open` and `onOpenChange` to integrate with parent dialog state.
 *   Returns `dialogProps` and `handleOpenChange`.
 * - **Uncontrolled**: Omit `open`/`onOpenChange` to let the hook manage its own open state.
 *   Returns `open`, `setOpen`, and `handleOpenChange`.
 *
 * @param options - Form state options
 * @returns Form state object with methods and computed values
 */
export function useFormState<TValues extends Record<string, unknown>>(
  options: FormStateOptions<TValues> & { open?: boolean; onOpenChange?: (open: boolean) => void }
) {
  const {
    initialValues,
    isPending = false,
    validate,
    onSubmit,
    onSuccess: _onSuccess,
    onError: _onError,
    errorContext: _errorContext,
    resetOnOpen = true,
    autoFocus,
    open: controlledOpen,
    onOpenChange: controlledOnOpenChange,
  } = options;

  // Internal state for uncontrolled mode
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const onOpenChange = controlledOnOpenChange || setInternalOpen;

  const [values, setValues] = React.useState<TValues>(initialValues);

  // Stable key for deep comparison of initialValues
  const initialValuesKey = React.useMemo(
    () => JSON.stringify(initialValues),
    [initialValues]
  );

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open && resetOnOpen) {
      setValues(initialValues);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resetOnOpen, initialValuesKey]);

  // Handle auto-focus
  const autoFocusRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (open && autoFocus) {
      setTimeout(() => {
        if (autoFocus === true && autoFocusRef.current) {
          autoFocusRef.current.focus();
        } else if (typeof autoFocus === 'string') {
          const el = document.querySelector(`[name="${autoFocus}"]`) as HTMLInputElement;
          el?.focus();
        }
      }, 50);
    }
  }, [open, autoFocus]);

  const setField = <K extends keyof TValues>(key: K, value: TValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const setFields = (updates: Partial<TValues>) => {
    setValues((prev) => ({ ...prev, ...updates }));
  };

  const register = <K extends keyof TValues>(key: K) => ({
    value: values[key],
    onChange: (value: TValues[K]) => setField(key, value),
    disabled: isPending,
  });

  const canSubmit = validate ? validate(values) && !isPending : !isPending;

  const reset = () => {
    setValues(initialValues);
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (canSubmit) {
      onSubmit(values);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen || !isPending) {
      onOpenChange(nextOpen);
    }
  };

  const baseReturn = {
    values,
    setField,
    setFields,
    register,
    canSubmit,
    reset,
    handleSubmit,
    autoFocusRef,
  };

  if (controlledOpen !== undefined && controlledOnOpenChange) {
    // Controlled mode
    return {
      ...baseReturn,
      handleOpenChange,
      dialogProps: {
        open,
        onOpenChange: handleOpenChange,
      },
    };
  }

  // Uncontrolled mode
  return {
    ...baseReturn,
    open,
    setOpen: onOpenChange as React.Dispatch<React.SetStateAction<boolean>>,
    handleOpenChange,
  };
}
