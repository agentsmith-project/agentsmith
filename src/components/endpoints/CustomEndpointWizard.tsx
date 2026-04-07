/**
 * CustomEndpointWizard Component
 *
 * Three-step wizard for creating custom OpenAI/Anthropic compatible endpoints.
 *
 * Step 1: Basic Info - Name, Protocol Type, Base URL
 * Step 2: Model Config - Model ID, Capability, Credential
 * Step 3: Validate & Create - Check connection, create endpoint
 *
 * TDD: Implementation following test file specifications.
 */

'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useMutation, useQuery } from '@tanstack/react-query';
import { EndpointAPI, CredentialsAPI, getApiClient } from '@/lib/api';
import type { CreateEndpointRequest } from '@/lib/api/endpoints/endpoints';
import { getCustomProtocolConfig } from '@/lib/endpoints/provider-catalog';
import { toast } from '@/components/ui/toast';
import { BasicInfoStep } from './custom-endpoint-wizard/BasicInfoStep';
import { ModelConfigStep } from './custom-endpoint-wizard/ModelConfigStep';
import { StepIndicator } from './custom-endpoint-wizard/StepIndicator';
import type {
  CustomEndpointWizardFormState,
  ValidationError,
  WizardStep,
} from './custom-endpoint-wizard/types';
import { ValidateCreateStep } from './custom-endpoint-wizard/ValidateCreateStep';
import { WizardFooter } from './custom-endpoint-wizard/WizardFooter';
import {
  buildCreateEndpointRequest,
  DEFAULT_MODEL_PROFILE_FIELDS,
  DEFAULT_WIZARD_FORM_STATE,
  getErrorCategoryMessage,
  getErrorForField,
  runLocalValidation,
  validateStep1,
  validateStep2,
} from './custom-endpoint-wizard/utils';

export interface CustomEndpointWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  onSuccess?: () => void;
}

export function CustomEndpointWizard({
  open,
  onOpenChange,
  workspaceId,
  projectId,
  onSuccess,
}: CustomEndpointWizardProps) {
  const locale = useLocale();
  const t = useTranslations('endpoints.custom_wizard');
  const tErrors = useTranslations('endpoints.custom_wizard.errors');

  const [step, setStep] = React.useState<WizardStep>(1);
  const [form, setForm] = React.useState<CustomEndpointWizardFormState>(DEFAULT_WIZARD_FORM_STATE);
  const [validationErrors, setValidationErrors] = React.useState<ValidationError[]>([]);
  const [validationResult, setValidationResult] = React.useState<ReturnType<typeof runLocalValidation> | null>(null);
  const [isValidating, setIsValidating] = React.useState(false);

  const endpointAPI = React.useMemo(() => new EndpointAPI(getApiClient()), []);
  const credentialsAPI = React.useMemo(() => new CredentialsAPI(getApiClient()), []);

  const { data: credentials = [] } = useQuery({
    queryKey: ['credentials', workspaceId, projectId],
    queryFn: () => credentialsAPI.list(workspaceId, projectId),
    enabled: open && !!workspaceId && !!projectId,
  });

  // Auto-select first credential when credentials are loaded
  React.useEffect(() => {
    if (credentials.length > 0 && !form.credentialRef) {
      setForm((prev) => ({ ...prev, credentialRef: credentials[0].id }));
    }
  }, [credentials, form.credentialRef]);

  const createMutation = useMutation({
    mutationFn: async (data: CreateEndpointRequest) => {
      return endpointAPI.create(workspaceId, projectId, data);
    },
    onSuccess: () => {
      onOpenChange(false);
      resetForm();
      toast.success(t('validation.success', { latency: validationResult?.healthCheck?.latencyMs ?? 0 }));
      onSuccess?.();
    },
    onError: (error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : t('validation.failed');
      toast.error(errorMessage);
    },
  });

  // Update base URL when protocol changes
  React.useEffect(() => {
    const config = getCustomProtocolConfig(form.upstreamProtocol);
    if (config && !form.baseUrl) {
      setForm((prev) => ({ ...prev, baseUrl: config.default_base_url }));
    }
  }, [form.baseUrl, form.upstreamProtocol]);

  const resetForm = () => {
    setStep(1);
    setForm(DEFAULT_WIZARD_FORM_STATE);
    setValidationErrors([]);
    setValidationResult(null);
    setIsValidating(false);
  };

  const applyRecommendedDefaults = () => {
    setForm((prev) => ({ ...prev, ...DEFAULT_MODEL_PROFILE_FIELDS }));
  };

  React.useEffect(() => {
    if (open) {
      resetForm();
    }
  }, [open]);

  const runStep1Validation = (): boolean => {
    const errors = validateStep1(form, tErrors);
    setValidationErrors(errors);
    return errors.length === 0;
  };

  const handleValidate = async () => {
    setIsValidating(true);
    setValidationResult(null);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const result = runLocalValidation(form.baseUrl, tErrors);
    setValidationResult(result);
    setIsValidating(false);
  };

  const runStep2Validation = (): boolean => {
    const errors = validateStep2(form, tErrors);
    setValidationErrors(errors);
    return errors.length === 0;
  };

  const handleNextStep = () => {
    if (step === 1 && runStep1Validation()) {
      setStep(2);
    } else if (step === 2 && runStep2Validation()) {
      setStep(3);
    }
  };

  const handleBackStep = () => {
    if (step === 2) {
      setStep(1);
    } else if (step === 3) {
      setStep(2);
    }
  };

  const handleCreate = () => {
    // Validation is optional - allow creation without validating
    // but if validation was run and failed, prevent creation
    if (validationResult && !validationResult.valid) {
      return;
    }

    createMutation.mutate(buildCreateEndpointRequest(form));
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && !createMutation.isPending && !isValidating) {
      onOpenChange(next);
    }
  };

  const readFieldError = React.useCallback(
    (field: string) =>
      getErrorForField({
        field,
        step,
        form,
        validationErrors,
        tErrors,
      }),
    [form, step, tErrors, validationErrors],
  );

  const step1Blockers = validateStep1(form, tErrors);
  const step2Blockers = validateStep2(form, tErrors);

  const canProceed = step === 1
    ? step1Blockers.length === 0
    : step === 2
      ? step2Blockers.length === 0
      : validationResult?.valid === true;

  const nextDisabledReason = step === 1
    ? step1Blockers[0]?.message
    : step === 2
      ? (credentials.length === 0 ? t('create_credential_first') : step2Blockers[0]?.message)
      : undefined;

  const handleFormChange = React.useCallback(
    <K extends keyof CustomEndpointWizardFormState>(field: K, value: CustomEndpointWizardFormState[K]) => {
      setForm((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right-wide"
        className="flex h-full flex-col gap-0 overflow-hidden p-0"
        data-testid="endpoints__custom-wizard"
      >
        <SheetHeader className="border-b border-subtle px-6 py-4">
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>
            {step === 1 && t('step1_title')}
            {step === 2 && t('step2_title')}
            {step === 3 && t('step3_title')}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-4">
          <StepIndicator step={step} />

          {step === 1 && (
            <BasicInfoStep
              t={t}
              form={form}
              onChange={handleFormChange}
              getErrorForField={readFieldError}
            />
          )}

          {step === 2 && (
            <ModelConfigStep
              t={t}
              locale={locale}
              workspaceId={workspaceId}
              projectId={projectId}
              form={form}
              credentials={credentials}
              onChange={handleFormChange}
              applyRecommendedDefaults={applyRecommendedDefaults}
              getErrorForField={readFieldError}
            />
          )}

          {step === 3 && (
            <ValidateCreateStep
              t={t}
              form={form}
              credentials={credentials}
              validationState={{ result: validationResult, isValidating }}
              onValidate={handleValidate}
              formatErrorCategory={(category) => getErrorCategoryMessage(tErrors, category)}
            />
          )}
        </div>

        <WizardFooter
          t={t}
          step={step}
          canProceed={canProceed}
          nextDisabledReason={nextDisabledReason}
          credentialsAvailable={credentials.length > 0}
          isCreating={createMutation.isPending}
          isValidating={isValidating}
          onCancel={() => handleOpenChange(false)}
          onBack={handleBackStep}
          onNext={handleNextStep}
          onCreate={handleCreate}
        />
      </SheetContent>
    </Sheet>
  );
}
