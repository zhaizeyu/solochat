import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  addContact,
  addMoment,
  call,
  count,
  hasDatabase,
  login,
  register,
  sendMessage,
  state
} from '../test-support/helpers.js';

const runId = `${process.pid}_${Date.now()}`.replace(/[^a-zA-Z0-9_]/g, '_');
let userCounter = 0;

function testUsername(prefix = 'hz') {
  userCounter += 1;
  return `${prefix}${userCounter}_${runId.slice(-8)}`.slice(0, 20);
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

async function openSecureChat(alice, bob, keyVersion = 1) {
  const invited = await call(state.handleSecureConversations, {
    method: 'POST',
    path: '/api/secure-conversations/invite',
    user: alice,
    body: {
      contactId: bob.id,
      publicKey: b64(91),
      wrappedPrivateKey: userWrappedKey({ keyVersion })
    }
  });
  assert.equal(invited.status, 201, JSON.stringify(invited.body));
  const conversationId = invited.body.conversationId;

  const accepted = await call(state.handleSecureConversations, {
    method: 'POST',
    path: '/api/secure-conversations/accept',
    user: bob,
    body: {
      conversationId,
      publicKey: b64(91),
      userWrappedKey: userWrappedKey({ keyVersion })
    }
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));

  const completed = await call(state.handleSecureConversations, {
    method: 'POST',
    path: '/api/secure-conversations/complete',
    user: alice,
    body: {
      conversationId,
      userWrappedKey: userWrappedKey({ keyVersion })
    }
  });
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  return conversationId;
}

async function sendEncrypted(user, toId, sequenceNumber, keyVersion = 1) {
  return call(state.handleSecureConversations, {
    method: 'POST',
    path: '/api/messages/encrypted',
    user,
    body: {
      toId,
      messageId: crypto.randomUUID(),
      ciphertext: b64(32),
      iv: b64(12),
      sequenceNumber,
      cryptoVersion: 2,
      keyVersion
    }
  });
}

test('P0: password change invalidates existing sessions', { skip: !hasDatabase }, async () => {
  const user = await register(testUsername('pw'));
  const first = await login(user.username);
  const second = await login(user.username);

  const changed = await call(state.handleCurrentUser, {
    method: 'POST',
    path: '/api/me/password',
    user: { ...user, token: first.token },
    body: { currentPassword: 'secret1', newPassword: 'secret2' }
  });
  assert.equal(changed.status, 200);

  assert.equal(
    await count('SELECT COUNT(*)::int AS count FROM sessions WHERE user_id = ?', user.id),
    0
  );

  const stale = await state.getAuthUser({
    headers: { authorization: `Bearer ${second.token}` }
  });
  assert.equal(stale, null);

  const newLogin = await login(user.username, 'secret2');
  assert.equal(newLogin.user.id, user.id);
});

test('P0: password change may skip rewrap when current password cannot open wraps', { skip: !hasDatabase }, async () => {
  const alice = await register(testUsername('rw'));
  const bob = await register(testUsername('rw'));
  await addContact(alice, bob.username);
  await openSecureChat(alice, bob);
  const { token } = await login(alice.username);

  // Keys remain wrapped with secret1 material the client never rewraps here.
  const changed = await call(state.handleCurrentUser, {
    method: 'POST',
    path: '/api/me/password',
    user: { ...alice, token },
    body: { currentPassword: 'secret1', newPassword: 'secret2' }
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(changed.body.rewrappedUserKeys, 0);

  const wrapCount = await count(
    'SELECT COUNT(*)::int AS count FROM user_wrapped_conversation_keys WHERE user_id = ?',
    alice.id
  );
  assert.ok(wrapCount > 0);

  const newLogin = await login(alice.username, 'secret2');
  assert.equal(newLogin.user.id, alice.id);
});

test('P0: password change accepts optional rewrap payload when provided', { skip: !hasDatabase }, async () => {
  const alice = await register(testUsername('r2'));
  const bob = await register(testUsername('r2'));
  await addContact(alice, bob.username);
  await openSecureChat(alice, bob);
  const { token } = await login(alice.username);

  const wrap = userWrappedKey({ keyVersion: 1 });
  const ok = await call(state.handleCurrentUser, {
    method: 'POST',
    path: '/api/me/password',
    user: { ...alice, token },
    body: {
      currentPassword: 'secret1',
      newPassword: 'secret2',
      userWrappedKeys: [{
        conversationId: state.conversationKey(alice.id, bob.id),
        ...wrap
      }]
    }
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.rewrappedUserKeys, 1);
});

test('P0: admin password reset invalidates target sessions', { skip: !hasDatabase }, async () => {
  const user = await register(testUsername('ar'));
  const { token } = await login(user.username);

  const reset = await call(state.handleAdmin, {
    method: 'PATCH',
    path: `/api/admin/users/${user.id}/password`,
    user: state.adminUser,
    body: { password: 'resetpass' }
  });
  assert.equal(reset.status, 200);
  assert.equal(
    await count('SELECT COUNT(*)::int AS count FROM sessions WHERE user_id = ?', user.id),
    0
  );
  assert.equal(
    await state.getAuthUser({ headers: { authorization: `Bearer ${token}` } }),
    null
  );
  const again = await login(user.username, 'resetpass');
  assert.equal(again.user.id, user.id);
});

test('P0: admin data cleanup removes secure chat, encrypted messages and moments', { skip: !hasDatabase }, async () => {
  const target = await register(testUsername('cl'));
  const peer = await register(testUsername('cl'));
  await addContact(target, peer.username);
  await sendMessage(target, peer.id, 'plain cleanup');
  const conversationId = await openSecureChat(target, peer);
  const encrypted = await sendEncrypted(target, peer.id, 1);
  assert.equal(encrypted.status, 201, JSON.stringify(encrypted.body));
  await addMoment(target, peer.id, 'moment cleanup');

  const { token } = await login(target.username);
  const selfDelete = await call(state.handleCurrentUser, {
    method: 'DELETE',
    path: '/api/me',
    user: { ...target, token }
  });
  assert.equal(selfDelete.status, 200);

  const cleanup = await call(state.handleAdmin, {
    method: 'DELETE',
    path: `/api/admin/users/${target.id}/data`,
    user: state.adminUser
  });
  assert.equal(cleanup.status, 200);

  assert.equal(await state.getUserById(target.id), null);
  assert.ok(await state.getUserById(peer.id));
  assert.equal(
    await count('SELECT COUNT(*)::int AS count FROM messages WHERE from_id = ? OR to_id = ?', target.id, target.id),
    0
  );
  assert.equal(
    await count(
      'SELECT COUNT(*)::int AS count FROM encrypted_messages WHERE sender_id = ? OR recipient_id = ? OR conversation_id = ?',
      target.id,
      target.id,
      conversationId
    ),
    0
  );
  assert.equal(
    await count('SELECT COUNT(*)::int AS count FROM secure_conversations WHERE conversation_id = ?', conversationId),
    0
  );
  assert.equal(
    await count('SELECT COUNT(*)::int AS count FROM user_wrapped_conversation_keys WHERE user_id = ? OR conversation_id = ?', target.id, conversationId),
    0
  );
  assert.equal(
    await count('SELECT COUNT(*)::int AS count FROM secure_handshake_keys WHERE user_id = ? OR conversation_id = ?', target.id, conversationId),
    0
  );
  assert.equal(
    await count('SELECT COUNT(*)::int AS count FROM couple_moments WHERE author_id = ? OR conversation_id = ?', target.id, conversationId),
    0
  );
});

test('P1: encrypted next-sequence endpoint returns max+1', { skip: !hasDatabase }, async () => {
  const alice = await register(testUsername('sq'));
  const bob = await register(testUsername('sq'));
  await addContact(alice, bob.username);
  await openSecureChat(alice, bob);

  const empty = await call(state.handleSecureConversations, {
    path: '/api/messages/encrypted/next-sequence',
    user: alice,
    url: new URL(`http://localhost/api/messages/encrypted/next-sequence?contactId=${bob.id}&keyVersion=1`)
  });
  assert.equal(empty.status, 200);
  assert.equal(empty.body.nextSequence, 1);

  const first = await sendEncrypted(alice, bob.id, 1);
  assert.equal(first.status, 201);
  const second = await sendEncrypted(alice, bob.id, 7);
  assert.equal(second.status, 201);

  const next = await call(state.handleSecureConversations, {
    path: '/api/messages/encrypted/next-sequence',
    user: alice,
    url: new URL(`http://localhost/api/messages/encrypted/next-sequence?contactId=${bob.id}&keyVersion=1`)
  });
  assert.equal(next.status, 200);
  assert.equal(next.body.nextSequence, 8);
});

test('P1: secure mode still allows plaintext stickers by design', { skip: !hasDatabase }, async () => {
  const alice = await register(testUsername('st'));
  const bob = await register(testUsername('st'));
  await addContact(alice, bob.username);
  await openSecureChat(alice, bob);

  const sticker = await call(state.handleStickers, {
    method: 'POST',
    path: '/api/stickers',
    user: alice,
    body: {
      name: 'hi',
      imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    }
  });
  assert.equal(sticker.status, 201, JSON.stringify(sticker.body));

  const blockedText = await call(state.handleMessages, {
    method: 'POST',
    path: '/api/messages',
    user: alice,
    body: { toId: bob.id, text: 'no plaintext' }
  });
  assert.equal(blockedText.status, 409);

  const stickerMsg = await call(state.handleMessages, {
    method: 'POST',
    path: '/api/messages',
    user: alice,
    body: { toId: bob.id, kind: 'sticker', stickerId: sticker.body.sticker.id }
  });
  assert.equal(stickerMsg.status, 201, JSON.stringify(stickerMsg.body));
  assert.equal(stickerMsg.body.message.kind, 'sticker');
});

test('P1: recalling a message only updates quotes in the same conversation', { skip: !hasDatabase }, async () => {
  const alice = await register(testUsername('rc'));
  const bob = await register(testUsername('rc'));
  const carol = await register(testUsername('rc'));
  await addContact(alice, bob.username);
  await addContact(alice, carol.username);

  const original = await sendMessage(alice, bob.id, 'quote me');
  const quoted = await sendMessage(alice, bob.id, 'reply', { quoteId: original.id });
  const other = await sendMessage(alice, carol.id, 'other thread', {
    quoteId: original.id
  }).catch(() => null);

  // quoteId across conversations may be rejected; seed other-conversation quote manually if needed
  let otherId = other?.id;
  if (!otherId) {
    const now = new Date().toISOString();
    otherId = crypto.randomUUID();
    await state.getDb().prepare(`
      INSERT INTO messages (
        id, conversation_id, from_id, to_id, kind, text, sticker_json, quote_json,
        created_at, read_at, recalled_at
      ) VALUES (?, ?, ?, ?, 'text', 'other', NULL, ?, ?, NULL, NULL)
    `).run(
      otherId,
      state.conversationKey(alice.id, carol.id),
      alice.id,
      carol.id,
      JSON.stringify({ id: original.id, text: 'quote me' }),
      now
    );
  }

  const recall = await call(state.handleMessages, {
    method: 'PATCH',
    path: `/api/messages/${original.id}/recall`,
    user: alice
  });
  assert.equal(recall.status, 200);

  const bobQuote = await state.getDb().prepare('SELECT quote_json AS q FROM messages WHERE id = ?').get(quoted.id);
  assert.match(String(bobQuote.q), /消息已撤回/);

  const carolQuote = await state.getDb().prepare('SELECT quote_json AS q FROM messages WHERE id = ?').get(otherId);
  assert.doesNotMatch(String(carolQuote.q), /消息已撤回/);
});

test('P2: completing secure chat clears handshake private keys', { skip: !hasDatabase }, async () => {
  const alice = await register(testUsername('hs'));
  const bob = await register(testUsername('hs'));
  await addContact(alice, bob.username);
  const conversationId = await openSecureChat(alice, bob);

  const handshakes = await state.getDb().prepare(`
    SELECT COUNT(*)::int AS count FROM secure_handshake_keys WHERE conversation_id = ?
  `).get(conversationId);
  assert.equal(Number(handshakes.count), 0);
});

test('P2: verifyPassword returns false for malformed hashes', { skip: !hasDatabase }, async () => {
  assert.equal(state.verifyPassword('secret', ''), false);
  assert.equal(state.verifyPassword('secret', 'nosalt'), false);
  assert.equal(state.verifyPassword('secret', 'abcd:zz'), false);
  assert.equal(state.verifyPassword('secret', 'ab:cd'), false);
});

test('P2: concurrent-looking unique username conflict returns 409', { skip: !hasDatabase }, async () => {
  const username = testUsername('uq');
  await register(username);

  // Simulate race: bypass active-user check by inserting with same username after soft-forcing
  const raced = await call(state.handlePublicAuth, {
    method: 'POST',
    path: '/api/register',
    body: { username, displayName: username, password: 'secret1' }
  });
  assert.equal(raced.status, 409);
});
