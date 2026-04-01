import type { EndpointCapabilityType, EndpointProviderFamily, EndpointUpstreamProtocol } from '@/lib/api/types';

export type CapabilityOption = EndpointCapabilityType;

export type CatalogModelOption = {
  model_id: string;
  name: string;
  capabilities: EndpointCapabilityType[];
  limit?: {
    context?: number;
    output?: number;
  };
  cost?: Record<string, number | Record<string, number>>;
};

export type EndpointProviderSelection = {
  upstream_protocol: EndpointUpstreamProtocol;
  family: EndpointProviderFamily;
};
