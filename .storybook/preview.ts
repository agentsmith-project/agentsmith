import type { Preview } from '@storybook/nextjs';
import { withDarkTheme, withI18n } from '../src/stories/decorators';
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
      default: 'dark',
      values: [
        { name: 'dark', value: '#191919' },
        { name: 'panel', value: '#1f1f1f' },
        { name: 'surface', value: '#252525' },
      ],
    },
  },
  globalTypes,
  decorators: [withDarkTheme, withI18n],
};

export default preview;
