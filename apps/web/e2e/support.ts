import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';

export const USERS = {
  admin: 'admin-pass-123',
  editor1: 'editor1-pass-123',
  editor2: 'editor2-pass-123',
  viewer: 'viewer-pass-123',
} as const;
export type Who = keyof typeof USERS;

export const authFile = (who: Who) => `e2e/.auth/${who}.json`;

/** A new browser context that is already signed in as `who` (sessions are created once in auth.setup.ts). */
export const contextAs = (browser: Browser, who: Who): Promise<BrowserContext> =>
  browser.newContext({ storageState: authFile(who), locale: 'en-US' });

export type ProductDto = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  price: string | null;
  oldPrice: string | null;
  stock: number;
  status: string;
  tags: string[];
  versions: Record<string, number>;
};

export const products = async (request: APIRequestContext): Promise<ProductDto[]> => {
  const r = await request.get('/api/products');
  expect(r.ok()).toBeTruthy();
  return ((await r.json()) as { products: ProductDto[] }).products;
};

/** Column indexes in the grid. */
export const COL = {
  sku: 0,
  name: 1,
  category: 2,
  price: 3,
  oldPrice: 4,
  stock: 5,
  status: 6,
  tags: 7,
  arrivalDate: 8,
} as const;

export const cell = (page: Page, row: number, col: number): Locator =>
  page.locator(`[role="gridcell"][data-row="${row}"][data-col="${col}"]`);

export const openCatalog = async (page: Page, query = '', locale: 'en' | 'uk' = 'en') => {
  await page.goto(`/${locale}${query ? `?${query}` : ''}`);
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount', /\d+/);
};

export const saved = (page: Page) => expect(page.locator('[data-state="saved"]')).toBeVisible();

/** Fails the test if the page logged a React hydration problem. */
export const watchHydration = (page: Page): string[] => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (/hydrat/i.test(m.text()) && ['error', 'warning'].includes(m.type()))
      problems.push(m.text());
  });
  page.on('pageerror', (e) => {
    if (/hydrat/i.test(e.message)) problems.push(e.message);
  });
  return problems;
};

/** Unique per run, so a test is repeatable against a database earlier runs already edited. */
export const RUN = Date.now().toString(36);
