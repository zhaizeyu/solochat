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

test('admin can disable a single user and batch disable others', { skip: !hasDatabase }, async () => {
  const one = await register('admin_disable_one');
  const two = await register('admin_disable_two');
  const three = await register('admin_disable_three');
  const { token: oneToken } = await login(one.username);

  const single = await call(state.handleAdmin, {
    method: 'POST',
    path: '/api/admin/users/disable',
    user: state.adminUser,
    body: { userIds: [one.id] }
  });
  assert.equal(single.status, 200, JSON.stringify(single.body));
  assert.equal(single.body.disabledCount, 1);
  assert.ok((await state.getUserById(one.id)).disabledAt);

  const stale = await state.getAuthUser({
    headers: { authorization: `Bearer ${oneToken}` }
  });
  assert.equal(stale, null);

  const batch = await call(state.handleAdmin, {
    method: 'POST',
    path: '/api/admin/users/disable',
    user: state.adminUser,
    body: { userIds: [two.id, three.id, two.id] }
  });
  assert.equal(batch.status, 200, JSON.stringify(batch.body));
  assert.equal(batch.body.disabledCount, 2);
  assert.ok((await state.getUserById(two.id)).disabledAt);
  assert.ok((await state.getUserById(three.id)).disabledAt);

  const again = await call(state.handleAdmin, {
    method: 'POST',
    path: '/api/admin/users/disable',
    user: state.adminUser,
    body: { userIds: [two.id] }
  });
  assert.equal(again.status, 200);
  assert.equal(again.body.disabledCount, 0);
  assert.equal(again.body.skippedCount, 1);

  const rejectAdmin = await call(state.handleAdmin, {
    method: 'POST',
    path: '/api/admin/users/disable',
    user: state.adminUser,
    body: { userIds: [state.adminUser.id] }
  });
  assert.equal(rejectAdmin.status, 200);
  assert.equal(rejectAdmin.body.disabledCount, 0);
  assert.equal(rejectAdmin.body.failedCount, 1);
});

test('admin can batch cleanup disabled users', { skip: !hasDatabase }, async () => {
  const one = await register('adm_cln_a');
  const two = await register('adm_cln_b');
  const active = await register('adm_cln_live');

  const disable = await call(state.handleAdmin, {
    method: 'POST',
    path: '/api/admin/users/disable',
    user: state.adminUser,
    body: { userIds: [one.id, two.id] }
  });
  assert.equal(disable.status, 200);
  assert.equal(disable.body.disabledCount, 2);

  const rejectActive = await call(state.handleAdmin, {
    method: 'POST',
    path: '/api/admin/users/cleanup-data',
    user: state.adminUser,
    body: { userIds: [active.id] }
  });
  assert.equal(rejectActive.status, 200);
  assert.equal(rejectActive.body.cleanedCount, 0);
  assert.equal(rejectActive.body.skippedCount, 1);
  assert.ok(await state.getUserById(active.id));

  const cleanup = await call(state.handleAdmin, {
    method: 'POST',
    path: '/api/admin/users/cleanup-data',
    user: state.adminUser,
    body: { userIds: [one.id, two.id, one.id] }
  });
  assert.equal(cleanup.status, 200, JSON.stringify(cleanup.body));
  assert.equal(cleanup.body.cleanedCount, 2);
  assert.equal(await state.getUserById(one.id), null);
  assert.equal(await state.getUserById(two.id), null);
});
