import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import * as XLSX from 'xlsx';
import path from 'path';

const workbook = XLSX.readFile(path.join(__dirname, '../data/login-cases.xlsx'));
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const loginCases = XLSX.utils.sheet_to_json<{ username: string; password: string; expectSuccess: boolean }>(sheet);

loginCases.forEach(({ username, password, expectSuccess }, index) => {
  test(`[${index}] login with username="${username}" expects ${expectSuccess ? 'success' : 'failure'}`, async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(username, password);

    if (expectSuccess) {
      await expect(page.locator('.flash.success')).toBeVisible();
      await expect(page).toHaveURL(/secure/);
    } else {
      await expect(page.locator('.flash.error')).toBeVisible();
    }
  });
});

test('context isolation - session not leaked across tests', async ({ page }) => {
  // no login performed here — if a previous test's session leaked
  // into this context, we'd land on /secure instead of /login
  await page.goto('/login');
  await expect(page).toHaveURL(/login/);
  await expect(page.locator('h2')).toHaveText('Login Page');
});

test('mocked API failure is handled gracefully', async ({ page }) => {
  await page.route('**/posts/1', route => {
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Internal Server Error' }),
    });
  });

  await page.goto('/login');
  // this test demonstrates interception mechanics;
  // a real assertion here would check how your app's UI
  // responds to the mocked failure (error banner, retry button, etc.)
});

test('handles network timeout gracefully', async ({ page }) => {
  await page.route('**/posts/1', async route => {
    // never resolve — simulates a hung request
    await new Promise(() => {});
  });

  await page.goto('/login');
  // real assertion would check for a loading state or timeout UI
});

test('handles malformed JSON response', async ({ page }) => {
  await page.route('**/posts/1', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{ this is not valid json',
    });
  });

  await page.goto('/login');
  // real assertion would check the app doesn't crash on a JSON.parse failure
});

test('modifies real response before returning it', async ({ page }) => {
  await page.route('**/posts/1', async route => {
    const response = await route.fetch(); // actually hits the real endpoint
    const json = await response.json();
    json.title = 'INTERCEPTED: ' + json.title; // mutate real data
    await route.fulfill({
      response,
      json,
    });
  });

  await page.goto('/login');
  // real assertion would check the modified title appears in UI
});

test('trace demo - deliberately broken selector', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await page.locator('.this-selector-does-not-exist').click();
});

test('visual regression - login form appearance', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await expect(page.locator('#login')).toHaveScreenshot('login-form.png');
});