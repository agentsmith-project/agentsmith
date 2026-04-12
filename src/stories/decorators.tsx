import type { StoryContext, StoryFn } from '@storybook/react';
import { useEffect } from 'react';

import { withI18n } from './decorators-i18n';

type ThemeWrapperProps = {
  story: React.ReactNode;
  theme: 'light' | 'dark';
};

function ThemeWrapper({ story, theme }: ThemeWrapperProps) {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;

    return () => {
      document.documentElement.removeAttribute('data-theme');
      document.documentElement.style.colorScheme = '';
    };
  }, [theme]);

  return <div className="min-h-screen bg-background px-8 py-10 text-primary">{story}</div>;
}

export const withTheme = (Story: StoryFn, context: StoryContext) => {
  const theme = context.globals.theme === 'dark' ? 'dark' : 'light';
  return <ThemeWrapper story={Story({}, context)} theme={theme} />;
};

export { withI18n };
