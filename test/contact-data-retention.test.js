import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addContact,
  addPlannerTask,
  call,
  count,
  deleteContact,
  hasDatabase,
  login,
  register,
  sendMessage,
  state
} from '../test-support/helpers.js';

test('deleting and re-adding a contact preserves and restores conversation records', { skip: !hasDatabase }, async () => {
  const alice = await register('alice_retention');
  const bob = await register('bob_retention');
  await addContact(alice, bob.username);
  await sendMessage(alice, bob.id, 'hello again');
  await addPlannerTask(alice, bob.id, 'keep this plan');

  const key = state.conversationKey(alice.id, bob.id);
  await deleteContact(alice, bob.id);

  assert.equal(await count('SELECT COUNT(*)::int AS count FROM contacts WHERE owner_id IN (?, ?)', alice.id, bob.id), 0);
  assert.equal(await count('SELECT COUNT(*)::int AS count FROM messages WHERE conversation_id = ?', key), 1);
  assert.equal(await count('SELECT COUNT(*)::int AS count FROM planner_tasks WHERE conversation_id = ?', key), 1);

  const blockedMessages = await call(state.handleMessages, {
    path: `/api/messages/${bob.id}`,
    user: alice,
    url: new URL(`http://localhost/api/messages/${bob.id}`)
  });
  assert.equal(blockedMessages.status, 404);

  await addContact(alice, bob.username);

  const contacts = await call(state.handleContacts, { path: '/api/contacts', user: alice });
  assert.equal(contacts.status, 200);
  assert.deepEqual(
    contacts.body.contacts.map((contact) => contact.id),
    [bob.id]
  );
  assert.equal(contacts.body.contacts[0].lastMessage, 'hello again');

  const messages = await call(state.handleMessages, {
    path: `/api/messages/${bob.id}`,
    user: alice,
    url: new URL(`http://localhost/api/messages/${bob.id}`)
  });
  assert.equal(messages.status, 200);
  assert.equal(messages.body.messages.length, 1);
  assert.equal(messages.body.messages[0].text, 'hello again');

  const planner = await call(state.handlePlanner, {
    path: `/api/planner/${bob.id}`,
    user: alice
  });
  assert.equal(planner.status, 200);
  assert.equal(planner.body.tasks.length, 1);
  assert.equal(planner.body.tasks[0].plan, 'keep this plan');
});

test('self deletion keeps history, while admin data cleanup removes account data', { skip: !hasDatabase }, async () => {
  const charlie = await register('charlie_cleanup');
  const dana = await register('dana_cleanup');
  const { token } = await login(charlie.username);
  await addContact(charlie, dana.username);
  await sendMessage(charlie, dana.id, 'cleanup boundary');
  const task = await addPlannerTask(charlie, dana.id, 'delete only on admin cleanup');

  const confirm = await call(state.handlePlanner, {
    method: 'PATCH',
    path: `/api/planner/tasks/${task.id}/confirm`,
    user: dana,
    body: { confirmed: true }
  });
  assert.equal(confirm.status, 200);

  const key = state.conversationKey(charlie.id, dana.id);
  const selfDelete = await call(state.handleCurrentUser, {
    method: 'DELETE',
    path: '/api/me',
    user: { ...charlie, token }
  });
  assert.equal(selfDelete.status, 200);

  assert.equal(await count('SELECT COUNT(*)::int AS count FROM messages WHERE conversation_id = ?', key), 1);
  assert.equal(await count('SELECT COUNT(*)::int AS count FROM planner_tasks WHERE conversation_id = ?', key), 1);
  assert.equal(await count('SELECT COUNT(*)::int AS count FROM planner_confirmations WHERE task_id = ?', task.id), 1);
  assert.equal(await count('SELECT COUNT(*)::int AS count FROM contacts WHERE owner_id = ? OR contact_id = ?', charlie.id, charlie.id), 0);
  assert.equal(await count('SELECT COUNT(*)::int AS count FROM sessions WHERE user_id = ?', charlie.id), 0);
  assert.ok((await state.getUserById(charlie.id)).disabledAt);

  const cleanup = await call(state.handleAdmin, {
    method: 'DELETE',
    path: `/api/admin/users/${charlie.id}/data`,
    user: state.adminUser
  });
  assert.equal(cleanup.status, 200);

  assert.equal(await state.getUserById(charlie.id), null);
  assert.equal(await count('SELECT COUNT(*)::int AS count FROM messages WHERE conversation_id = ?', key), 0);
  assert.equal(await count('SELECT COUNT(*)::int AS count FROM planner_tasks WHERE conversation_id = ?', key), 0);
  assert.equal(await count('SELECT COUNT(*)::int AS count FROM planner_confirmations WHERE task_id = ?', task.id), 0);
  assert.ok(await state.getUserById(dana.id));
});
