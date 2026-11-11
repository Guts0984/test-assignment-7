import type { StorybookConfig } from '@storybook/react-vite';
import { resolve } from 'node:path';

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.tsx'],
  addons: ['@storybook/addon-a11y'],
  staticDirs: ['./public'], // mockServiceWorker.js for MSW
  viteFinal: (cfg) => ({
    ...cfg,
    resolve: {
      ...cfg.resolve,
      alias: { ...cfg.resolve?.alias, '@': resolve(import.meta.dirname, '../src') },
    },
  }),
};

export default config;
