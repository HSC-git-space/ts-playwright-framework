import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

test('valid login succeeds', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login('tomsmith', 'SuperSecretPassword!');
  await expect(page.locator('.flash.success')).toBeVisible();
  await expect(page).toHaveURL(/secure/);
});

test('invalid login shows error', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login('wronguser', 'wrongpass');
  await expect(page.locator('.flash.error')).toBeVisible();
});