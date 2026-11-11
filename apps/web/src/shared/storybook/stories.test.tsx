import { composeStories, setProjectAnnotations } from '@storybook/react-vite';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '@/shared/api/mocks/node';
import { expectNoA11yViolations } from '@/shared/lib/a11y';
import { annotations } from './annotations';

setProjectAnnotations([annotations]);

/**
 * Runs EVERY story: renders it, executes its `play` function (the interaction test), then checks
 * accessibility with axe. Stories use the same MSW handlers as the unit tests (plus their own
 * `parameters.msw.handlers`), so the story, the test and the browser all see the same API.
 */
const modules = import.meta.glob('../../**/*.stories.tsx', { eager: true }) as Record<
  string,
  Record<string, unknown>
>;

afterEach(() => {
  document.documentElement.classList.remove('dark');
});

for (const [path, mod] of Object.entries(modules)) {
  const stories = composeStories(mod as never) as Record<
    string,
    {
      run: () => Promise<void>;
      parameters?: { msw?: { handlers?: Parameters<typeof server.use> } };
    }
  >;
  describe(path.replace('../../', ''), () => {
    for (const [name, story] of Object.entries(stories)) {
      it(name, async () => {
        server.use(...(story.parameters?.msw?.handlers ?? []));
        await story.run();
        await expectNoA11yViolations(document.body, { component: true });
      });
    }
  });
}

it('found the stories', () => {
  expect(Object.keys(modules).length).toBeGreaterThanOrEqual(5);
});
