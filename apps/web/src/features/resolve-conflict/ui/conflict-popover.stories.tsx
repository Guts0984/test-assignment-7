import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ConflictPopover } from './conflict-popover';

const meta = {
  title: 'Features/Conflict',
  component: ConflictPopover,
  args: {
    rect: { left: 40, top: 20, width: 200, height: 36 },
    conflict: {
      mine: 'Compact Lamp 2',
      theirs: 'Compact Lamp XL',
      theirsVersion: 4,
      author: 'bob',
    },
    field: 'name',
    locale: 'en',
    onResolve: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof ConflictPopover>;
export default meta;
type S = StoryObj<typeof meta>;

export const NamesTheOtherAuthor: S = {
  play: async ({ canvasElement }) => {
    const dlg = within(canvasElement).getByRole('dialog', { name: 'Edit conflict' });
    await expect(dlg).toHaveTextContent('bob changed this cell while you were editing.');
    await expect(within(dlg).getByText('Compact Lamp 2')).toBeInTheDocument();
    await expect(within(dlg).getByText('Compact Lamp XL')).toBeInTheDocument();
  },
};
export const ChooseMine: S = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Keep mine' }));
    await expect(args.onResolve).toHaveBeenCalledWith('mine');
  },
};
export const ChooseTheirs: S = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Use theirs' }));
    await expect(args.onResolve).toHaveBeenCalledWith('theirs');
  },
};
export const UnknownAuthor: S = {
  args: { conflict: { mine: 5, theirs: 9, theirsVersion: 2, author: null }, field: 'stock' },
};
