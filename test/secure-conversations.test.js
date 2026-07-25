import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { addContact, call, hasDatabase, register, sendMessage, state } from '../test-support/helpers.js';

const runId = `${process.pid}_${Date.now()}`.replace(/[^a-zA-Z0-9_]/g, '_');
let userCounter = 0;

function testUsername() {
  userCounter += 1;
  return `sec${userCounter}_${runId.slice(-10)}`.slice(0, 20);
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

function handshakePublicKey() {
  return b64(91);
}

async function inviteSecureChat(alice, bob, keyVersion = 1) {
  const invited = await call(state.handleSecureConversations, {
    method: 'POST',
    path: '/api/secure-conversations/invite',
    user: alice,
    body: {
      contactId: bob.id,
      publicKey: handshakePublicKey(),
      wrappedPrivateKey: userWrappedKey({ keyVersion })
    }
  });
  assert.equal(invited.status, 201, JSON.stringify(invited.body));
  return invited.body.conversationId;
}

async function acceptSecureChat(bob, conversationId, keyVersion = 1) {
  const accepted = await call(state.handleSecureConversations, {
    method: 'POST',
    path: '/api/secure-conversations/accept',
    user: bob,
    body: {
      conversationId,
      publicKey: handshakePublicKey(),
      userWrappedKey: userWrappedKey({ keyVersion })
    }
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  return accepted.body;
}

async function completeSecureChat(alice, conversationId, keyVersion = 1) {
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
  assert.equal(completed.body.status, 'enabled');
}

async function openSecureChat(alice, bob, keyVersion = 1) {
  const conversationId = await inviteSecureChat(alice, bob, keyVersion);
  await acceptSecureChat(bob, conversationId, keyVersion);
  await completeSecureChat(alice, conversationId, keyVersion);
  return conversationId;
}

async function bilateralClose(alice, bob, conversationId) {
  const requested = await call(state.handleSecureConversations, {
    method: 'POST',
    path: '/api/secure-conversations/close/request',
    user: alice,
    body: { conversationId }
  });
  assert.equal(requested.status, 200);
  assert.equal(requested.body.status, 'closing');

  const selfConfirm = await call(state.handleSecureConversations, {
    method: 'POST',
    path: '/api/secure-conversations/close/confirm',
    user: alice,
    body: { conversationId }
  });
  assert.equal(selfConfirm.status, 403);

  const confirmed = await call(state.handleSecureConversations, {
    method: 'POST',
    path: '/api/secure-conversations/close/confirm',
    user: bob,
    body: { conversationId }
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.status, 'off');
}

test('secure chat invite stores handshake and blocks plaintext message fallback', { skip: !hasDatabase }, async () => {
  const alice = await register(testUsername());
  const bob = await register(testUsername());
  await addContact(alice, bob.username);

  const conversationId = await inviteSecureChat(alice, bob);
  const row = await state.getDb().prepare('SELECT * FROM secure_conversations WHERE conversation_id = ?').get(conversationId);
  assert.equal(row.status, 'waiting_peer');
  assert.equal(row.enabled, false);
  assert.equal(row.recovery_owner_user_id, alice.id);

  const handshake = await state.getDb().prepare(`
    SELECT public_key, kdf_salt FROM secure_handshake_keys
    WHERE conversation_id = ? AND user_id = ?
  `).get(conversationId, alice.id);
  assert.ok(handshake.public_key);
  assert.ok(handshake.kdf_salt);

  const blocked = await call(state.handleMessages, {
    method: 'POST',
    path: '/api/messages',
    user: alice,
    body: { toId: bob.id, text: 'should not be stored as plaintext' }
  });
  assert.equal(blocked.status, 409);
});

test('encrypted messages stay blocked until invite is fully completed', { skip: !hasDatabase }, async () => {
  const alice = await register(testUsername());
  const bob = await register(testUsername());
  await addContact(alice, bob.username);

  const conversationId = await inviteSecureChat(alice, bob);
  const pendingAlice = await call(state.handleSecureConversations, {
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
      keyVersion: 1
    }
  });
  assert.equal(pendingAlice.status, 403);

  await acceptSecureChat(bob, conversationId);
  await completeSecureChat(alice, conversationId);

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
      keyVersion: 1
    }
  });
  assert.equal(sent.status, 201);
});

test('key material reports historical keys after bilateral close', { skip: !hasDatabase }, async () => {
  const alice = await register(testUsername());
  const bob = await register(testUsername());
  await addContact(alice, bob.username);
  const conversationId = await openSecureChat(alice, bob);

  await call(state.handleSecureConversations, {
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
      keyVersion: 1
    }
  });

  await bilateralClose(alice, bob, conversationId);

  const material = await call(state.handleSecureConversations, {
    path: `/api/secure-conversations/${encodeURIComponent(conversationId)}/key-material`,
    user: alice
  });
  assert.equal(material.status, 200);
  assert.equal(material.body.conversation.status, 'off');
  assert.equal(material.body.hasHistoricalKeys, true);
  assert.equal(material.body.historicalUserWrappedKeys.length, 1);
  assert.equal(material.body.conversation.nextKeyVersion, 2);

  const wraps = await state.getDb().prepare(`
    SELECT COUNT(*)::int AS count FROM user_wrapped_conversation_keys WHERE conversation_id = ?
  `).get(conversationId);
  assert.equal(wraps.count, 2);

  const encrypted = await state.getDb().prepare(`
    SELECT COUNT(*)::int AS count FROM encrypted_messages WHERE conversation_id = ?
  `).get(conversationId);
  assert.equal(encrypted.count, 1);

  const plainOk = await sendMessage(alice, bob.id, 'plain after close');
  assert.equal(plainOk.text, 'plain after close');
});

test('close request can be cancelled by either party and stays waiting forever otherwise', { skip: !hasDatabase }, async () => {
  const alice = await register(testUsername());
  const bob = await register(testUsername());
  await addContact(alice, bob.username);
  const conversationId = await openSecureChat(alice, bob);

  const requested = await call(state.handleSecureConversations, {
    method: 'POST',
    path: '/api/secure-conversations/close/request',
    user: alice,
    body: { conversationId }
  });
  assert.equal(requested.status, 200);

  const cancelled = await call(state.handleSecureConversations, {
    method: 'POST',
    path: '/api/secure-conversations/close/cancel',
    user: bob,
    body: { conversationId }
  });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.status, 'enabled');

  const row = await state.getDb().prepare('SELECT * FROM secure_conversations WHERE conversation_id = ?').get(conversationId);
  assert.equal(row.status, 'enabled');
  assert.equal(row.enabled, true);
});

test('re-invite after close increments key version and keeps old wraps', { skip: !hasDatabase }, async () => {
  const alice = await register(testUsername());
  const bob = await register(testUsername());
  await addContact(alice, bob.username);
  const conversationId = await openSecureChat(alice, bob, 1);
  await bilateralClose(alice, bob, conversationId);

  await openSecureChat(alice, bob, 2);

  const wraps = await state.getDb().prepare(`
    SELECT key_version FROM user_wrapped_conversation_keys
    WHERE conversation_id = ? AND user_id = ?
    ORDER BY key_version
  `).all(conversationId, alice.id);
  assert.deepEqual(wraps.map((row) => row.key_version), [1, 2]);

  const row = await state.getDb().prepare('SELECT * FROM secure_conversations WHERE conversation_id = ?').get(conversationId);
  assert.equal(row.current_key_version, 2);
  assert.equal(row.status, 'enabled');
});

test('direct delete cannot close enabled secure chat', { skip: !hasDatabase }, async () => {
  const alice = await register(testUsername());
  const bob = await register(testUsername());
  await addContact(alice, bob.username);
  const conversationId = await openSecureChat(alice, bob);
  const deleted = await call(state.handleSecureConversations, {
    method: 'DELETE',
    path: `/api/secure-conversations/${encodeURIComponent(conversationId)}`,
    user: alice
  });
  assert.equal(deleted.status, 400);
});

test('key material still hides non-contact conversations', { skip: !hasDatabase }, async () => {
  const alice = await register(testUsername());
  const bob = await register(testUsername());
  const conversationId = state.conversationKey(alice.id, bob.id);

  const material = await call(state.handleSecureConversations, {
    path: `/api/secure-conversations/${encodeURIComponent(conversationId)}/key-material`,
    user: alice
  });

  assert.equal(material.status, 404);
});

test('encrypted messages reject repeated sequence numbers and bad IVs', { skip: !hasDatabase }, async () => {
  const alice = await register(testUsername());
  const bob = await register(testUsername());
  await addContact(alice, bob.username);

  await openSecureChat(alice, bob);

  const base = {
    toId: bob.id,
    ciphertext: b64(80),
    iv: b64(12),
    sequenceNumber: 7,
    cryptoVersion: 2,
    keyVersion: 1
  };
  const first = await call(state.handleSecureConversations, {
    method: 'POST',
    path: '/api/messages/encrypted',
    user: alice,
    body: { ...base, messageId: crypto.randomUUID() }
  });
  assert.equal(first.status, 201);

  const duplicate = await call(state.handleSecureConversations, {
    method: 'POST',
    path: '/api/messages/encrypted',
    user: alice,
    body: { ...base, messageId: crypto.randomUUID() }
  });
  assert.equal(duplicate.status, 409);

  const badIv = await call(state.handleSecureConversations, {
    method: 'POST',
    path: '/api/messages/encrypted',
    user: alice,
    body: { ...base, messageId: crypto.randomUUID(), sequenceNumber: 8, iv: b64(11) }
  });
  assert.equal(badIv.status, 400);
});

test('legacy plaintext messaging still works outside secure conversations', { skip: !hasDatabase }, async () => {
  const alice = await register(testUsername());
  const bob = await register(testUsername());
  await addContact(alice, bob.username);
  const message = await sendMessage(alice, bob.id, 'plain outside secure mode');
  assert.equal(message.text, 'plain outside secure mode');
});
