import { expect, test } from '@playwright/test';

test('the login page lists the demo accounts; one click fills the form and signs in', async ({
  page,
}) => {
  await page.goto('/en/login');
  const demo = page.getByRole('region', { name: 'Demo accounts' });
  await expect(demo.getByRole('button')).toHaveCount(4);
  await demo.getByRole('button', { name: /^viewer/ }).click();
  await expect(page.getByLabel('Login')).toHaveValue('viewer');
  await expect(page.getByLabel('Password')).toHaveValue('viewer-pass-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('grid')).toBeVisible();
});
