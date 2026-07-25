import { test, expect } from '@playwright/test';
import {
  acceptDialogs,
  addContact,
  fillSecureDialog,
  loginAs,
  logout,
  openContact,
  openMoments,
  openPlanner,
  openSecurePanel,
  registerAndLogin,
  reloadAndOpenContact,
  sendPlainText,
  uniqueUser
} from './helpers.js';

const admin = {
  username: process.env.E2E_ADMIN_USER || 'admin',
  password: process.env.E2E_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'admin123'
};

test.describe.configure({ mode: 'serial' });

test('全功能浏览器测试：双用户 + 管理员 + 注销清理', async ({ browser }) => {
  const alice = uniqueUser('alice');
  const bob = uniqueUser('bob');
  const report = {
    alice: alice.username,
    bob: bob.username,
    steps: []
  };
  const note = (step) => {
    report.steps.push(step);
    console.log(`[E2E] ${step}`);
  };

  const aliceCtx = await browser.newContext({ ignoreHTTPSErrors: true });
  const bobCtx = await browser.newContext({ ignoreHTTPSErrors: true });
  const adminCtx = await browser.newContext({ ignoreHTTPSErrors: true });
  const alicePage = await aliceCtx.newPage();
  const bobPage = await bobCtx.newPage();
  const adminPage = await adminCtx.newPage();
  await acceptDialogs(alicePage);
  await acceptDialogs(bobPage);
  await acceptDialogs(adminPage);

  try {
    // --- 1. 注册并登录 ---
    note('Alice 注册登录');
    await registerAndLogin(alicePage, alice);
    note('Bob 注册登录');
    await registerAndLogin(bobPage, bob);

    // --- 2. 互相加好友 ---
    note('Alice 添加 Bob 为联系人');
    await addContact(alicePage, bob.username);
    note('Bob 添加 Alice 为联系人');
    await addContact(bobPage, alice.username);

    // --- 3. 明文聊天 ---
    note('打开会话并互发明文消息');
    await openContact(alicePage, bob.displayName);
    await openContact(bobPage, alice.displayName);
    const plainA = `hello-from-alice-${Date.now()}`;
    const plainB = `hello-from-bob-${Date.now()}`;
    await sendPlainText(alicePage, plainA);
    await bobPage.locator('.message-stream .message-bubble').filter({ hasText: plainA }).first().waitFor({ timeout: 30_000 });
    await sendPlainText(bobPage, plainB);
    await alicePage.locator('.message-stream .message-bubble').filter({ hasText: plainB }).first().waitFor({ timeout: 30_000 });

    // --- 4. 待办 ---
    note('创建并确认待办');
    await openPlanner(alicePage);
    await alicePage.getByRole('button', { name: '+ 添加计划' }).click();
    await alicePage.getByPlaceholder('写下要一起做的事').fill('周末去公园');
    await alicePage.getByPlaceholder('时间').fill('周六下午');
    await alicePage.getByPlaceholder('地点').fill('中央公园');
    await alicePage.getByRole('button', { name: '添加', exact: true }).click();
    await expect.poll(async () => (
      alicePage.locator('.planner-drawer[aria-label="两个人的待办"] .planner-mini-task').filter({ hasText: '周末去公园' }).count()
    ), { timeout: 30_000 }).toBeGreaterThan(0);
    // Peer side: reopen contact/panel so tasks are refetched (no live push yet).
    await reloadAndOpenContact(bobPage, alice.displayName);
    await openPlanner(bobPage);
    await expect.poll(async () => (
      bobPage.locator('.planner-drawer[aria-label="两个人的待办"] .planner-mini-task').filter({ hasText: '周末去公园' }).count()
    ), { timeout: 30_000 }).toBeGreaterThan(0);
    await alicePage.getByRole('button', { name: '收回待办' }).click().catch(() => {});
    await bobPage.getByRole('button', { name: '收回待办' }).click().catch(() => {});

    // --- 5. 回忆 ---
    note('记录一条回忆');
    await openMoments(alicePage);
    await alicePage.getByRole('button', { name: '+ 记录回忆' }).click();
    await alicePage.getByPlaceholder('写下这一天发生了什么').fill('第一次一起测试');
    await alicePage.getByRole('button', { name: '发布' }).click();
    await expect.poll(async () => (
      alicePage.locator('.moments-drawer .moment-card').filter({ hasText: '第一次一起测试' }).count()
    ), { timeout: 30_000 }).toBeGreaterThan(0);
    await reloadAndOpenContact(bobPage, alice.displayName);
    await openMoments(bobPage);
    await expect.poll(async () => (
      bobPage.locator('.moments-drawer .moment-card').filter({ hasText: '第一次一起测试' }).count()
    ), { timeout: 30_000 }).toBeGreaterThan(0);
    await alicePage.getByRole('button', { name: '收回回忆' }).click().catch(() => {});
    await bobPage.getByRole('button', { name: '收回回忆' }).click().catch(() => {});

    // --- 6. 安全聊天全流程 ---
    note('Alice 邀请开启安全聊天');
    await openSecurePanel(alicePage);
    await alicePage.getByRole('button', { name: '邀请开启' }).click();
    await fillSecureDialog(alicePage, { 登录密码: alice.password }, '确定');
    // Desktop+mobile both mount the panel; prefer a visible action over hidden status text.
    await alicePage.getByRole('button', { name: '取消邀请' }).waitFor({ timeout: 180_000 });

    note('Bob 同意邀请');
    await reloadAndOpenContact(bobPage, alice.displayName);
    await openSecurePanel(bobPage);
    await bobPage.getByRole('button', { name: '同意邀请' }).waitFor({ timeout: 60_000 });
    await bobPage.getByRole('button', { name: '同意邀请' }).click();
    await fillSecureDialog(bobPage, { 登录密码: bob.password }, '确定');
    await bobPage.getByRole('button', { name: /取消邀请|等待/ }).first().waitFor({ timeout: 5_000 }).catch(() => {});
    // After accept, Bob typically sees no "同意邀请" and status updates asynchronously.
    await expect.poll(async () => bobPage.getByRole('button', { name: '同意邀请' }).count(), {
      timeout: 180_000
    }).toBe(0);

    note('Alice 确认开启');
    await reloadAndOpenContact(alicePage, bob.displayName);
    await openSecurePanel(alicePage);
    await alicePage.getByRole('button', { name: '确认开启' }).waitFor({ timeout: 120_000 });
    await alicePage.getByRole('button', { name: '确认开启' }).click();
    await fillSecureDialog(alicePage, { 登录密码: alice.password }, '确定');
    // completeSecureInvite keeps Alice unlocked in-memory.
    await alicePage.getByRole('button', { name: '申请关闭' }).waitFor({ timeout: 180_000 });
    await alicePage.getByRole('button', { name: '收回安全设置' }).click().catch(() => {});

    note('Bob 解锁会话');
    await reloadAndOpenContact(bobPage, alice.displayName);
    await openSecurePanel(bobPage);
    const bobUnlock = bobPage.getByRole('button', { name: '解锁会话' });
    const bobCloseRequest = bobPage.getByRole('button', { name: '申请关闭' });
    // Accept may leave roots in memory; reload usually clears them. Handle both states.
    if (await bobUnlock.isVisible().catch(() => false)) {
      await bobUnlock.click();
      await fillSecureDialog(bobPage, {
        封装密码: bob.password,
        '当前登录密码（与上面相同时可留空）': ''
      }, '确定');
    }
    await bobCloseRequest.waitFor({ timeout: 180_000 });
    await bobPage.getByRole('button', { name: '收回安全设置' }).click().catch(() => {});

    note('双方发送加密消息');
    const secureMsg = `secure-hi-${Date.now()}`;
    await sendPlainText(alicePage, secureMsg);
    await bobPage.locator('.message-stream .message-bubble').filter({ hasText: secureMsg }).first().waitFor({ timeout: 60_000 });

    note('双方确认关闭安全聊天');
    await openSecurePanel(alicePage);
    await alicePage.getByRole('button', { name: '申请关闭' }).click();
    await fillSecureDialog(alicePage, { '我知道需要保留当时的登录密码才能查看历史加密消息': true }, '申请关闭');
    await reloadAndOpenContact(bobPage, alice.displayName);
    await openSecurePanel(bobPage);
    await bobPage.getByRole('button', { name: '确认关闭' }).waitFor({ timeout: 60_000 });
    await bobPage.getByRole('button', { name: '确认关闭' }).click();
    await fillSecureDialog(bobPage, { '我知道需要保留当时的登录密码才能查看历史加密消息': true }, '确认关闭');
    await alicePage.getByRole('button', { name: '收回安全设置' }).click().catch(() => {});
    await bobPage.getByRole('button', { name: '收回安全设置' }).click().catch(() => {});

    // --- 7. 改密码（Alice） ---
    note('Alice 修改登录密码');
    await alicePage.getByRole('button', { name: '改密码' }).click();
    await fillSecureDialog(alicePage, {
      当前密码: alice.password,
      新密码: 'TestPass2',
      确认新密码: 'TestPass2'
    }, '保存');
    alice.password = 'TestPass2';
    // after password change, session cleared → auth screen
    await alicePage.getByRole('heading', { name: 'doolulu' }).waitFor({ timeout: 60_000 });
    await loginAs(alicePage, alice);
    await openContact(alicePage, bob.displayName);

    // --- 8. 管理员操作 ---
    note('管理员登录并筛选用户');
    await loginAs(adminPage, admin);
    await expect(adminPage.getByRole('heading', { name: '管理员' })).toBeVisible();
    await adminPage.getByPlaceholder('用户名 / 昵称').fill(alice.username);
    await expect(adminPage.locator('.admin-user').filter({ hasText: alice.username })).toHaveCount(1, { timeout: 15_000 });

    note('管理员重置 Bob 密码');
    await adminPage.getByPlaceholder('用户名 / 昵称').fill(bob.username);
    const bobCard = adminPage.locator('.admin-user').filter({ hasText: bob.username });
    await expect(bobCard).toHaveCount(1, { timeout: 15_000 });
    await bobCard.getByPlaceholder('新密码').fill('ResetPass9');
    await bobCard.getByRole('button', { name: '重置密码' }).click();
    bob.password = 'ResetPass9';
    await expect(adminPage.locator('.success-line')).toContainText(/已重置/, { timeout: 30_000 });

    note('Bob 用新密码重新登录');
    await logout(bobPage);
    await loginAs(bobPage, bob);
    await openContact(bobPage, alice.displayName);

    // --- 9. 注销两个测试用户 ---
    note('Alice 注销账号');
    await alicePage.getByRole('button', { name: '注销' }).click();
    // confirm dialog auto-accepted
    await alicePage.getByRole('heading', { name: 'doolulu' }).waitFor({ timeout: 60_000 });

    note('Bob 注销账号');
    await bobPage.getByRole('button', { name: '注销' }).click();
    await bobPage.getByRole('heading', { name: 'doolulu' }).waitFor({ timeout: 60_000 });

    // --- 10. 管理员清理已注销用户数据 ---
    note('管理员清理 Alice / Bob 数据');
    await adminPage.getByRole('button', { name: '刷新' }).click();
    await adminPage.locator('select').selectOption('disabled');
    for (const username of [alice.username, bob.username]) {
      await adminPage.getByPlaceholder('用户名 / 昵称').fill(username);
      const card = adminPage.locator('.admin-user').filter({ hasText: username });
      await expect(card).toHaveCount(1, { timeout: 15_000 });
      await card.getByRole('button', { name: '清理数据' }).click();
      await expect(adminPage.locator('.success-line')).toContainText(/已清理/, { timeout: 30_000 });
    }

    await adminPage.getByPlaceholder('用户名 / 昵称').fill(alice.username);
    await expect(adminPage.locator('.admin-user').filter({ hasText: alice.username })).toHaveCount(0);
    await adminPage.getByPlaceholder('用户名 / 昵称').fill(bob.username);
    await expect(adminPage.locator('.admin-user').filter({ hasText: bob.username })).toHaveCount(0);

    note('全流程完成');
    console.log('[E2E] REPORT', JSON.stringify(report, null, 2));
  } finally {
    await Promise.allSettled([aliceCtx.close(), bobCtx.close(), adminCtx.close()]);
  }
});
