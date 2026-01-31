import type { StoryFn, StoryContext } from '@storybook/react';
import { useEffect } from 'react';

/**
 * Internal component that handles dark theme setup
 */
function DarkThemeWrapper({ story }: { story: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.style.backgroundColor = '#191919';
    document.documentElement.style.color = '#ffffff';

    return () => {
      document.documentElement.classList.remove('dark');
      document.documentElement.style.backgroundColor = '';
      document.documentElement.style.color = '';
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-primary p-8">
      {story}
    </div>
  );
}

/**
 * A decorator that wraps stories in a dark theme container
 * matching the MBOS design system
 */
export const withDarkTheme = (Story: StoryFn, context: StoryContext) => {
  return <DarkThemeWrapper story={Story({}, context)} />;
};
