import {
  execTransaction,
  getDb,
  getUserById,
  listAdminUsers,
  sanitizeAdminUser
} from '../db.js';
import { json, readBody } from '../http-utils.js';
import { hashPassword } from '../utils.js';

async function deleteUserOwnedData(db, targetId) {
  const likeLeft = `${targetId}:%`;
  const likeRight = `%:${targetId}`;

  await db.prepare(`
    DELETE FROM planner_confirmations
    WHERE user_id = ?
       OR task_id IN (
         SELECT id FROM planner_tasks
         WHERE conversation_id = ? OR conversation_id LIKE ? OR conversation_id LIKE ?
       )
  `).run(targetId, targetId, likeLeft, likeRight);
  await db.prepare(`
    DELETE FROM planner_tasks
    WHERE conversation_id = ? OR conversation_id LIKE ? OR conversation_id LIKE ?
  `).run(targetId, likeLeft, likeRight);

  await db.prepare('DELETE FROM contacts WHERE owner_id = ? OR contact_id = ?').run(targetId, targetId);
  await db.prepare('DELETE FROM messages WHERE from_id = ? OR to_id = ?').run(targetId, targetId);
  await db.prepare(`
    DELETE FROM encrypted_messages
    WHERE sender_id = ? OR recipient_id = ?
       OR conversation_id = ? OR conversation_id LIKE ? OR conversation_id LIKE ?
  `).run(targetId, targetId, targetId, likeLeft, likeRight);
  await db.prepare(`
    DELETE FROM user_wrapped_conversation_keys
    WHERE user_id = ? OR conversation_id = ? OR conversation_id LIKE ? OR conversation_id LIKE ?
  `).run(targetId, targetId, likeLeft, likeRight);
  await db.prepare(`
    DELETE FROM recovery_wrapped_conversation_keys
    WHERE conversation_id = ? OR conversation_id LIKE ? OR conversation_id LIKE ?
  `).run(targetId, likeLeft, likeRight);
  await db.prepare(`
    DELETE FROM secure_handshake_keys
    WHERE user_id = ? OR conversation_id = ? OR conversation_id LIKE ? OR conversation_id LIKE ?
  `).run(targetId, targetId, likeLeft, likeRight);
  await db.prepare(`
    DELETE FROM secure_pairing_keys
    WHERE created_by_user_id = ? OR conversation_id = ? OR conversation_id LIKE ? OR conversation_id LIKE ?
  `).run(targetId, targetId, likeLeft, likeRight);
  await db.prepare(`
    DELETE FROM secure_audit_events
    WHERE user_id = ? OR conversation_id = ? OR conversation_id LIKE ? OR conversation_id LIKE ?
  `).run(targetId, targetId, likeLeft, likeRight);
  await db.prepare(`
    DELETE FROM secure_conversations
    WHERE conversation_id = ? OR conversation_id LIKE ? OR conversation_id LIKE ?
  `).run(targetId, likeLeft, likeRight);
  await db.prepare(`
    DELETE FROM couple_moments
    WHERE author_id = ? OR conversation_id = ? OR conversation_id LIKE ? OR conversation_id LIKE ?
  `).run(targetId, targetId, likeLeft, likeRight);
  await db.prepare('DELETE FROM stickers WHERE owner_id = ?').run(targetId);
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);
  await db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
}

export async function handleAdmin(req, res, pathName, user) {
  if (!pathName.startsWith('/api/admin/')) return false;
  if (!user.isAdmin) {
    return json(res, 403, { message: '需要管理员权限' });
  }
  const db = getDb();

  if (req.method === 'GET' && pathName === '/api/admin/users') {
    const users = await listAdminUsers();
    return json(res, 200, { users });
  }

  if (req.method === 'PATCH' && pathName.startsWith('/api/admin/users/') && pathName.endsWith('/password')) {
    const userId = pathName.split('/').at(-2);
    const target = await getUserById(userId);
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
    await execTransaction(async () => {
      await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), target.id);
      await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
    });
    return json(res, 200, { user: await sanitizeAdminUser(await getUserById(target.id)) });
  }

  if (req.method === 'DELETE' && pathName.startsWith('/api/admin/users/') && pathName.endsWith('/data')) {
    const userId = pathName.split('/').at(-2);
    const target = await getUserById(userId);
    if (!target) {
      return json(res, 404, { message: '用户不存在' });
    }
    if (!target.disabledAt) {
      return json(res, 400, { message: '只能清理已注销用户的数据' });
    }
    if (target.isAdmin) {
      return json(res, 400, { message: '不能清理管理员账号' });
    }
    await execTransaction(async () => {
      await deleteUserOwnedData(db, target.id);
    });
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { message: '接口不存在' });
}
