import assert from 'node:assert/strict';
import test from 'node:test';
import { call, hasDatabase, register, state } from '../test-support/helpers.js';

const runId = `${process.pid}${Date.now().toString(36)}`.slice(-6);
let seq = 0;
function uname(prefix) {
  seq += 1;
  return `${prefix}${seq}${runId}`.replace(/[^a-z0-9_]/gi, '').toLowerCase().slice(0, 20);
}

const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function patchMe(user, body) {
  return call(state.handleCurrentUser, {
    method: 'PATCH',
    path: '/api/me',
    user,
    body
  });
}

test('normalize style helpers map legacy and dye values onto shared presets', async () => {
  const {
    normalizeBubbleTheme,
    normalizeChatBgPreset,
    normalizeUiTheme
  } = await import('../server/config.js');

  assert.equal(normalizeUiTheme('mint'), 'mint');
  assert.equal(normalizeUiTheme('rose'), 'blush');
  assert.equal(normalizeUiTheme('azure'), 'ocean');
  assert.equal(normalizeUiTheme('amber'), 'sand');
  assert.equal(normalizeUiTheme('slate'), 'dark');
  assert.equal(normalizeUiTheme('soft'), 'mint');
  assert.equal(normalizeUiTheme('dye:#000000'), 'dark');
  assert.equal(normalizeUiTheme('dye:#12b886'), 'mint');
  assert.equal(normalizeUiTheme('nope'), 'mint');

  assert.equal(normalizeChatBgPreset('paper'), 'sand');
  assert.equal(normalizeChatBgPreset('dusk'), 'blush');
  assert.equal(normalizeChatBgPreset('ocean'), 'ocean');
  assert.equal(normalizeChatBgPreset('plain'), 'mint');

  assert.equal(normalizeBubbleTheme('pink'), 'blush');
  assert.equal(normalizeBubbleTheme('sky'), 'ocean');
  assert.equal(normalizeBubbleTheme('lavender'), 'blush');
  assert.equal(normalizeBubbleTheme('dark'), 'dark');
  assert.equal(normalizeBubbleTheme('dye:#ff7ab6'), 'blush');
  assert.equal(normalizeBubbleTheme('dye:#000000'), 'dark');
});

test('user can update ui theme, bubble theme and chat background presets', { skip: !hasDatabase }, async () => {
  const user = await register(uname('app'));

  const ui = await patchMe(user, { uiTheme: 'ocean' });
  assert.equal(ui.status, 200);
  assert.equal(ui.body.user.uiTheme, 'ocean');

  const bubble = await patchMe(ui.body.user, { bubbleTheme: 'blush' });
  assert.equal(bubble.status, 200);
  assert.equal(bubble.body.user.bubbleTheme, 'blush');
  assert.equal(bubble.body.user.uiTheme, 'ocean');

  const bg = await patchMe(bubble.body.user, { chatBgPreset: 'sand' });
  assert.equal(bg.status, 200);
  assert.equal(bg.body.user.chatBgPreset, 'sand');
  assert.equal(bg.body.user.chatBgDataUrl || '', '');
  assert.equal(bg.body.user.uiTheme, 'ocean');
  assert.equal(bg.body.user.bubbleTheme, 'blush');

  const stored = await state.getUserById(user.id);
  assert.equal(stored.uiTheme, 'ocean');
  assert.equal(stored.bubbleTheme, 'blush');
  assert.equal(stored.chatBgPreset, 'sand');
});

test('appearance APIs accept legacy aliases and reject unknown presets', { skip: !hasDatabase }, async () => {
  const user = await register(uname('apl'));

  const legacyUi = await patchMe(user, { uiTheme: 'violet' });
  assert.equal(legacyUi.status, 200);
  assert.equal(legacyUi.body.user.uiTheme, 'blush');

  const legacyBg = await patchMe(user, { chatBgPreset: 'soft' });
  assert.equal(legacyBg.status, 200);
  assert.equal(legacyBg.body.user.chatBgPreset, 'mint');

  const legacyBubble = await patchMe(user, { bubbleTheme: 'peach' });
  assert.equal(legacyBubble.status, 200);
  assert.equal(legacyBubble.body.user.bubbleTheme, 'blush');

  const badUi = await patchMe(user, { uiTheme: 'neon-disco' });
  assert.equal(badUi.status, 400);

  const badBubble = await patchMe(user, { bubbleTheme: 'neon-disco' });
  assert.equal(badBubble.status, 400);

  const badBg = await patchMe(user, { chatBgPreset: 'neon-disco' });
  assert.equal(badBg.status, 400);
});

test('custom chat background image can be set and cleared by preset', { skip: !hasDatabase }, async () => {
  const user = await register(uname('apb'));

  const uploaded = await patchMe(user, { chatBgDataUrl: tinyPng });
  assert.equal(uploaded.status, 200);
  assert.ok(uploaded.body.user.chatBgDataUrl);
  assert.equal(uploaded.body.user.chatBgPreset, 'mint');

  const cleared = await patchMe(user, { chatBgPreset: 'ocean' });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.user.chatBgPreset, 'ocean');
  assert.equal(cleared.body.user.chatBgDataUrl || '', '');
});

test('user can update profile bio and display name', { skip: !hasDatabase }, async () => {
  const user = await register(uname('apr'));

  const updated = await patchMe(user, {
    displayName: '外观测试',
    bio: 'hello bio'
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.user.displayName, '外观测试');
  assert.equal(updated.body.user.bio, 'hello bio');

  const tooLong = await patchMe(user, { bio: 'x'.repeat(121) });
  assert.equal(tooLong.status, 400);
});
