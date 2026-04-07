import type {
  CustomEndpointUpstreamProtocol,
  EndpointHealthErrorCategory,
  ValidateEndpointResponse,
} from '@/lib/api/types/endpoints';
import type { EndpointCapabilityType } from '@/lib/api/types';

export type WizardStep = 1 | 2 | 3;

export interface ValidationError {
  field: string;
  message: string;
}

export interface CustomEndpointWizardFormState {
  name: string;
  upstreamProtocol: CustomEndpointUpstreamProtocol;
  baseUrl: string;
  modelId: string;
  capability: EndpointCapabilityType;
  credentialRef: string;
  maxContextTokens: string;
  maxOutputTokens: string;
  supportsFile: boolean;
  supportsToolCall: boolean;
  supportsReasoning: boolean;
  priceInputPer1m: string;
  priceOutputPer1m: string;
  cacheReadDiscountRatio: string;
  cacheWriteDiscountRatio: string;
}

export interface CustomEndpointWizardNumericProfile {
  context: number;
  output: number;
  inputPrice: number;
  outputPrice: number;
  cacheRead: number;
  cacheWrite: number;
}

export type WizardTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export interface ValidationResultState {
  result: ValidateEndpointResponse | null;
  isValidating: boolean;
}

export type ErrorCategoryFormatter = (category: EndpointHealthErrorCategory) => string;
