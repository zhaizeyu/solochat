import assert from 'node:assert/strict';
import test from 'node:test';
import { addContact, call, hasDatabase, register, sendMessage, state } from '../test-support/helpers.js';

const runId = `${process.pid}${Date.now().toString(36)}`.slice(-8);
let seq = 0;
function uname(prefix) {
  seq += 1;
  return `${prefix}${seq}${runId}`.replace(/[^a-z0-9_]/gi, '').toLowerCase().slice(0, 20);
}

function historyTexts(result) {
  return (result.body.messages || []).map((message) => message.text);
}

async function listMessages(user, contactId) {
  return call(state.handleMessages, {
    path: `/api/messages/${contactId}`,
    user,
    url: new URL(`http://localhost/api/messages/${contactId}?limit=50`)
  });
}

async function listContacts(user) {
  return call(state.handleContacts, {
    path: '/api/contacts',
    user
  });
}

async function cleanup(user, contactId, body) {
  return call(state.handleMessages, {
    method: 'POST',
    path: `/api/messages/${contactId}/cleanup`,
    user,
    body
  });
}

async function preview(user, contactId, body) {
  return call(state.handleMessages, {
    method: 'POST',
    path: `/api/messages/${contactId}/cleanup-preview`,
    user,
    body
  });
}

test('parseCleanupRequest validates scope and time range', async () => {
  const { parseCleanupRequest } = await import('../server/message-hides.js');
  assert.equal(parseCleanupRequest({ mode: 'all' }).scope, 'self');
  assert.equal(parseCleanupRequest({ scope: 'both', mode: 'all' }).scope, 'both');
  assert.match(parseCleanupRequest({ scope: 'everyone', mode: 'all' }).error || '', /清理范围/);
  assert.match(parseCleanupRequest({ scope: 'self', mode: 'range' }).error || '', /起止时间/);
  assert.match(
    parseCleanupRequest({
      scope: 'self',
      mode: 'range',
      startAt: '2026-01-02T00:00:00.000Z',
      endAt: '2026-01-01T00:00:00.000Z'
    }).error || '',
    /开始时间/
  );
  const ok = parseCleanupRequest({
    scope: 'both',
    mode: 'range',
    startAt: '2026-01-01T00:00:00.000Z',
    endAt: '2026-01-02T00:00:00.000Z'
  });
  assert.equal(ok.mode, 'range');
  assert.equal(ok.scope, 'both');
});

test('hiding message history only affects the current user', { skip: !hasDatabase }, async () => {
  const alice = await register(uname('hha'));
  const bob = await register(uname('hhb'));
  await addContact(alice, bob.username);

  await sendMessage(alice, bob.id, 'keep-visible');
  const mid = await sendMessage(bob, alice.id, 'to-hide');
  await sendMessage(alice, bob.id, 'after-mid');

  const rangeHide = await cleanup(alice, bob.id, {
    scope: 'self',
    mode: 'range',
    startAt: mid.createdAt,
    endAt: mid.createdAt
  });
  assert.equal(rangeHide.status, 200);
  assert.equal(rangeHide.body.scope, 'self');
  assert.equal(rangeHide.body.count, 1);

  assert.deepEqual(historyTexts(await listMessages(alice, bob.id)), ['keep-visible', 'after-mid']);
  assert.deepEqual(
    historyTexts(await listMessages(bob, alice.id)),
    ['keep-visible', 'to-hide', 'after-mid']
  );

  const clearAll = await cleanup(alice, bob.id, { scope: 'self', mode: 'all' });
  assert.equal(clearAll.status, 200);
  assert.ok(clearAll.body.count >= 2);
  assert.deepEqual(historyTexts(await listMessages(alice, bob.id)), []);
  assert.equal((await listMessages(bob, alice.id)).body.messages.length, 3);
});

test('self cleanup preview reports only visible messages for current user', { skip: !hasDatabase }, async () => {
  const alice = await register(uname('hpa'));
  const bob = await register(uname('hpb'));
  await addContact(alice, bob.username);
  await sendMessage(alice, bob.id, 'one');
  await sendMessage(bob, alice.id, 'two');

  const allPreview = await preview(alice, bob.id, { scope: 'self', mode: 'all' });
  assert.equal(allPreview.status, 200);
  assert.equal(allPreview.body.count, 2);
  assert.match(allPreview.body.hint || '', /单边|隐藏/);

  const mid = await sendMessage(alice, bob.id, 'three');
  await cleanup(alice, bob.id, {
    scope: 'self',
    mode: 'range',
    startAt: mid.createdAt,
    endAt: mid.createdAt
  });

  const afterHide = await preview(alice, bob.id, { scope: 'self', mode: 'all' });
  assert.equal(afterHide.status, 200);
  assert.equal(afterHide.body.count, 2);

  const bobPreview = await preview(bob, alice.id, { scope: 'self', mode: 'all' });
  assert.equal(bobPreview.body.count, 3);
});

test('legacy hide endpoints still work as self-scope aliases', { skip: !hasDatabase }, async () => {
  const alice = await register(uname('hla'));
  const bob = await register(uname('hlb'));
  await addContact(alice, bob.username);
  await sendMessage(alice, bob.id, 'legacy-one');
  await sendMessage(bob, alice.id, 'legacy-two');

  const legacyPreview = await call(state.handleMessages, {
    method: 'POST',
    path: `/api/messages/${bob.id}/hide-preview`,
    user: alice,
    body: { mode: 'all' }
  });
  assert.equal(legacyPreview.status, 200);
  assert.equal(legacyPreview.body.count, 2);

  const legacyHide = await call(state.handleMessages, {
    method: 'POST',
    path: `/api/messages/${bob.id}/hide`,
    user: alice,
    body: { mode: 'all' }
  });
  assert.equal(legacyHide.status, 200);
  assert.ok(legacyHide.body.hide);
  assert.deepEqual(historyTexts(await listMessages(alice, bob.id)), []);
  assert.equal((await listMessages(bob, alice.id)).body.messages.length, 2);
});

test('bilateral purge permanently deletes for both users', { skip: !hasDatabase }, async () => {
  const alice = await register(uname('pha'));
  const bob = await register(uname('phb'));
  await addContact(alice, bob.username);

  await sendMessage(alice, bob.id, 'keep');
  const doomed = await sendMessage(bob, alice.id, 'purge-me');
  await sendMessage(alice, bob.id, 'after');

  const purged = await cleanup(alice, bob.id, {
    scope: 'both',
    mode: 'range',
    startAt: doomed.createdAt,
    endAt: doomed.createdAt
  });
  assert.equal(purged.status, 200);
  assert.equal(purged.body.scope, 'both');
  assert.equal(purged.body.count, 1);
  assert.match(purged.body.hint || '', /彻底删除|不可恢复/);

  assert.deepEqual(historyTexts(await listMessages(alice, bob.id)), ['keep', 'after']);
  assert.deepEqual(historyTexts(await listMessages(bob, alice.id)), ['keep', 'after']);

  const remaining = await state.getDb().prepare(`
    SELECT COUNT(*)::int AS count FROM messages WHERE id = ?
  `).get(doomed.id);
  assert.equal(Number(remaining.count), 0);
});

test('bilateral purge all clears conversation for both and updates contacts preview', { skip: !hasDatabase }, async () => {
  const alice = await register(uname('paa'));
  const bob = await register(uname('pab'));
  await addContact(alice, bob.username);

  await sendMessage(alice, bob.id, 'a1');
  await sendMessage(bob, alice.id, 'b1');
  await sendMessage(alice, bob.id, 'a2');

  const previewAll = await preview(alice, bob.id, { scope: 'both', mode: 'all' });
  assert.equal(previewAll.status, 200);
  assert.equal(previewAll.body.count, 3);
  assert.match(previewAll.body.hint || '', /永久删除|不可恢复/);

  const purged = await cleanup(alice, bob.id, { scope: 'both', mode: 'all' });
  assert.equal(purged.status, 200);
  assert.equal(purged.body.count, 3);

  assert.deepEqual(historyTexts(await listMessages(alice, bob.id)), []);
  assert.deepEqual(historyTexts(await listMessages(bob, alice.id)), []);

  const aliceContacts = await listContacts(alice);
  const bobContacts = await listContacts(bob);
  const aliceSide = aliceContacts.body.contacts.find((item) => item.id === bob.id);
  const bobSide = bobContacts.body.contacts.find((item) => item.id === alice.id);
  assert.ok(aliceSide);
  assert.ok(bobSide);
  assert.equal(aliceSide.lastMessage, '');
  assert.equal(bobSide.lastMessage, '');
  assert.equal(aliceSide.unreadCount, 0);
  assert.equal(bobSide.unreadCount, 0);
});

test('self hide updates contact last message only for hider', { skip: !hasDatabase }, async () => {
  const alice = await register(uname('sla'));
  const bob = await register(uname('slb'));
  await addContact(alice, bob.username);

  await sendMessage(alice, bob.id, 'older');
  const latest = await sendMessage(bob, alice.id, 'newest-for-bob');

  await cleanup(alice, bob.id, {
    scope: 'self',
    mode: 'range',
    startAt: latest.createdAt,
    endAt: latest.createdAt
  });

  const aliceContacts = await listContacts(alice);
  const bobContacts = await listContacts(bob);
  const aliceSide = aliceContacts.body.contacts.find((item) => item.id === bob.id);
  const bobSide = bobContacts.body.contacts.find((item) => item.id === alice.id);

  assert.equal(aliceSide.lastMessage, 'older');
  assert.equal(bobSide.lastMessage, 'newest-for-bob');
});

test('messages sent after self hide remain visible', { skip: !hasDatabase }, async () => {
  const alice = await register(uname('haa'));
  const bob = await register(uname('hab'));
  await addContact(alice, bob.username);

  await sendMessage(alice, bob.id, 'old');
  await cleanup(alice, bob.id, { scope: 'self', mode: 'all' });
  assert.deepEqual(historyTexts(await listMessages(alice, bob.id)), []);

  await sendMessage(bob, alice.id, 'fresh');
  assert.deepEqual(historyTexts(await listMessages(alice, bob.id)), ['fresh']);
  assert.ok(historyTexts(await listMessages(bob, alice.id)).includes('old'));
  assert.ok(historyTexts(await listMessages(bob, alice.id)).includes('fresh'));
});

test('cleanup rejects invalid payloads and non-contacts', { skip: !hasDatabase }, async () => {
  const alice = await register(uname('cba'));
  const bob = await register(uname('cbb'));
  const stranger = await register(uname('cbc'));
  await addContact(alice, bob.username);

  const badScope = await cleanup(alice, bob.id, { scope: 'team', mode: 'all' });
  assert.equal(badScope.status, 400);

  const badRange = await cleanup(alice, bob.id, {
    scope: 'self',
    mode: 'range',
    startAt: '2026-02-01T00:00:00.000Z',
    endAt: '2026-01-01T00:00:00.000Z'
  });
  assert.equal(badRange.status, 400);

  const missingTimes = await cleanup(alice, bob.id, { scope: 'both', mode: 'range' });
  assert.equal(missingTimes.status, 400);

  const notContact = await cleanup(alice, stranger.id, { scope: 'self', mode: 'all' });
  assert.equal(notContact.status, 404);

  const notContactPreview = await preview(alice, stranger.id, { scope: 'both', mode: 'all' });
  assert.equal(notContactPreview.status, 404);
});

test('purge still removes messages previously hidden by one side', { skip: !hasDatabase }, async () => {
  const alice = await register(uname('pxa'));
  const bob = await register(uname('pxb'));
  await addContact(alice, bob.username);

  const hidden = await sendMessage(bob, alice.id, 'hidden-then-purged');
  await sendMessage(alice, bob.id, 'survive');

  await cleanup(alice, bob.id, {
    scope: 'self',
    mode: 'range',
    startAt: hidden.createdAt,
    endAt: hidden.createdAt
  });
  assert.deepEqual(historyTexts(await listMessages(alice, bob.id)), ['survive']);
  assert.ok(historyTexts(await listMessages(bob, alice.id)).includes('hidden-then-purged'));

  const purged = await cleanup(bob, alice.id, {
    scope: 'both',
    mode: 'range',
    startAt: hidden.createdAt,
    endAt: hidden.createdAt
  });
  assert.equal(purged.status, 200);
  assert.equal(purged.body.count, 1);

  assert.deepEqual(historyTexts(await listMessages(alice, bob.id)), ['survive']);
  assert.deepEqual(historyTexts(await listMessages(bob, alice.id)), ['survive']);
  const leftover = await state.getDb().prepare(`
    SELECT COUNT(*)::int AS count FROM messages WHERE id = ?
  `).get(hidden.id);
  assert.equal(Number(leftover.count), 0);
});
