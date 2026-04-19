import { test, expect } from '@playwright/test';

test.describe('Smoke tests', () => {
  test('root redirects to /main and shows the downloader card', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL(/\/main/);
    await expect(page.getByRole('heading', { name: /YouTube Video Downloader/i })).toBeVisible();
    await expect(page.getByPlaceholder(/Paste YouTube video URL/i)).toBeVisible();
  });

  test('theme toggle is present in navbar', async ({ page }) => {
    await page.goto('/main');
    const toggle = page.locator('button').filter({ has: page.locator('svg.lucide-moon, svg.lucide-sun') });
    await expect(toggle.first()).toBeVisible();
  });

  test('privacy and terms pages render', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { name: /Privacy Policy/i })).toBeVisible();

    await page.goto('/terms');
    await expect(page.getByRole('heading', { name: /Terms of Service/i })).toBeVisible();
  });
});
