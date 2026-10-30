import { test, expect } from '@playwright/test';
import { registerAndLogin, uniqueUser } from './helpers.js';

test('low-key themes are selectable and persist', async ({ page }) => {
  await registerAndLogin(page, uniqueUser('theme'));
  await page.getByRole('button', { name: '外观', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: '外观' });
  const uiSelect = dialog.getByRole('region', { name: '界面主题' }).locator('select');
  const bubbleSelect = dialog.getByRole('region', { name: '气泡颜色' }).locator('select');
  const backgroundSelect = dialog.getByRole('region', { name: '聊天背景' }).locator('select');

  for (const select of [uiSelect, bubbleSelect, backgroundSelect]) {
    await expect(select.locator('option[value="office"]')).toHaveCount(1);
    await expect(select.locator('option[value="fog"]')).toHaveCount(1);
    await expect(select.locator('option[value="taupe"]')).toHaveCount(1);
  }

  await uiSelect.selectOption('office');
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--accent')))
    .toBe('#59656d');
  await bubbleSelect.selectOption('fog');
  await expect(dialog.getByText('雾蓝气泡预览')).toBeVisible();
  await backgroundSelect.selectOption('taupe');
  await expect(dialog.getByText('暖灰', { exact: true }).last()).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  const reopened = page.getByRole('dialog', { name: '外观' });
  await expect(reopened.getByRole('region', { name: '界面主题' }).locator('select')).toHaveValue('office');
  await expect(reopened.getByRole('region', { name: '气泡颜色' }).locator('select')).toHaveValue('fog');
  await expect(reopened.getByRole('region', { name: '聊天背景' }).locator('select')).toHaveValue('taupe');
});
