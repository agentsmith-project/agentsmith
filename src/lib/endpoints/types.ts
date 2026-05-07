import type {
  EndpointCapability,
  EndpointDefaults,
  EndpointModelBinding,
  EndpointModelProfile,
  EndpointProviderFamily,
  EndpointUpstreamProtocol,
} from '@/lib/api/types';

export interface EndpointBulkImportItemConfig {
  model: string;
  api_base: string;
  api_key: string;
  mode?: 'openai';
}

export interface EndpointBulkImportExportedEndpointConfig {
  name?: string;
  description?: string;
  model: string;
  type?: 'catalog' | 'custom';
  provider_family?: EndpointProviderFamily;
  upstream_protocol?: EndpointUpstreamProtocol;
  capabilities?: EndpointCapability[];
  models?: EndpointModelBinding[];
  defaults?: EndpointDefaults;
  api_base: string;
  base_url?: string;
  status?: 'active' | 'disabled';
  credential_ref?: string;
  model_profile?: EndpointModelProfile;
  limits?: {
    max_requests_per_minute?: number;
    max_requests_per_day?: number;
    max_tokens_per_day?: number;
    timeout_seconds?: number;
  };
}

export interface EndpointBulkImportPayload {
  reranker?: EndpointBulkImportItemConfig;
  embedding?: EndpointBulkImportItemConfig;
  completion?: EndpointBulkImportItemConfig;
  image_generation?: EndpointBulkImportItemConfig;
  video_generation?: EndpointBulkImportItemConfig;
  endpoints?: EndpointBulkImportExportedEndpointConfig[];
}
