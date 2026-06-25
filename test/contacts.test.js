import assert from 'node:assert/strict';
import test from 'node:test';
import { addContact, call, count, deleteContact, hasDatabase, register, state } from '../test-support/helpers.js';

test('contacts can be added once and are created for both users', { skip: !hasDatabase }, async () => {
  const alice = await register('contacts_alice');
  const bob = await register('contacts_bob');

  const contact = await addContact(alice, bob.username);
  assert.equal(contact.id, bob.id);

  await addContact(alice, bob.username);
  assert.equal(await count('SELECT COUNT(*)::int AS count FROM contacts WHERE owner_id = ? AND contact_id = ?', alice.id, bob.id), 1);
  assert.equal(await count('SELECT COUNT(*)::int AS count FROM contacts WHERE owner_id = ? AND contact_id = ?', bob.id, alice.id), 1);
});

test('contact creation rejects missing users and self-adds', { skip: !hasDatabase }, async () => {
  const alice = await register('contacts_self');

  const missing = await call(state.handleContacts, {
    method: 'POST',
    path: '/api/contacts',
    user: alice,
    body: { username: 'nobody_here' }
  });
  assert.equal(missing.status, 404);

  const self = await call(state.handleContacts, {
    method: 'POST',
    path: '/api/contacts',
    user: alice,
    body: { username: alice.username }
  });
  assert.equal(self.status, 400);
});

test('deleting a contact removes both directions', { skip: !hasDatabase }, async () => {
  const alice = await register('contacts_del_a');
  const bob = await register('contacts_del_b');
  await addContact(alice, bob.username);

  await deleteContact(alice, bob.id);
  assert.equal(await count('SELECT COUNT(*)::int AS count FROM contacts WHERE owner_id IN (?, ?)', alice.id, bob.id), 0);

  const missing = await call(state.handleContacts, {
    method: 'DELETE',
    path: `/api/contacts/${bob.id}`,
    user: alice
  });
  assert.equal(missing.status, 404);
});
