import type { Meta, StoryObj } from '@storybook/react';
import { within, expect } from '@storybook/test';

/**
 * Dummy page for testing the build
 */
const Testpage = () => <div>Testpage</div>;

export default {
  title: 'Testpage',
  component: Testpage,
} satisfies Meta<typeof Testpage>;

export const Primary: StoryObj<typeof Testpage> = {
  args: {},
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Testpage')).toBeInTheDocument();
  },
};
