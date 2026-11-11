import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { routerMock } from '../../../../vitest.setup';
import { server } from '@/shared/api/mocks/node';
import { expectNoA11yViolations } from '@/shared/lib/a11y';
import { renderWithProviders } from '@/shared/lib/test-utils';
import { LoginPage } from './login-page';

const fill = async (login: string, password: string) => {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/login|логін/i), login);
  await user.type(screen.getByLabelText(/password|пароль/i), password);
  await user.click(screen.getByRole('button', { name: /sign in|увійти/i }));
};

describe('LoginPage', () => {
  it('signs in with valid credentials and goes to the catalog', async () => {
    renderWithProviders(<LoginPage />);
    await fill('admin', 'admin-pass-123');
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/'));
  });

  it('shows an announced error on a wrong password and stays on the page', async () => {
    renderWithProviders(<LoginPage />);
    await fill('admin', 'nope-nope');
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong login or password.');
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it('tells the user how long to wait when rate limited (English plural)', async () => {
    server.use(
      http.post('*/api/auth/login', () =>
        HttpResponse.json(
          { error: { code: 'rate_limited', message: 'x' } },
          { status: 429, headers: { 'retry-after': '1' } },
        ),
      ),
    );
    renderWithProviders(<LoginPage />);
    await fill('admin', 'whatever');
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 1 second.');
  });

  it.each([
    [1, '1 секунду'],
    [3, '3 секунди'],
    [5, '5 секунд'],
    [21, '21 секунду'],
    [22, '22 секунди'],
    [11, '11 секунд'],
  ])('Ukrainian plural for %i seconds', async (sec, text) => {
    server.use(
      http.post('*/api/auth/login', () =>
        HttpResponse.json(
          { error: { code: 'rate_limited', message: 'x' } },
          { status: 429, headers: { 'retry-after': String(sec) } },
        ),
      ),
    );
    renderWithProviders(<LoginPage />, { locale: 'uk' });
    await fill('admin', 'x');
    expect(await screen.findByRole('alert')).toHaveTextContent(`за ${text}`);
  });

  it('server down -> a generic, non-leaky message', async () => {
    server.use(http.post('*/api/auth/login', () => HttpResponse.error()));
    renderWithProviders(<LoginPage />);
    await fill('admin', 'x');
    expect(await screen.findByRole('alert')).toHaveTextContent('The service is unavailable');
  });

  it('has no accessibility violations (empty and with an error)', async () => {
    const { container } = renderWithProviders(<LoginPage />);
    await expectNoA11yViolations(container);
    await fill('admin', 'bad-bad-bad');
    await screen.findByRole('alert');
    await expectNoA11yViolations(container);
  });

  it('disables submit until both fields are filled (no empty requests)', () => {
    renderWithProviders(<LoginPage />);
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled();
  });

  it('lists the demo accounts; clicking one fills the form and it really signs in', async () => {
    renderWithProviders(<LoginPage />);
    const section = screen.getByRole('region', { name: 'Demo accounts' });
    expect(within(section).getAllByRole('button')).toHaveLength(4);
    const user = userEvent.setup();
    await user.click(within(section).getByRole('button', { name: /^editor1/ }));
    expect(screen.getByLabelText('Login')).toHaveValue('editor1');
    expect(screen.getByLabelText('Password')).toHaveValue('editor1-pass-123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/'));
  });
});
