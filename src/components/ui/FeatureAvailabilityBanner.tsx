'use client';

import { useTranslations } from 'next-intl';

import type { FeatureAvailability } from '@/lib/constants/feature-availability';

export function FeatureAvailabilityBanner({
  availability,
  className = '',
}: {
  availability: FeatureAvailability;
  className?: string;
}) {
  const t = useTranslations('common.feature_availability');

  if (availability === 'available') return null;

  const tone =
    availability === 'partial'
      ? 'border-[rgb(var(--accent))]/30 bg-[rgb(var(--accent))]/10'
      : 'border-border bg-surface';

  return (
    <div
      className={`rounded-md border p-3 ${tone} ${className}`.trim()}
      data-testid="feature-availability__banner"
    >
      <p className="text-sm font-medium text-foreground">
        {availability === 'mock_only' && t('mock_only_title')}
        {availability === 'partial' && t('partial_title')}
        {availability === 'coming_soon' && t('coming_soon_title')}
      </p>
      <p className="mt-1 text-xs text-tertiary">
        {availability === 'mock_only' && t('mock_only_description')}
        {availability === 'partial' && t('partial_description')}
        {availability === 'coming_soon' && t('coming_soon_description')}
      </p>
    </div>
  );
}
