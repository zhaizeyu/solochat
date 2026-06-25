import assert from 'node:assert/strict';
import test from 'node:test';
import { addContact, addPlannerTask, call, count, hasDatabase, register, state } from '../test-support/helpers.js';

test('non-contacts cannot create or read planner tasks', { skip: !hasDatabase }, async () => {
  const alice = await register('planner_block_a');
  const bob = await register('planner_block_b');

  const create = await call(state.handlePlanner, {
    method: 'POST',
    path: `/api/planner/${bob.id}/tasks`,
    user: alice,
    body: { plan: 'not allowed' }
  });
  assert.equal(create.status, 404);

  const read = await call(state.handlePlanner, {
    path: `/api/planner/${bob.id}`,
    user: alice
  });
  assert.equal(read.status, 404);
});

test('contacts can create, confirm, update, and delete planner tasks', { skip: !hasDatabase }, async () => {
  const alice = await register('planner_a');
  const bob = await register('planner_b');
  await addContact(alice, bob.username);

  const task = await addPlannerTask(alice, bob.id, 'Dinner', { time: 'Friday', place: 'Cafe' });
  assert.equal(task.plan, 'Dinner');
  assert.equal(task.time, 'Friday');
  assert.equal(task.place, 'Cafe');

  const bobConfirm = await call(state.handlePlanner, {
    method: 'PATCH',
    path: `/api/planner/tasks/${task.id}/confirm`,
    user: bob,
    body: { confirmed: true }
  });
  assert.equal(bobConfirm.status, 200);
  assert.equal(bobConfirm.body.task.confirmedByA, true);

  const aliceDone = await call(state.handlePlanner, {
    method: 'PATCH',
    path: `/api/planner/tasks/${task.id}`,
    user: alice,
    body: { plan: 'Dinner updated', done: true }
  });
  assert.equal(aliceDone.status, 200);
  assert.equal(aliceDone.body.task.plan, 'Dinner updated');
  assert.equal(aliceDone.body.task.done, true);

  const remove = await call(state.handlePlanner, {
    method: 'DELETE',
    path: `/api/planner/tasks/${task.id}`,
    user: alice
  });
  assert.equal(remove.status, 200);
  assert.equal(await count('SELECT COUNT(*)::int AS count FROM planner_tasks WHERE id = ?', task.id), 0);
  assert.equal(await count('SELECT COUNT(*)::int AS count FROM planner_confirmations WHERE task_id = ?', task.id), 0);
});

test('planner updates cannot clear all task content', { skip: !hasDatabase }, async () => {
  const alice = await register('planner_empty_a');
  const bob = await register('planner_empty_b');
  await addContact(alice, bob.username);
  const task = await addPlannerTask(alice, bob.id, 'Keep content');

  const empty = await call(state.handlePlanner, {
    method: 'PATCH',
    path: `/api/planner/tasks/${task.id}`,
    user: alice,
    body: { plan: '', time: '', place: '' }
  });
  assert.equal(empty.status, 400);
});
