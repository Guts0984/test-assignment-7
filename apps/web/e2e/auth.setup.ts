import { test as setup, expect } from '@playwright/test';
import { USERS, authFile, type Who } from './support';

// Log each seed user in ONCE through the real UI and keep the session cookie for the specs.
for (const who of Object.keys(USERS) as Who[]) {
  setup(`sign in as ${who}`, async ({ page }) => {
    await page.goto('/en/login');
    await page.getByLabel('Login').fill(who);
    await page.getByLabel('Password').fill(USERS[who]);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('grid')).toBeVisible();
    await page.context().storageState({ path: authFile(who) });
  });
}
