import type { Meta, StoryObj } from '@storybook/react';
import { within, expect } from '@storybook/test';
import { AppShellSidebar } from '@/components/app-shell/AppShellSidebar';
import { LayoutDashboard, MessageSquare, Workflow, Bot, Server, Database, Users, FileSearch, BarChart3, Settings } from 'lucide-react';

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
 * Default sidebar with all items
 */
export const Default: Story = {
  args: {
    currentValue: 'overview',
    onChange: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Overview')).toBeInTheDocument();
  },
};

/*
 * Sidebar with chat mode active
 */
export const ChatMode: Story = {
  args: {
    currentValue: 'chat',
    onChange: () => {},
  },
};

/*
 * Sidebar with workbench mode active
 */
export const WorkbenchMode: Story = {
  args: {
    currentValue: 'workbench',
    onChange: () => {},
  },
};

/*
 * Sidebar with badges
 */
export const WithBadges: Story = {
  args: {
    currentValue: 'agents',
    onChange: () => {},
    items: [
      { id: 'overview', label: 'Overview', icon: LayoutDashboard },
      { id: 'chat', label: 'Chat', icon: MessageSquare },
      { id: 'workbench', label: 'Workbench', icon: Workflow },
      { id: 'agents', label: 'Agents', icon: Bot, badge: '5' },
      { id: 'endpoints', label: 'Endpoints', icon: Server, badge: '3' },
      { id: 'userdata', label: 'UserData', icon: Database },
      { id: 'members', label: 'Members', icon: Users },
      { id: 'audit', label: 'Audit', icon: FileSearch },
      { id: 'usage', label: 'Usage', icon: BarChart3 },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
};
