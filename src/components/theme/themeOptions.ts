import { MoonStar, SunMedium, type LucideIcon } from 'lucide-react';

import type { Theme } from '@/lib/theme';

export const THEME_OPTIONS: Array<{
  id: Theme;
  labelKey: 'theme_light' | 'theme_dark';
  icon: LucideIcon;
}> = [
  { id: 'light', labelKey: 'theme_light', icon: SunMedium },
  { id: 'dark', labelKey: 'theme_dark', icon: MoonStar },
];
