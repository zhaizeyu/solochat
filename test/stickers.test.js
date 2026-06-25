import assert from 'node:assert/strict';
import test from 'node:test';
import { call, count, hasDatabase, register, state } from '../test-support/helpers.js';

function storedImageUrl(name) {
  return `${process.env.R2_PUBLIC_BASE_URL.replace(/\/+$/, '')}/stickers/${name}.png`;
}

test('stickers reject invalid image data', { skip: !hasDatabase }, async () => {
  const user = await register('stickers_invalid');

  const result = await call(state.handleStickers, {
    method: 'POST',
    path: '/api/stickers',
    user,
    body: { name: 'bad', imageDataUrl: 'not-an-image' }
  });
  assert.equal(result.status, 400);
});

test('stickers can be created from stored URLs and listed', { skip: !hasDatabase }, async () => {
  const user = await register('stickers_owner');

  const created = await call(state.handleStickers, {
    method: 'POST',
    path: '/api/stickers',
    user,
    body: { name: 'wave', imageDataUrl: storedImageUrl('wave') }
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.sticker.name, 'wave');

  const list = await call(state.handleStickers, {
    path: '/api/stickers',
    user
  });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.stickers.map((sticker) => sticker.id), [created.body.sticker.id]);
});

test('users can only delete their own stickers', { skip: !hasDatabase }, async () => {
  const owner = await register('sticker_del_owner');
  const other = await register('sticker_del_other');

  const created = await call(state.handleStickers, {
    method: 'POST',
    path: '/api/stickers',
    user: owner,
    body: { name: 'mine', imageDataUrl: storedImageUrl('mine') }
  });
  assert.equal(created.status, 201);

  const blocked = await call(state.handleStickers, {
    method: 'DELETE',
    path: `/api/stickers/${created.body.sticker.id}`,
    user: other
  });
  assert.equal(blocked.status, 404);

  const removed = await call(state.handleStickers, {
    method: 'DELETE',
    path: `/api/stickers/${created.body.sticker.id}`,
    user: owner
  });
  assert.equal(removed.status, 200);
  assert.equal(await count('SELECT COUNT(*)::int AS count FROM stickers WHERE id = ?', created.body.sticker.id), 0);
});
