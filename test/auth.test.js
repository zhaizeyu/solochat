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
