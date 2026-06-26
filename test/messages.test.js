import assert from 'node:assert/strict';
import test from 'node:test';
import { addContact, call, hasDatabase, register, sendMessage, state } from '../test-support/helpers.js';

test('non-contacts cannot send or read messages', { skip: !hasDatabase }, async () => {
  const alice = await register('messages_block_a');
  const bob = await register('messages_block_b');

  const send = await call(state.handleMessages, {
    method: 'POST',
    path: '/api/messages',
    user: alice,
    body: { toId: bob.id, text: 'blocked' }
  });
  assert.equal(send.status, 404);

  const read = await call(state.handleMessages, {
    path: `/api/messages/${bob.id}`,
    user: alice
  });
  assert.equal(read.status, 404);
});

test('contacts can exchange messages, read them, and receive chronological history', { skip: !hasDatabase }, async () => {
  const alice = await register('messages_a');
  const bob = await register('messages_b');
  await addContact(alice, bob.username);

  const first = await sendMessage(alice, bob.id, 'first');
  const second = await sendMessage(bob, alice.id, 'second');

  const history = await call(state.handleMessages, {
    path: `/api/messages/${bob.id}`,
    user: alice,
    url: new URL(`http://localhost/api/messages/${bob.id}?limit=10`)
  });
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.messages.map((message) => message.text), ['first', 'second']);

  const read = await call(state.handleMessages, {
    method: 'POST',
    path: `/api/messages/${bob.id}/read`,
    user: alice
  });
  assert.equal(read.status, 200);
  assert.ok(read.body.readAt);

  assert.equal((await state.getMessageById(first.id)).readAt, null);
  assert.ok((await state.getMessageById(second.id)).readAt);
});

test('recall only works for the sender and updates quoted previews', { skip: !hasDatabase }, async () => {
  const alice = await register('messages_recall_a');
  const bob = await register('messages_recall_b');
  await addContact(alice, bob.username);

  const original = await sendMessage(alice, bob.id, 'quote me');
  const reply = await sendMessage(bob, alice.id, 'replying', { quoteId: original.id });

  const blocked = await call(state.handleMessages, {
    method: 'PATCH',
    path: `/api/messages/${original.id}/recall`,
    user: bob
  });
  assert.equal(blocked.status, 404);

  const recalled = await call(state.handleMessages, {
    method: 'PATCH',
    path: `/api/messages/${original.id}/recall`,
    user: alice
  });
  assert.equal(recalled.status, 200);
  assert.equal(recalled.body.message.text, '');
  assert.ok(recalled.body.message.recalledAt);

  const updatedReply = await state.getMessageById(reply.id);
  assert.equal(updatedReply.quote.text, '消息已撤回');
  assert.ok(updatedReply.quote.recalledAt);
});

test('recall rejects messages outside the recall window', { skip: !hasDatabase }, async () => {
  const alice = await register('messages_old_a');
  const bob = await register('messages_old_b');
  await addContact(alice, bob.username);
  const message = await sendMessage(alice, bob.id, 'too old');

  await state.getDb()
    .prepare('UPDATE messages SET created_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 9 * 60 * 1000).toISOString(), message.id);

  const recalled = await call(state.handleMessages, {
    method: 'PATCH',
    path: `/api/messages/${message.id}/recall`,
    user: alice
  });
  assert.equal(recalled.status, 400);
});

test('quoted sticker previews do not persist long sticker names', { skip: !hasDatabase }, async () => {
  const alice = await register('msg_sticker_a');
  const bob = await register('msg_sticker_b');
  await addContact(alice, bob.username);

  const created = await call(state.handleStickers, {
    method: 'POST',
    path: '/api/stickers',
    user: alice,
    body: {
      name: 'a very long screenshot generated description that should not appear after the quoted sticker image',
      imageDataUrl: `${process.env.R2_PUBLIC_BASE_URL.replace(/\/+$/, '')}/stickers/quoted-long-name.png`
    }
  });
  assert.equal(created.status, 201);

  const stickerMessage = await sendMessage(alice, bob.id, '', {
    kind: 'sticker',
    stickerId: created.body.sticker.id
  });
  const reply = await sendMessage(bob, alice.id, 'replying', { quoteId: stickerMessage.id });

  assert.equal(reply.quote.kind, 'sticker');
  assert.equal(reply.quote.text, '[表情包]');
  assert.equal(reply.quote.sticker.name, '表情包');
});
