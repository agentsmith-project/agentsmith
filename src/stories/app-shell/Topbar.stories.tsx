import type { Meta, StoryObj } from '@storybook/react';
import { Topbar } from '@/components/app-shell/Topbar';

const meta = {
  title: 'App Shell/Topbar',
  component: Topbar,
  parameters: {
    layout: 'fullscreen',
    backgrounds: {
      default: 'dark',
    },
  },
} satisfies Meta<typeof Topbar>;

export default meta;

type Story = StoryObj<typeof Topbar>;

/*
 * Default Topbar with all components
 */
export const Default: Story = {
  args: {},
};

/*
 * Topbar without user (logged out state)
 */
export const LoggedOut: Story = {
  args: {},
  decorators: [
    (_Story) => {
      // Mock logged out state
      return (
        <div className="flex items-center justify-between w-full bg-panel border-b border-subtle h-14 px-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ backgroundImage: 'var(--ai-gradient)' }}
              >
                <span className="text-lg font-bold text-white">M</span>
              </div>
              <span className="text-lg font-semibold text-foreground">MBOS</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button className="relative p-2 hover:bg-hover rounded-lg text-secondary hover:text-primary transition-all duration-200">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M15 17h5l-1.406-1.406M11 19H6" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.25" />
              </svg>
            </button>
            <button className="w-8 h-8 rounded-full bg-surface border border-subtle text-tertiary text-xs">
              ?
            </button>
          </div>
        </div>
      );
    },
  ],
};
