/**
 * Reusable Playwright helpers for doolulu full-app browser tests.
 */

import { expect } from '@playwright/test';

export function uniqueUser(prefix = 'e2e') {
  const stamp = Date.now().toString(36).slice(-6);
  const rand = Math.random().toString(36).slice(2, 5);
  const username = `${prefix}_${stamp}${rand}`.replace(/[^a-z0-9_]/gi, '').slice(0, 20).toLowerCase();
  return {
    username,
    displayName: `${prefix.toUpperCase()}_${stamp}`,
    password: 'TestPass1'
  };
}

export async function acceptDialogs(page) {
  page.on('dialog', async (dialog) => {
    try {
      await dialog.accept();
    } catch {
      // already handled
    }
  });
}

export async function gotoApp(page) {
  await page.goto('/');
  await page.getByRole('heading', { name: 'doolulu' }).waitFor();
}

export async function registerAndLogin(page, user) {
  await gotoApp(page);
  await page.getByRole('tab', { name: '注册' }).click();
  await page.locator('.auth-form label', { hasText: '用户名' }).locator('input').fill(user.username);
  await page.locator('.auth-form label', { hasText: '昵称' }).locator('input').fill(user.displayName);
  await page.locator('.auth-form label', { hasText: '密码' }).locator('input').fill(user.password);
  await page.getByRole('button', { name: '注册并登录' }).click();
  await page.locator('.sidebar').waitFor({ timeout: 60_000 });
  await page.getByText(`@${user.username}`).first().waitFor();
}

export async function loginAs(page, user) {
  await gotoApp(page);
  await page.getByRole('tab', { name: '登录' }).click();
  await page.locator('.auth-form label', { hasText: '用户名' }).locator('input').fill(user.username);
  await page.locator('.auth-form label', { hasText: '密码' }).locator('input').fill(user.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.locator('.sidebar, .admin-shell').first().waitFor({ timeout: 60_000 });
}

export async function logout(page) {
  const button = page.getByRole('button', { name: '退出' });
  if (await button.count()) {
    await button.click();
    await page.getByRole('heading', { name: 'doolulu' }).waitFor();
  }
}

export async function addContact(page, username) {
  await page.locator('.sidebar form input[placeholder*="用户名"]').fill(username);
  await page.locator('.sidebar form button[type="submit"]').click();
  await page.locator('.contact-list').getByText(`@${username}`).waitFor({ timeout: 30_000 });
}

export async function openContact(page, displayNameOrUsername) {
  const row = page.locator('.contact-item').filter({ hasText: displayNameOrUsername }).first();
  await row.locator('button.contact-select').click();
  await page.locator('.composer, .message-list').first().waitFor({ timeout: 30_000 });
}

export async function sendPlainText(page, text) {
  const target = page.getByPlaceholder(/发送给|输入密码解锁后即可发送/);
  await expectEnabledComposer(page);
  await target.fill(text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.locator('.message-stream .message-bubble').filter({ hasText: text }).first().waitFor({ timeout: 30_000 });
}

async function expectEnabledComposer(page) {
  const target = page.getByPlaceholder(/发送给|输入密码解锁后即可发送/);
  await expect(target).toBeEnabled({ timeout: 60_000 });
}

export async function fillSecureDialog(page, fields, confirmLabel = '确定') {
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 60_000 });
  for (const [label, value] of Object.entries(fields)) {
    if (value === '' || value == null) continue;
    const field = dialog.locator('label').filter({ hasText: label }).locator('input, textarea').first();
    if (!(await field.count())) continue;
    const type = await field.getAttribute('type');
    if (type === 'checkbox') {
      if (value) await field.check();
      else await field.uncheck();
    } else {
      await field.fill(String(value));
    }
  }
  // If only password was intended and labeled fields missed, fill first password input
  const passwordInputs = dialog.locator('input[type="password"]');
  const values = Object.values(fields).filter((v) => typeof v === 'string' && v.length > 0);
  if ((await passwordInputs.count()) === 1 && values.length >= 1) {
    const current = await passwordInputs.first().inputValue();
    if (!current) await passwordInputs.first().fill(String(values[0]));
  }
  await dialog.getByRole('button', { name: confirmLabel }).click();
}

export async function openSecurePanel(page) {
  const panel = page.getByRole('complementary', { name: '安全聊天' });
  if (await panel.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: '收回安全设置' }).click();
    await panel.waitFor({ state: 'hidden' }).catch(() => {});
  }
  // exact: true — avoid matching status banners that also contain「安全」
  await page.getByRole('button', { name: '安全', exact: true }).click();
  await panel.waitFor({ timeout: 15_000 });
}

/** Reload app shell and re-open a contact (session stays via localStorage). */
export async function reloadAndOpenContact(page, displayNameOrUsername) {
  // Prefer goto over reload: less likely to hang behind a lingering native dialog.
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.locator('.sidebar').waitFor({ timeout: 60_000 });
  await openContact(page, displayNameOrUsername);
}

export async function openPlanner(page) {
  const panel = page.getByRole('complementary', { name: '两个人的待办' });
  if (await panel.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: '收回待办' }).click();
    await panel.waitFor({ state: 'hidden' }).catch(() => {});
  }
  await page.getByRole('button', { name: /^待办/ }).click();
  await panel.waitFor({ timeout: 15_000 });
}

export async function openMoments(page) {
  const panel = page.getByRole('complementary', { name: '两个人的回忆' });
  if (await panel.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: '收回回忆' }).click();
    await panel.waitFor({ state: 'hidden' }).catch(() => {});
  }
  await page.getByRole('button', { name: /^回忆/ }).click();
  await panel.waitFor({ timeout: 15_000 });
}

export async function waitForAlertHandled(page, action) {
  // dialogs are auto-accepted via acceptDialogs
  await action();
}
