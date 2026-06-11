import { expect, test } from '@playwright/test';

const loginPassword = process.env.CUBBY_E2E_AUTH_PASSWORD ?? process.env.CUBBY_AUTH_PASSWORD;

test.describe('Cubby auth', () => {
  test.skip(!loginPassword, 'Set CUBBY_E2E_AUTH_PASSWORD or CUBBY_AUTH_PASSWORD to run auth E2E');

  test('password login unlocks the app shell', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Cubby' })).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

    await page.getByLabel('Password').fill(loginPassword ?? '');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('button', { name: 'New Session' })).toBeVisible();
    await expect(page.locator('text=Select or create a session')).toBeVisible();
  });
});
