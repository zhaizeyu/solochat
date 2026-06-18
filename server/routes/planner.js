import crypto from 'node:crypto';
import {
  areContacts,
  execTransaction,
  getDb,
  getPlannerTaskForUser,
  getPlannerTaskResponse,
  getPlannerTasks,
  getUserById
} from '../db.js';
import { json, readBody } from '../http-utils.js';
import { conversationKey, normalizeName } from '../utils.js';

export async function handlePlanner(req, res, pathName, user) {
  const db = getDb();

  if (req.method === 'GET' && pathName.startsWith('/api/planner/')) {
    const contactId = pathName.split('/').pop();
    const target = await getUserById(contactId);
    if (!target || target.disabledAt || !(await areContacts(user.id, target.id))) {
      return json(res, 404, { message: '联系人不存在' });
    }
    const conversationId = conversationKey(user.id, target.id);
    return json(res, 200, { tasks: await getPlannerTasks(conversationId, user.id, target.id) });
  }

  if (req.method === 'POST' && pathName.startsWith('/api/planner/') && pathName.endsWith('/tasks')) {
    const contactId = pathName.split('/').at(-2);
    const target = await getUserById(contactId);
    if (!target || target.disabledAt || !(await areContacts(user.id, target.id))) {
      return json(res, 404, { message: '联系人不存在' });
    }
    const body = await readBody(req);
    const timeText = normalizeName(body.time).slice(0, 80);
    const placeText = normalizeName(body.place).slice(0, 80);
    const planText = normalizeName(body.plan).slice(0, 200);
    if (!timeText && !placeText && !planText) {
      return json(res, 400, { message: '计划内容不能为空' });
    }
    const now = new Date().toISOString();
    const taskId = crypto.randomUUID();
    const conversationId = conversationKey(user.id, target.id);
    await db.prepare(`
      INSERT INTO planner_tasks (
        id, conversation_id, created_by, time_text, place_text, plan_text,
        done_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(taskId, conversationId, user.id, timeText, placeText, planText, null, now, now);
    return json(res, 201, { task: await getPlannerTaskResponse(taskId, user.id, target.id) });
  }

  if (req.method === 'PATCH' && pathName.startsWith('/api/planner/tasks/') && pathName.endsWith('/confirm')) {
    const taskId = pathName.split('/').at(-2);
    const access = await getPlannerTaskForUser(taskId, user);
    if (!access) {
      return json(res, 404, { message: '计划不存在' });
    }
    const body = await readBody(req);
    const confirmed = Boolean(body.confirmed);
    const now = new Date().toISOString();
    await execTransaction(async () => {
      if (confirmed) {
        await db.prepare(`
          INSERT INTO planner_confirmations (task_id, user_id, confirmed_at)
          VALUES (?, ?, ?)
          ON CONFLICT(task_id, user_id) DO UPDATE SET confirmed_at = excluded.confirmed_at
        `).run(taskId, user.id, now);
      } else {
        await db.prepare('DELETE FROM planner_confirmations WHERE task_id = ? AND user_id = ?').run(taskId, user.id);
      }
      await db.prepare('UPDATE planner_tasks SET updated_at = ? WHERE id = ?').run(now, taskId);
    });
    return json(res, 200, { task: await getPlannerTaskResponse(taskId, user.id, access.target.id) });
  }

  if (req.method === 'PATCH' && pathName.startsWith('/api/planner/tasks/')) {
    const taskId = pathName.split('/').pop();
    const access = await getPlannerTaskForUser(taskId, user);
    if (!access) {
      return json(res, 404, { message: '计划不存在' });
    }
    const body = await readBody(req);
    const current = access.task;
    const next = {
      timeText: Object.hasOwn(body, 'time') ? normalizeName(body.time).slice(0, 80) : current.timeText,
      placeText: Object.hasOwn(body, 'place') ? normalizeName(body.place).slice(0, 80) : current.placeText,
      planText: Object.hasOwn(body, 'plan') ? normalizeName(body.plan).slice(0, 200) : current.planText,
      doneAt: Object.hasOwn(body, 'done') ? (body.done ? new Date().toISOString() : null) : current.doneAt
    };
    if (!next.timeText && !next.placeText && !next.planText) {
      return json(res, 400, { message: '计划内容不能为空' });
    }
    const now = new Date().toISOString();
    await db.prepare(`
      UPDATE planner_tasks
      SET time_text = ?, place_text = ?, plan_text = ?, done_at = ?, updated_at = ?
      WHERE id = ?
    `).run(next.timeText, next.placeText, next.planText, next.doneAt, now, taskId);
    return json(res, 200, { task: await getPlannerTaskResponse(taskId, user.id, access.target.id) });
  }

  if (req.method === 'DELETE' && pathName.startsWith('/api/planner/tasks/')) {
    const taskId = pathName.split('/').pop();
    const access = await getPlannerTaskForUser(taskId, user);
    if (!access) {
      return json(res, 404, { message: '计划不存在' });
    }
    await execTransaction(async () => {
      await db.prepare('DELETE FROM planner_confirmations WHERE task_id = ?').run(taskId);
      await db.prepare('DELETE FROM planner_tasks WHERE id = ?').run(taskId);
    });
    return json(res, 200, { ok: true });
  }

  return false;
}
