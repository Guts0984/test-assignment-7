import { axe } from 'jest-axe';
import { expect } from 'vitest';

/** Runs axe and fails with the rule ids, help text and offending nodes (readable in CI logs). */
export const expectNoA11yViolations = async (container: Element): Promise<void> => {
  const results = await axe(container);
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.help} -> ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
    ),
  ).toEqual([]);
};
