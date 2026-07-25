import assert from 'node:assert/strict';
import test from 'node:test';
import { call, count, hasDatabase, login, register, state } from '../test-support/helpers.js';

test('registration rejects duplicate usernames and short passwords', { skip: !hasDatabase }, async () => {
  await register('auth_user');

  const duplicate = await call(state.handlePublicAuth, {
    method: 'POST',
    path: '/api/register',
    body: { username: 'auth_user', displayName: 'auth_user', password: 'secret1' }
  });
  assert.equal(duplicate.status, 409);

  const shortPassword = await call(state.handlePublicAuth, {
    method: 'POST',
    path: '/api/register',
    body: { username: 'auth_short', displayName: 'auth_short', password: '123' }
  });
  assert.equal(shortPassword.status, 400);
});

test('login creates a session and rejects wrong passwords', { skip: !hasDatabase }, async () => {
  const user = await register('auth_login');

  const wrongPassword = await call(state.handlePublicAuth, {
    method: 'POST',
    path: '/api/login',
    body: { username: user.username, password: 'wrong-password' }
  });
  assert.equal(wrongPassword.status, 401);

  const { token, user: loggedInUser } = await login(user.username);
  assert.equal(loggedInUser.id, user.id);
  assert.equal(await count('SELECT COUNT(*)::int AS count FROM sessions WHERE token = ? AND user_id = ?', token, user.id), 1);
});

test('user can change login password with current password', { skip: !hasDatabase }, async () => {
  const user = await register('auth_pwchange');
  const { token } = await login(user.username);

  const wrong = await call(state.handleCurrentUser, {
    method: 'POST',
    path: '/api/me/password',
    user: { ...user, token },
    body: { currentPassword: 'wrong-password', newPassword: 'secret2' }
  });
  assert.equal(wrong.status, 401);

  const changed = await call(state.handleCurrentUser, {
    method: 'POST',
    path: '/api/me/password',
    user: { ...user, token },
    body: { currentPassword: 'secret1', newPassword: 'secret2' }
  });
  assert.equal(changed.status, 200);

  const oldLogin = await call(state.handlePublicAuth, {
    method: 'POST',
    path: '/api/login',
    body: { username: user.username, password: 'secret1' }
  });
  assert.equal(oldLogin.status, 401);

  const newLogin = await login(user.username, 'secret2');
  assert.equal(newLogin.user.id, user.id);
});

test('self deletion disables the account and removes active sessions', { skip: !hasDatabase }, async () => {
  const user = await register('auth_delete');
  const { token } = await login(user.username);

  const result = await call(state.handleCurrentUser, {
    method: 'DELETE',
    path: '/api/me',
    user: { ...user, token }
  });
  assert.equal(result.status, 200);

  const deleted = await state.getUserById(user.id);
  assert.ok(deleted.disabledAt);
  assert.equal(await count('SELECT COUNT(*)::int AS count FROM sessions WHERE user_id = ?', user.id), 0);

  const relogin = await call(state.handlePublicAuth, {
    method: 'POST',
    path: '/api/login',
    body: { username: user.username, password: 'secret1' }
  });
  assert.equal(relogin.status, 401);
});
