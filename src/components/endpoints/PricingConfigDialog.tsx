'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { useRuntimePricing, usePatchRuntimePricing } from '@/lib/hooks/use-runtime';
import { toast } from '@/components/ui/toast';
import {
  type PricingField,
  PRICING_FIELDS,
  formatPricingValue,
  parsePricingInput,
  getProviders,
  getModelsForProvider,
  getModelPricing,
  updateModelPricing,
  isEmptyPricingMap,
  clonePricingMap,
  getPricingFieldLabel,
  type RuntimePricingMap,
} from '@/lib/endpoints/pricing-utils';
import { cn } from '@/lib/utils';

export interface PricingConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  onSuccess?: () => void;
}

export function PricingConfigDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
  onSuccess,
}: PricingConfigDialogProps) {
  const t = useTranslations('pricing');
  const tCommon = useTranslations('common');

  const { data: pricingData, isLoading, error } = useRuntimePricing(workspaceId, projectId);
  const patchPricing = usePatchRuntimePricing(workspaceId, projectId);

  // Local state for edited pricing
  const [localPricing, setLocalPricing] = useState<RuntimePricingMap>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [changedFields, setChangedFields] = useState<Set<string>>(new Set());

  // Saving state - must be declared before useEffects that reference it
  const isSaving = patchPricing.isPending;

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open && pricingData) {
      setLocalPricing(clonePricingMap(pricingData));
      setHasChanges(false);
      setChangedFields(new Set());
    }
  }, [open, pricingData]);

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Enter or Cmd+Enter to save
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (hasChanges && !isSaving) {
          handleSaveRef.current?.();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, hasChanges, isSaving]);

  // Handle pricing value change
  const handlePricingChange = useCallback(
    (provider: string, model: string, field: PricingField, value: string) => {
      const parsed = parsePricingInput(value);
      if (parsed === null) return; // Skip invalid values

      const fieldKey = `${provider}-${model}-${field}`;
      const originalValue = pricingData?.[provider]?.[model]?.[field];

      // Track if value actually changed from original
      const isNewValue = originalValue === undefined || parsed !== originalValue;

      const newPricing = updateModelPricing(localPricing, provider, model, field, parsed);
      setLocalPricing(newPricing);

      setChangedFields((prev) => {
        const updated = new Set(prev);
        if (isNewValue) {
          updated.add(fieldKey);
        } else {
          updated.delete(fieldKey);
        }
        return updated;
      });

      setHasChanges(true);
    },
    [localPricing, pricingData]
  );

  // Handle save
  const handleSave = useCallback(async () => {
    if (!hasChanges) {
      onOpenChange(false);
      return;
    }

    try {
      await patchPricing.mutateAsync(localPricing);
      toast.success(t('success_saved'));
      onOpenChange(false);
      onSuccess?.();
      setHasChanges(false);
      setChangedFields(new Set());
    } catch {
      toast.error(t('error_save_failed'));
    }
  }, [hasChanges, localPricing, patchPricing, onOpenChange, onSuccess, t]);

  // Ref for keyboard shortcut to access latest handleSave
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  // Handle reset
  const handleReset = useCallback(async () => {
    if (!window.confirm(t('reset_confirm'))) return;

    try {
      // Reset to original pricing data
      if (pricingData) {
        setLocalPricing(clonePricingMap(pricingData));
        setHasChanges(false);
        setChangedFields(new Set());
        toast.success(t('success_reset'));
      }
    } catch {
      toast.error(t('error_reset_failed'));
    }
  }, [pricingData, t]);

  // Handle cancel/close
  const handleClose = useCallback(() => {
    if (!patchPricing.isPending) {
      onOpenChange(false);
    }
  }, [patchPricing.isPending, onOpenChange]);

  // Helper to check if a field is changed from original
  const isFieldChanged = useCallback(
    (provider: string, model: string, field: PricingField): boolean => {
      const fieldKey = `${provider}-${model}-${field}`;
      return changedFields.has(fieldKey);
    },
    [changedFields]
  );

  // Loading state
  if (isLoading) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right-wide"
          className="flex h-full flex-col gap-0 overflow-hidden p-0"
          data-testid="pricing-config__dialog"
        >
          <SheetHeader className="border-b border-subtle px-6 py-4">
            <SheetTitle>{t('title')}</SheetTitle>
            <SheetDescription>{t('description')}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-tertiary">
              <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
              <p>{t('loading')}</p>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // Error state
  if (error) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right-wide"
          className="flex h-full flex-col gap-0 overflow-hidden p-0"
          data-testid="pricing-config__dialog"
        >
          <SheetHeader className="border-b border-subtle px-6 py-4">
            <SheetTitle>{t('title')}</SheetTitle>
            <SheetDescription>{t('description')}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-error">
              <p>{t('error_load_failed')}</p>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  const providers = getProviders(localPricing);
  const isEmpty = isEmptyPricingMap(localPricing);

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent
        side="right-wide"
        className="flex h-full flex-col gap-0 overflow-hidden p-0"
        data-testid="pricing-config__dialog"
      >
        {/* Header */}
        <SheetHeader className="border-b border-subtle px-6 py-4">
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>

        {/* Content */}
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {/* Format hint */}
          <div className="rounded-lg border border-subtle bg-surface-high/35 p-3 text-sm">
            <p className="font-medium text-foreground">{t('format_hint')}</p>
            <p className="mt-1 text-tertiary">{t('format_example')}</p>
          </div>

          {isEmpty ? (
            <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-dashed border-subtle text-tertiary">
              {t('no_data')}
            </div>
          ) : (
            <div className="space-y-4">
              {providers.map((provider) => {
                const models = getModelsForProvider(localPricing, provider);
                return (
                  <div
                    key={provider}
                    className="overflow-hidden rounded-lg border border-subtle"
                  >
                    {/* Provider header */}
                    <div className="bg-surface-high/35 px-4 py-2">
                      <h3 className="text-sm font-semibold uppercase text-foreground">
                        {provider}
                      </h3>
                    </div>

                    {/* Pricing table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-hover text-tertiary">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs uppercase">Model</th>
                            {PRICING_FIELDS.map((field) => (
                              <th key={field} className="px-3 py-2 text-right text-xs uppercase">
                                {getPricingFieldLabel(field, t)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-subtle">
                          {models.map((model) => {
                            const pricing = getModelPricing(localPricing, provider, model);
                            return (
                              <tr key={model} className="hover:bg-surface-high/50">
                                <td className="px-3 py-2 font-medium text-foreground">
                                  {model}
                                </td>
                                {PRICING_FIELDS.map((field) => {
                                  const fieldChanged = isFieldChanged(provider, model, field);
                                  return (
                                    <td key={field} className="px-3 py-2">
                                      <Input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={formatPricingValue(pricing[field])}
                                        onChange={(e) =>
                                          handlePricingChange(provider, model, field, e.target.value)
                                        }
                                        disabled={isSaving}
                                        className={cn(
                                          'h-8 w-24 px-2 py-1 text-right text-xs',
                                          fieldChanged && 'pricing-config__input--changed border-accent'
                                        )}
                                        data-testid={`pricing-config__input-${provider}-${model}-${field}`}
                                      />
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 justify-between border-t border-subtle px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              type="button"
              variant="destructive"
              onClick={handleReset}
              disabled={isSaving || isEmpty}
              data-testid="pricing-config__reset-button"
            >
              {t('reset')}
            </Button>
            {changedFields.size > 0 && (
              <span
                className="text-sm text-tertiary"
                data-testid="pricing-config__change-count"
              >
                {changedFields.size}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              disabled={isSaving}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleSave}
              disabled={isSaving || !hasChanges || isEmpty}
              data-testid="pricing-config__save-button"
            >
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('saving')}
                </>
              ) : (
                t('save')
              )}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
