export type FeatureAvailability = 'available' | 'partial' | 'mock_only' | 'coming_soon';

export type GovernedFeature = 'audit' | 'usage' | 'members' | 'resource_policy';

export const FEATURE_AVAILABILITY: Record<GovernedFeature, FeatureAvailability> = {
  audit: 'partial',
  usage: 'partial',
  members: 'mock_only',
  resource_policy: 'mock_only',
};

export function isRealBackendMode(): boolean {
  return process.env.NEXT_PUBLIC_USE_MSW === 'false';
}

export function getFeatureAvailability(feature: GovernedFeature): FeatureAvailability {
  return FEATURE_AVAILABILITY[feature];
}

export function isFeatureBlockedInCurrentMode(feature: GovernedFeature): boolean {
  return isRealBackendMode() && getFeatureAvailability(feature) === 'mock_only';
}
