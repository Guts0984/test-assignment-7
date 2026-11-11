import { axe } from 'jest-axe';
import { expect } from 'vitest';

/**
 * Runs axe and fails with the rule ids, help text and offending nodes (readable in CI logs).
 * `component: true` skips the page-level landmark rule, which cannot apply to an isolated component.
 */
export const expectNoA11yViolations = async (
  container: Element,
  opts: { component?: boolean } = {},
): Promise<void> => {
  const results = await axe(
    container,
    opts.component ? { rules: { region: { enabled: false } } } : undefined,
  );
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.help} -> ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
    ),
  ).toEqual([]);
};
