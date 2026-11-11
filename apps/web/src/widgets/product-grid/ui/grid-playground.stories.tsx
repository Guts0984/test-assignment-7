import type { Meta, StoryObj } from '@storybook/react-vite';
import { fireEvent } from '@testing-library/react';
import { expect, fn, userEvent, within } from 'storybook/test';
import type { Me } from '@catalog/shared';
import { makeProducts } from '@/shared/api/mocks/data';
import { GridPlayground } from './grid-playground';

const ADMIN: Me = {
  id: '11111111-1111-4111-8111-111111111111',
  login: 'admin',
  role: 'admin',
  categories: [],
};
const VIEWER: Me = {
  id: '44444444-4444-4444-8444-444444444444',
  login: 'viewer',
  role: 'viewer',
  categories: [],
};
const rows = makeProducts(60);
const cell = (root: HTMLElement, r: number, c: number) =>
  root.querySelector<HTMLElement>(`[role="gridcell"][data-row="${r}"][data-col="${c}"]`)!;
const clip = (text: string) => ({
  clipboardData: { getData: () => text, setData: () => undefined },
});

const meta = {
  title: 'Grid/Playground (interaction tests)',
  component: GridPlayground,
  args: { rows, me: ADMIN, onCommit: fn() },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof GridPlayground>;
export default meta;
type S = StoryObj<typeof meta>;

export const Overview: S = {};

export const EditWithKeyboard: S = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(cell(canvasElement, 0, 1));
    await userEvent.keyboard('Renamed lamp{Enter}');
    await expect(cell(canvasElement, 0, 1)).toHaveTextContent('Renamed lamp');
    await expect(args.onCommit).toHaveBeenCalledWith(
      [{ id: rows[0]!.id, field: 'name', value: 'Renamed lamp' }],
      'edit',
    );
    await expect(document.activeElement).toBe(cell(canvasElement, 1, 1)); // Enter moved down
  },
};

export const EscCancels: S = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(cell(canvasElement, 0, 1));
    await userEvent.keyboard('{F2}discarded{Escape}');
    await expect(cell(canvasElement, 0, 1)).toHaveTextContent(rows[0]!.name);
    await expect(args.onCommit).not.toHaveBeenCalled();
  },
};

export const InvalidNumberIsNotSent: S = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(cell(canvasElement, 0, 5));
    await userEvent.keyboard('1.5{Enter}');
    await expect(within(canvasElement).getByRole('tooltip')).toHaveTextContent(
      'Enter a whole number.',
    );
    await expect(args.onCommit).not.toHaveBeenCalled();
  },
};

export const PasteBlock: S = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(cell(canvasElement, 0, 5));
    fireEvent.paste(within(canvasElement).getByRole('grid'), clip('11\n22\n33'));
    await expect(args.onCommit).toHaveBeenCalledTimes(1);
    await expect(cell(canvasElement, 0, 5)).toHaveTextContent('11');
    await expect(cell(canvasElement, 2, 5)).toHaveTextContent('33');
  },
};

export const PasteOneValueIntoRange: S = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(cell(canvasElement, 0, 5));
    await userEvent.keyboard('{Shift>}{ArrowDown}{ArrowDown}{/Shift}');
    fireEvent.paste(within(canvasElement).getByRole('grid'), clip('7'));
    await expect(cell(canvasElement, 2, 5)).toHaveTextContent('7');
    await expect((args.onCommit as ReturnType<typeof fn>).mock.calls[0]![0]).toHaveLength(3);
  },
};

export const ViewerCannotEdit: S = {
  args: { me: VIEWER },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(cell(canvasElement, 0, 1));
    await userEvent.keyboard('x');
    await expect(cell(canvasElement, 0, 1)).toHaveAttribute('aria-readonly', 'true');
    await expect(within(canvasElement).getByRole('tooltip')).toHaveTextContent(
      'You cannot edit this product.',
    );
    await expect(args.onCommit).not.toHaveBeenCalled();
  },
};

export const KeyboardNavigation: S = {
  play: async ({ canvasElement }) => {
    await userEvent.click(cell(canvasElement, 3, 3));
    await userEvent.keyboard('{ArrowDown}{ArrowRight}');
    await expect(document.activeElement).toBe(cell(canvasElement, 4, 4));
    await userEvent.keyboard('{Control>}{Home}{/Control}');
    await expect(document.activeElement).toBe(cell(canvasElement, 0, 0));
  },
};
