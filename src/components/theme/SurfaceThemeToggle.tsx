'use client';

import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

import { ThemeSwitch } from './ThemeSwitch';

type SurfaceThemeToggleProps = {
  className?: string;
  compact?: boolean;
  dataTestId: string;
  optionTestIdPrefix: string;
  showLabel?: boolean;
};

export function SurfaceThemeToggle({
  className,
  compact = false,
  dataTestId,
  optionTestIdPrefix,
  showLabel = false,
}: SurfaceThemeToggleProps) {
  const t = useTranslations('common.user_menu');

  return (
    <div
      data-testid={dataTestId}
      className={cn(
        'flex items-center gap-3',
        compact ? 'justify-end' : 'flex-wrap justify-end',
        className,
      )}
    >
      {showLabel ? (
        <span className="type-system-label text-tertiary">{t('appearance')}</span>
      ) : null}
      <ThemeSwitch
        dataTestId={`${optionTestIdPrefix}-switch`}
        optionTestIdPrefix={optionTestIdPrefix}
        tone="surface"
        density={compact ? 'compact' : 'comfortable'}
        labelVisibility={compact ? 'responsive' : 'always'}
      />
    </div>
  );
}
