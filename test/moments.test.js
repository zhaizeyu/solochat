import assert from 'node:assert/strict';
import test from 'node:test';
import { addContact, addMoment, call, count, hasDatabase, register, state } from '../test-support/helpers.js';

test('non-contacts cannot create or read moments', { skip: !hasDatabase }, async () => {
  const alice = await register('moments_block_a');
  const bob = await register('moments_block_b');

  const create = await call(state.handleMoments, {
    method: 'POST',
    path: `/api/moments/${bob.id}`,
    user: alice,
    body: { text: 'not allowed' }
  });
  assert.equal(create.status, 404);

  const read = await call(state.handleMoments, {
    path: `/api/moments/${bob.id}`,
    user: alice
  });
  assert.equal(read.status, 404);
});

test('contacts can create, update, read, and delete moments', { skip: !hasDatabase }, async () => {
  const alice = await register('moments_a');
  const bob = await register('moments_b');
  await addContact(alice, bob.username);

  const moment = await addMoment(alice, bob.id, 'First coffee', { happenedAt: '2026-07-02' });
  assert.equal(moment.text, 'First coffee');
  assert.equal(moment.happenedAt, '2026-07-02');
  assert.equal(moment.authorId, alice.id);

  const readAsBob = await call(state.handleMoments, {
    path: `/api/moments/${alice.id}`,
    user: bob
  });
  assert.equal(readAsBob.status, 200);
  assert.equal(readAsBob.body.moments.length, 1);
  assert.equal(readAsBob.body.moments[0].text, 'First coffee');

  const updated = await call(state.handleMoments, {
    method: 'PATCH',
    path: `/api/moments/items/${moment.id}`,
    user: bob,
    body: { text: 'First coffee updated', happenedAt: '2026-07-03' }
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.moments[0].text, 'First coffee updated');
  assert.equal(updated.body.moments[0].happenedAt, '2026-07-03');

  const remove = await call(state.handleMoments, {
    method: 'DELETE',
    path: `/api/moments/items/${moment.id}`,
    user: alice
  });
  assert.equal(remove.status, 200);
  assert.equal(await count('SELECT COUNT(*)::int AS count FROM couple_moments WHERE id = ? AND deleted_at IS NULL', moment.id), 0);
});

test('moments cannot be empty', { skip: !hasDatabase }, async () => {
  const alice = await register('moments_empty_a');
  const bob = await register('moments_empty_b');
  await addContact(alice, bob.username);
  const moment = await addMoment(alice, bob.id, 'Keep content');

  const emptyCreate = await call(state.handleMoments, {
    method: 'POST',
    path: `/api/moments/${bob.id}`,
    user: alice,
    body: { text: '' }
  });
  assert.equal(emptyCreate.status, 400);

  const emptyUpdate = await call(state.handleMoments, {
    method: 'PATCH',
    path: `/api/moments/items/${moment.id}`,
    user: alice,
    body: { text: '' }
  });
  assert.equal(emptyUpdate.status, 400);
});
