'use client';

import * as React from 'react';
import { MoonStar, SunMedium } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useTheme } from '@/components/providers/ThemeProvider';
import type { Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';

const THEME_OPTIONS: Array<{
  id: Theme;
  labelKey: 'theme_light' | 'theme_dark';
  icon: typeof SunMedium;
}> = [
  { id: 'light', labelKey: 'theme_light', icon: SunMedium },
  { id: 'dark', labelKey: 'theme_dark', icon: MoonStar },
];

type PublicThemeToggleProps = {
  className?: string;
};

export function PublicThemeToggle({ className }: PublicThemeToggleProps) {
  const t = useTranslations('common.user_menu');
  const { theme, setTheme, mounted } = useTheme();

  return (
    <div
      data-testid="public-theme-toggle"
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-border/55 bg-background/92 p-1',
        className,
      )}
    >
      {THEME_OPTIONS.map((option) => {
        const Icon = option.icon;
        const isActive = mounted && theme === option.id;
        return (
          <button
            key={option.id}
            type="button"
            data-testid={`public-theme-toggle__${option.id}`}
            aria-pressed={isActive}
            aria-label={t(option.labelKey)}
            title={t(option.labelKey)}
            onClick={() => setTheme(option.id)}
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              isActive
                ? 'bg-surface-low text-foreground'
                : 'text-secondary hover:bg-surface-low/60 hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{t(option.labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
