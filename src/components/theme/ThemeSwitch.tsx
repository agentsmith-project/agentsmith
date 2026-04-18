'use client';

import { useTranslations } from 'next-intl';

import { useTheme } from '@/components/providers/ThemeProvider';
import { cn } from '@/lib/utils';

import { THEME_OPTIONS } from './themeOptions';

type ThemeSwitchProps = {
  className?: string;
  dataTestId: string;
  optionTestIdPrefix: string;
  optionTestIdSeparator?: string;
  tone?: 'surface' | 'public';
  density?: 'compact' | 'comfortable';
  labelVisibility?: 'always' | 'responsive' | 'never';
};

export function ThemeSwitch({
  className,
  dataTestId,
  optionTestIdPrefix,
  optionTestIdSeparator = '-',
  tone = 'surface',
  density = 'comfortable',
  labelVisibility = 'responsive',
}: ThemeSwitchProps) {
  const t = useTranslations('common.user_menu');
  const { theme, setTheme, mounted } = useTheme();

  return (
    <div
      role="group"
      aria-label={t('appearance')}
      data-testid={dataTestId}
      data-tone={tone}
      data-density={density}
      className={cn('theme-switch-shell', className)}
    >
      {THEME_OPTIONS.map((option) => {
        const Icon = option.icon;
        const isActive = mounted && theme === option.id;
        return (
          <button
            key={option.id}
            type="button"
            data-testid={`${optionTestIdPrefix}${optionTestIdSeparator}${option.id}`}
            data-active={isActive ? 'true' : 'false'}
            data-density={density}
            aria-pressed={isActive}
            aria-label={t(option.labelKey)}
            title={t(option.labelKey)}
            onClick={() => setTheme(option.id)}
            className="theme-switch-option"
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span
              className={cn(
                labelVisibility === 'always'
                  ? undefined
                  : labelVisibility === 'responsive'
                    ? 'hidden sm:inline'
                    : 'sr-only',
              )}
            >
              {t(option.labelKey)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
