export const locales = ['en-US', 'zh-CN'] as const;
export type Locale = (typeof locales)[number];

export const globalTypes = {
  locale: {
    name: 'Locale',
    description: 'Display language',
    toolbar: {
      title: 'Language',
      icon: 'globe',
    },
    defaultValue: 'en-US',
    tags: ['i18n'],
    options: Object.fromEntries(locales.map((l) => [l, l])),
  },
  theme: {
    name: 'Theme',
    description: 'UI theme',
    toolbar: {
      title: 'Theme',
      icon: 'mirror',
    },
    defaultValue: 'light',
    options: {
      light: 'light',
      dark: 'dark',
    },
  },
};
