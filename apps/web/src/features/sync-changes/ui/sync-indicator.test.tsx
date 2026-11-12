import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/shared/lib/test-utils';
import { SyncIndicator } from './sync-indicator';

describe('SyncIndicator', () => {
  it('says "saved" only when nothing needs attention', () => {
    renderWithProviders(<SyncIndicator status={{ state: 'saved', unsaved: 0 }} />);
    expect(screen.getByRole('status')).toHaveTextContent('All changes saved');
  });

  it('does NOT say "all saved" while cells are refused or in conflict', () => {
    renderWithProviders(<SyncIndicator status={{ state: 'saved', unsaved: 0 }} problems={2} />);
    const s = screen.getByRole('status');
    expect(s).not.toHaveTextContent('All changes saved');
    expect(s).toHaveTextContent('2 changes need attention');
  });

  it('a whole-request failure shows a translated text, never the raw server message', () => {
    renderWithProviders(
      <SyncIndicator
        status={{ state: 'error', unsaved: 1, lastError: 'ERR 22021 invalid byte' }}
      />,
    );
    const s = screen.getByRole('status');
    expect(s).toHaveTextContent('Could not save the changes');
    expect(s).not.toHaveTextContent('22021');
  });
});
