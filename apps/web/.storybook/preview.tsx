import type { Preview } from '@storybook/react-vite';
import { setupWorker } from 'msw/browser';
import '../src/app/globals.css';
import { handlers } from '../src/shared/api/mocks/handlers';
import { annotations } from '../src/shared/storybook/annotations';

// The SAME handlers the unit tests use; a story can add its own through parameters.msw.handlers.
const worker = setupWorker(...handlers);
let started: Promise<unknown> | null = null;

const preview: Preview = {
  ...annotations,
  loaders: [
    async ({ parameters }) => {
      started ??= worker.start({
        onUnhandledRequest: 'bypass',
        quiet: true,
        serviceWorker: { url: 'mockServiceWorker.js' },
      });
      await started;
      worker.resetHandlers();
      worker.use(...((parameters.msw?.handlers as Parameters<typeof worker.use>) ?? []));
    },
  ],
};

export default preview;
