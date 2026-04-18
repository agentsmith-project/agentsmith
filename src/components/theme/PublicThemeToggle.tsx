'use client';

import { cn } from '@/lib/utils';

import { ThemeSwitch } from './ThemeSwitch';

type PublicThemeToggleProps = {
  className?: string;
};

export function PublicThemeToggle({ className }: PublicThemeToggleProps) {
  return (
    <ThemeSwitch
      className={cn('bg-background/92', className)}
      dataTestId="public-theme-toggle"
      optionTestIdPrefix="public-theme-toggle"
      optionTestIdSeparator="__"
      tone="public"
      density="comfortable"
      labelVisibility="responsive"
    />
  );
}
