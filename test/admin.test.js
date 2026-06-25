import assert from 'node:assert/strict';
import test from 'node:test';
import { addContact, call, hasDatabase, login, register, sendMessage, state } from '../test-support/helpers.js';

test('admin APIs reject ordinary users', { skip: !hasDatabase }, async () => {
  const user = await register('admin_plain');

  const result = await call(state.handleAdmin, {
    path: '/api/admin/users',
    user
  });
  assert.equal(result.status, 403);
});

test('admin can list users and reset active user passwords', { skip: !hasDatabase }, async () => {
  const user = await register('admin_reset');

  const list = await call(state.handleAdmin, {
    path: '/api/admin/users',
    user: state.adminUser
  });
  assert.equal(list.status, 200);
  assert.ok(list.body.users.some((item) => item.id === user.id));

  const reset = await call(state.handleAdmin, {
    method: 'PATCH',
    path: `/api/admin/users/${user.id}/password`,
    user: state.adminUser,
    body: { password: 'newsecret' }
  });
  assert.equal(reset.status, 200);

  const oldLogin = await call(state.handlePublicAuth, {
    method: 'POST',
    path: '/api/login',
    body: { username: user.username, password: 'secret1' }
  });
  assert.equal(oldLogin.status, 401);

  const newLogin = await login(user.username, 'newsecret');
  assert.equal(newLogin.user.id, user.id);
});

test('admin data cleanup requires a disabled non-admin user and keeps peers', { skip: !hasDatabase }, async () => {
  const target = await register('admin_cleanup_target');
  const peer = await register('admin_cleanup_peer');
  await addContact(target, peer.username);
  await sendMessage(target, peer.id, 'cleanup me');
  const { token } = await login(target.username);

  const activeCleanup = await call(state.handleAdmin, {
    method: 'DELETE',
    path: `/api/admin/users/${target.id}/data`,
    user: state.adminUser
  });
  assert.equal(activeCleanup.status, 400);

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
});
