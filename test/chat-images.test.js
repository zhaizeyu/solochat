import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  addContact,
  call,
  hasDatabase,
  register,
  sendMessage,
  state
} from '../test-support/helpers.js';

const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const runId = `${process.pid}_${Date.now()}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(-10);
let userCounter = 0;
let expireDueChatImages;
let ensureMessageImageState;
let chatImageExpiresAt;
let nextChatImageCleanupAt;

function testUsername(prefix = 'cimg') {
  userCounter += 1;
  return `${prefix}${userCounter}_${runId}`.slice(0, 20);
}

function b64(bytes) {
  return crypto.randomBytes(bytes).toString('base64');
}

function userWrappedKey(overrides = {}) {
  return {
    wrappedKey: b64(48),
    wrapAlgorithm: 'AES-256-GCM',
    wrapIv: b64(12),
    kdfAlgorithm: 'Argon2id',
    kdfSalt: b64(16),
    kdfParameters: { memoryKiB: 65536, iterations: 3, parallelism: 1 },
    keyVersion: 1,
    ...overrides
  };
}

test.before(async () => {
  if (!hasDatabase) return;
  ({
    expireDueChatImages,
    ensureMessageImageState,
    chatImageExpiresAt,
    nextChatImageCleanupAt
  } = await import('../server/chat-images.js'));
});

test('chat images expire at next-day cleanup and share a daily schedule', { skip: !hasDatabase }, async () => {
  // Same calendar day → same next-day 04:00 Asia/Shanghai expiry.
  const morning = chatImageExpiresAt(new Date('2026-08-23T01:00:00+08:00'));
  const evening = chatImageExpiresAt(new Date('2026-08-23T23:30:00+08:00'));
  assert.equal(morning, evening);
  assert.equal(
    new Date(morning).toLocaleString('en-CA', { timeZone: 'Asia/Shanghai', hourCycle: 'h23' }),
    '2026-08-24, 04:00:00'
  );

  const beforeCleanup = new Date('2026-08-23T03:30:00+08:00');
  const nextSameDay = nextChatImageCleanupAt(beforeCleanup);
  assert.equal(
    nextSameDay.toLocaleString('en-CA', { timeZone: 'Asia/Shanghai', hourCycle: 'h23' }),
    '2026-08-23, 04:00:00'
  );

  const afterCleanup = new Date('2026-08-23T04:30:00+08:00');
  const nextNextDay = nextChatImageCleanupAt(afterCleanup);
  assert.equal(
    nextNextDay.toLocaleString('en-CA', { timeZone: 'Asia/Shanghai', hourCycle: 'h23' }),
    '2026-08-24, 04:00:00'
  );
});

test('contacts can send temporary chat images under 2MB', { skip: !hasDatabase }, async () => {
  const alice = await register(testUsername());
  const bob = await register(testUsername());
  await addContact(alice, bob.username);

  const message = await sendMessage(alice, bob.id, '', {
    kind: 'image',
    imageDataUrl: tinyPng
  });

  assert.equal(message.kind, 'image');
  assert.equal(message.text, '[图片]');
  assert.ok(message.imageDataUrl);
  assert.ok(message.imageExpiresAt);
  assert.equal(message.imageExpired, false);

  const history = await call(state.handleMessages, {
    path: `/api/messages/${bob.id}`,
    user: alice,
    url: new URL(`http://localhost/api/messages/${bob.id}?limit=10`)
  });
  assert.equal(history.status, 200);
  const loaded = history.body.messages.find((item) => item.id === message.id);
  assert.equal(loaded.kind, 'image');
  assert.ok(loaded.imageDataUrl);
});

test('oversized chat images are rejected', { skip: !hasDatabase }, async () => {
  const alice = await register(testUsername());
  const bob = await register(testUsername());
  await addContact(alice, bob.username);

  const huge = `data:image/jpeg;base64,${'A'.repeat(3_000_000)}`;
  const result = await call(state.handleMessages, {
    method: 'POST',
    path: '/api/messages',
    user: alice,
    body: { toId: bob.id, kind: 'image', imageDataUrl: huge }
  });
  assert.equal(result.status, 400);
});

test('expired chat images are deleted and show placeholder', { skip: !hasDatabase }, async () => {
  const alice = await register(testUsername());
  const bob = await register(testUsername());
  await addContact(alice, bob.username);

  const message = await sendMessage(alice, bob.id, '', {
    kind: 'image',
    imageDataUrl: tinyPng
  });

  const past = new Date(Date.now() - 60_000).toISOString();
  await state.getDb()
    .prepare('UPDATE messages SET image_expires_at = ? WHERE id = ?')
    .run(past, message.id);

  const expired = await expireDueChatImages({ limit: 50 });
  assert.ok(expired.deleted >= 1);

  const row = await state.getMessageById(message.id);
  assert.ok(row.imageDeletedAt);
  assert.equal(row.text, '[图片已过期删除]');

  const ensured = await ensureMessageImageState(row);
  assert.equal(ensured.imageExpired, true);
  assert.equal(ensured.imageDataUrl, '');

  const history = await call(state.handleMessages, {
    path: `/api/messages/${bob.id}`,
    user: alice,
    url: new URL(`http://localhost/api/messages/${bob.id}?limit=10`)
  });
  const loaded = history.body.messages.find((item) => item.id === message.id);
  assert.equal(loaded.imageExpired, true);
  assert.equal(loaded.imageDataUrl, '');
  assert.match(loaded.text, /过期/);
});

test('recalling an image message removes stored file', { skip: !hasDatabase }, async () => {
  const alice = await register(testUsername());
  const bob = await register(testUsername());
  await addContact(alice, bob.username);

  const message = await sendMessage(alice, bob.id, '', {
    kind: 'image',
    imageDataUrl: tinyPng
  });

  const recalled = await call(state.handleMessages, {
    method: 'PATCH',
    path: `/api/messages/${message.id}/recall`,
    user: alice
  });
  assert.equal(recalled.status, 200);
  assert.ok(recalled.body.message.recalledAt);

  const row = await state.getMessageById(message.id);
  assert.ok(row.imageDeletedAt || row.recalledAt);
});

test('secure chat can attach temporary images on encrypted messages', { skip: !hasDatabase }, async () => {
  const alice = await register(testUsername());
  const bob = await register(testUsername());
  await addContact(alice, bob.username);

  const invited = await call(state.handleSecureConversations, {
    method: 'POST',
    path: '/api/secure-conversations/invite',
    user: alice,
    body: {
      contactId: bob.id,
      publicKey: b64(91),
      wrappedPrivateKey: userWrappedKey()
    }
  });
  assert.equal(invited.status, 201);
  const conversationId = invited.body.conversationId;

  await call(state.handleSecureConversations, {
    method: 'POST',
    path: '/api/secure-conversations/accept',
    user: bob,
    body: {
      conversationId,
      publicKey: b64(91),
      userWrappedKey: userWrappedKey()
    }
  });

  await call(state.handleSecureConversations, {
    method: 'POST',
    path: '/api/secure-conversations/complete',
    user: alice,
    body: {
      conversationId,
      userWrappedKey: userWrappedKey()
    }
  });

  const blockedPlain = await call(state.handleMessages, {
    method: 'POST',
    path: '/api/messages',
    user: alice,
    body: { toId: bob.id, kind: 'image', imageDataUrl: tinyPng }
  });
  assert.equal(blockedPlain.status, 409);

  const sent = await call(state.handleSecureConversations, {
    method: 'POST',
    path: '/api/messages/encrypted',
    user: alice,
    body: {
      toId: bob.id,
      messageId: crypto.randomUUID(),
      ciphertext: b64(80),
      iv: b64(12),
      sequenceNumber: 1,
      cryptoVersion: 2,
      keyVersion: 1,
      imageDataUrl: tinyPng
    }
  });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.ok(sent.body.message.imageDataUrl);
  assert.ok(sent.body.message.imageExpiresAt);
  assert.equal(sent.body.message.imageExpired, false);

  const listed = await call(state.handleSecureConversations, {
    path: '/api/messages/encrypted',
    user: bob,
    url: new URL(`http://localhost/api/messages/encrypted?contactId=${alice.id}`)
  });
  assert.equal(listed.status, 200);
  const found = listed.body.messages.find((item) => item.id === sent.body.message.id);
  assert.ok(found);
  assert.ok(found.imageDataUrl);
  assert.equal(found.imageExpired, false);
});
