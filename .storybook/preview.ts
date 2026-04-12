import type { Preview } from '@storybook/nextjs';

import { withTheme, withI18n } from '../src/stories/decorators';
import { globalTypes } from '../src/stories/types';

const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: '^on[A-Z].*' },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/,
      },
    },
    backgrounds: {
      default: 'canvas-light',
      values: [
        { name: 'canvas-light', value: '#f2f1ed' },
        { name: 'canvas-dark', value: '#14120b' },
        { name: 'surface-light', value: '#ebeae5' },
        { name: 'surface-dark', value: '#1f1b13' },
      ],
    },
  },
  globalTypes,
  decorators: [withTheme, withI18n],
};

export default preview;
