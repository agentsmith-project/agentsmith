import type { Meta, StoryObj } from '@storybook/react';
import { within, expect } from '@storybook/test';
import { AppShellSidebar } from '@/components/app-shell/AppShellSidebar';

const meta = {
  title: 'App Shell/Sidebar',
  component: AppShellSidebar,
  parameters: {
    layout: 'padded',
    backgrounds: {
      default: 'dark',
    },
  },
} satisfies Meta<typeof AppShellSidebar>;

export default meta;

type Story = StoryObj<typeof AppShellSidebar>;

/*
 * Default sidebar (project context)
 */
export const Default: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Overview')).toBeInTheDocument();
  },
};

/*
 * Sidebar with chat mode active
 */
export const ChatMode: Story = {
  args: {},
};

/*
 * Sidebar with studio mode active
 */
export const StudioMode: Story = {
  args: {},
};

/*
 * Note: The sidebar is now context-aware and uses authStore
 * Mock the store in tests to show different states
 */
export const WithBadges: Story = {
  args: {},
};
