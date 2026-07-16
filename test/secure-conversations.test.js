import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { addContact, call, hasDatabase, register, sendMessage, state } from '../test-support/helpers.js';

const runId = `${process.pid}_${Date.now()}`.replace(/[^a-zA-Z0-9_]/g, '_');

function testUsername(name) {
  return `${name}_${runId}`.slice(0, 20);
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

function recoveryWrappedKey(overrides = {}) {
  return {
    wrappedKey: b64(48),
    wrapAlgorithm: 'AES-256-GCM',
    wrapIv: b64(12),
    recoveryVersion: 1,
    ...overrides
  };
}

async function enableSecureChat(alice, bob) {
  const enabled = await call(state.handleSecureConversations, {
    method: 'POST',
    path: '/api/secure-conversations/enable',
    user: alice,
    body: {
      contactId: bob.id,
      userWrappedKey: userWrappedKey(),
      recoveryWrappedKey: recoveryWrappedKey()
    }
  });
  assert.equal(enabled.status, 201);
  return enabled.body.conversationId;
}

async function createPairing(alice, conversationId) {
  const created = await call(state.handleSecureConversations, {
    method: 'POST',
    path: '/api/secure-conversations/pairing/create',
    user: alice,
    body: {
      conversationId,
      pairingWrappedKey: recoveryWrappedKey(),
      ttlMinutes: 30
    }
  });
  assert.equal(created.status, 201);
  return created.body.pairingId;
}

async function completePairing(bob, conversationId, pairingId) {
  const completed = await call(state.handleSecureConversations, {
    method: 'POST',
    path: '/api/secure-conversations/pairing/complete',
    user: bob,
    body: {
      conversationId,
      pairingId,
      userWrappedKey: userWrappedKey()
    }
  });
  assert.equal(completed.status, 200);
}

test('secure chat stores wrapped keys and blocks plaintext message fallback', { skip: !hasDatabase }, async () => {
  const alice = await register(testUsername('secure_enable_a'));
  const bob = await register(testUsername('secure_enable_b'));
  await addContact(alice, bob.username);

  const conversationId = await enableSecureChat(alice, bob);
  const row = await state.getDb().prepare('SELECT * FROM secure_conversations WHERE conversation_id = ?').get(conversationId);
  assert.equal(row.status, 'waiting_peer');
  assert.equal(row.enabled, false);

  const wrapped = await state.getDb().prepare(`
    SELECT wrapped_key, kdf_salt FROM user_wrapped_conversation_keys
    WHERE conversation_id = ? AND user_id = ?
  `).get(conversationId, alice.id);
  assert.ok(wrapped.wrapped_key);
  assert.ok(wrapped.kdf_salt);

  const blocked = await call(state.handleMessages, {
    method: 'POST',
    path: '/api/messages',
    user: alice,
    body: { toId: bob.id, text: 'should not be stored as plaintext' }
  });
  assert.equal(blocked.status, 409);
});

test('key material reports off for valid conversations without secure chat', { skip: !hasDatabase }, async () => {
  const alice = await register(testUsername('secure_off_a'));
  const bob = await register(testUsername('secure_off_b'));
  await addContact(alice, bob.username);
  const conversationId = state.conversationKey(alice.id, bob.id);

  const material = await call(state.handleSecureConversations, {
    path: `/api/secure-conversations/${encodeURIComponent(conversationId)}/key-material`,
    user: alice
  });

  assert.equal(material.status, 200);
  assert.equal(material.body.conversation.status, 'off');
  assert.equal(material.body.userWrappedKey, null);
});

test('secure chat can be disabled and re-enabled with fresh key material', { skip: !hasDatabase }, async () => {
  const alice = await register(testUsername('secure_disable_a'));
  const bob = await register(testUsername('secure_disable_b'));
  await addContact(alice, bob.username);

  const conversationId = await enableSecureChat(alice, bob);
  const blockedPeerDisable = await call(state.handleSecureConversations, {
    method: 'DELETE',
    path: `/api/secure-conversations/${encodeURIComponent(conversationId)}`,
    user: bob
  });
  assert.equal(blockedPeerDisable.status, 403);

  const disabled = await call(state.handleSecureConversations, {
    method: 'DELETE',
    path: `/api/secure-conversations/${encodeURIComponent(conversationId)}`,
    user: alice
  });
  assert.equal(disabled.status, 200);

  const disabledMaterial = await call(state.handleSecureConversations, {
    path: `/api/secure-conversations/${encodeURIComponent(conversationId)}/key-material`,
    user: alice
  });
  assert.equal(disabledMaterial.body.conversation.status, 'off');
  assert.equal(disabledMaterial.body.userWrappedKey, null);
  assert.equal(disabledMaterial.body.recoveryWrappedKey, null);

  const nextKey = userWrappedKey({ wrappedKey: b64(64), kdfSalt: b64(24) });
  const reenabled = await call(state.handleSecureConversations, {
    method: 'POST',
    path: '/api/secure-conversations/enable',
    user: alice,
    body: {
      contactId: bob.id,
      userWrappedKey: nextKey,
      recoveryWrappedKey: recoveryWrappedKey({ wrappedKey: b64(64) })
    }
  });
  assert.equal(reenabled.status, 201);

  const freshMaterial = await call(state.handleSecureConversations, {
    path: `/api/secure-conversations/${encodeURIComponent(conversationId)}/key-material`,
    user: alice
  });
  assert.equal(freshMaterial.body.conversation.status, 'waiting_peer');
  assert.equal(freshMaterial.body.userWrappedKey.wrappedKey, nextKey.wrappedKey);
  assert.equal(freshMaterial.body.userWrappedKey.kdfSalt, nextKey.kdfSalt);
});

test('key material still hides non-contact conversations', { skip: !hasDatabase }, async () => {
  const alice = await register(testUsername('secure_off_block_a'));
  const bob = await register(testUsername('secure_off_block_b'));
  const conversationId = state.conversationKey(alice.id, bob.id);

  const material = await call(state.handleSecureConversations, {
    path: `/api/secure-conversations/${encodeURIComponent(conversationId)}/key-material`,
    user: alice
  });

  assert.equal(material.status, 404);
});

test('pairing can be completed once and enables encrypted messages', { skip: !hasDatabase }, async () => {
  const alice = await register(testUsername('secure_pair_a'));
  const bob = await register(testUsername('secure_pair_b'));
  await addContact(alice, bob.username);

  const conversationId = await enableSecureChat(alice, bob);
  const pairingId = await createPairing(alice, conversationId);
  await completePairing(bob, conversationId, pairingId);

  const reused = await call(state.handleSecureConversations, {
    method: 'POST',
    path: '/api/secure-conversations/pairing/complete',
    user: bob,
    body: {
      conversationId,
      pairingId,
      userWrappedKey: userWrappedKey()
    }
  });
  assert.equal(reused.status, 400);

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
      cryptoVersion: 1,
      keyVersion: 1
    }
  });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.message.ciphertext.length > 0, true);
  assert.equal(Object.hasOwn(sent.body.message, 'text'), false);

  const stored = await state.getDb().prepare('SELECT * FROM encrypted_messages WHERE message_id = ?').get(sent.body.message.id);
  assert.equal(stored.ciphertext, sent.body.message.ciphertext);
  assert.equal(Object.hasOwn(stored, 'text'), false);
});

test('encrypted messages reject repeated sequence numbers and bad IVs', { skip: !hasDatabase }, async () => {
  const alice = await register(testUsername('secure_replay_a'));
  const bob = await register(testUsername('secure_replay_b'));
  await addContact(alice, bob.username);

  const conversationId = await enableSecureChat(alice, bob);
  const pairingId = await createPairing(alice, conversationId);
  await completePairing(bob, conversationId, pairingId);

  const base = {
    toId: bob.id,
    ciphertext: b64(80),
    iv: b64(12),
    sequenceNumber: 7,
    cryptoVersion: 1,
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
  const alice = await register(testUsername('secure_plain_a'));
  const bob = await register(testUsername('secure_plain_b'));
  await addContact(alice, bob.username);
  const message = await sendMessage(alice, bob.id, 'plain outside secure mode');
  assert.equal(message.text, 'plain outside secure mode');
});
