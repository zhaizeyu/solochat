import { test, expect, devices } from '@playwright/test';
import { registerAndLogin, uniqueUser } from './helpers.js';

test.use({ ...devices['iPhone 14'] });

test('mobile users can upload and replace a large camera image', async ({ page }) => {
  await registerAndLogin(page, uniqueUser('avatar'));

  const png = await page.screenshot();
  // A valid PNG may contain trailing bytes. Padding models the payload size of a phone photo.
  const cameraImage = Buffer.concat([png, Buffer.alloc(4 * 1024 * 1024)]);
  const input = page.locator('.avatar-upload input[type="file"]');
  const avatar = page.locator('.profile-row img.avatar');

  await input.setInputFiles({ name: 'IMG_0001.png', mimeType: 'image/png', buffer: cameraImage });
  await expect(avatar).toBeVisible();
  const firstSrc = await avatar.getAttribute('src');

  await input.setInputFiles({ name: 'IMG_0002.png', mimeType: 'image/png', buffer: cameraImage });
  await expect(avatar).not.toHaveAttribute('src', firstSrc);
});
