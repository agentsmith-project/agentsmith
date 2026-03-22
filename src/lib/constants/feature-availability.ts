import { getPublicRuntimeConfig } from '@/lib/public-runtime-config';

export type FeatureAvailability = 'available' | 'partial' | 'mock_only' | 'coming_soon';

export type GovernedFeature = 'audit' | 'usage' | 'members' | 'resource_policy';

export const FEATURE_AVAILABILITY: Record<GovernedFeature, FeatureAvailability> = {
  audit: 'available',
  usage: 'available',
  members: 'available',
  resource_policy: 'available',
};

export function isRealBackendMode(): boolean {
  return !getPublicRuntimeConfig().useMsw;
}

export function getFeatureAvailability(feature: GovernedFeature): FeatureAvailability {
  return FEATURE_AVAILABILITY[feature];
}

export function isFeatureBlockedInCurrentMode(feature: GovernedFeature): boolean {
  return isRealBackendMode() && getFeatureAvailability(feature) === 'mock_only';
}
