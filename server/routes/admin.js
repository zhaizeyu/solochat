import {
  execTransaction,
  getDb,
  getUserById,
  rowToUser,
  sanitizeAdminUser,
  userSelect
} from '../db.js';
import { json, readBody } from '../http-utils.js';
import { hashPassword } from '../utils.js';

export async function handleAdmin(req, res, pathName, user) {
  if (!pathName.startsWith('/api/admin/')) return false;
  if (!user.isAdmin) {
    return json(res, 403, { message: '需要管理员权限' });
  }
  const db = getDb();

  if (req.method === 'GET' && pathName === '/api/admin/users') {
    const users = db
      .prepare(`SELECT ${userSelect()} FROM users ORDER BY created_at DESC`)
      .all()
      .map(rowToUser)
      .map(sanitizeAdminUser);
    return json(res, 200, { users });
  }

  if (req.method === 'PATCH' && pathName.startsWith('/api/admin/users/') && pathName.endsWith('/password')) {
    const userId = pathName.split('/').at(-2);
    const target = getUserById(userId);
    const body = await readBody(req);
    const password = String(body.password || '');
    if (!target) {
      return json(res, 404, { message: '用户不存在' });
    }
    if (target.disabledAt) {
      return json(res, 400, { message: '已注销用户不能重置密码' });
    }
    if (password.length < 6) {
      return json(res, 400, { message: '密码至少 6 位' });
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), target.id);
    return json(res, 200, { user: sanitizeAdminUser(getUserById(target.id)) });
  }

  if (req.method === 'DELETE' && pathName.startsWith('/api/admin/users/') && pathName.endsWith('/data')) {
    const userId = pathName.split('/').at(-2);
    const target = getUserById(userId);
    if (!target) {
      return json(res, 404, { message: '用户不存在' });
    }
    if (!target.disabledAt) {
      return json(res, 400, { message: '只能清理已注销用户的数据' });
    }
    if (target.isAdmin) {
      return json(res, 400, { message: '不能清理管理员账号' });
    }
    execTransaction(() => {
      const taskIds = db
        .prepare(`SELECT id FROM planner_tasks WHERE conversation_id = ? OR conversation_id LIKE ? OR conversation_id LIKE ?`)
        .all(target.id, `${target.id}:%`, `%:${target.id}`)
        .map((task) => task.id);
      for (const taskId of taskIds) {
        db.prepare('DELETE FROM planner_confirmations WHERE task_id = ?').run(taskId);
      }
      db.prepare(`DELETE FROM planner_confirmations WHERE user_id = ?`).run(target.id);
      db.prepare(`DELETE FROM planner_tasks WHERE conversation_id = ? OR conversation_id LIKE ? OR conversation_id LIKE ?`)
        .run(target.id, `${target.id}:%`, `%:${target.id}`);
      db.prepare('DELETE FROM contacts WHERE owner_id = ? OR contact_id = ?').run(target.id, target.id);
      db.prepare('DELETE FROM messages WHERE from_id = ? OR to_id = ?').run(target.id, target.id);
      db.prepare('DELETE FROM stickers WHERE owner_id = ?').run(target.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
    });
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { message: '接口不存在' });
}
