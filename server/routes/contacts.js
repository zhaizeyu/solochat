import {
  execTransaction,
  findActiveUserByUsername,
  getDb,
  getUserById,
  rowToUser,
  sanitizeUser,
  userSelect
} from '../db.js';
import { json, readBody } from '../http-utils.js';
import { messagePreview, normalizeName } from '../utils.js';

export async function handleContacts(req, res, pathName, user) {
  const db = getDb();

  if (req.method === 'GET' && pathName === '/api/contacts') {
    const rows = await db.prepare(`
      SELECT *
      FROM (
        SELECT
          ${userSelect('u.')},
          (
            SELECT m.text
            FROM messages m
            WHERE m.conversation_id =
              CASE WHEN ? < u.id THEN ? || ':' || u.id ELSE u.id || ':' || ? END
            ORDER BY m.created_at DESC
            LIMIT 1
          ) AS "lastText",
          (
            SELECT m.kind
            FROM messages m
            WHERE m.conversation_id =
              CASE WHEN ? < u.id THEN ? || ':' || u.id ELSE u.id || ':' || ? END
            ORDER BY m.created_at DESC
            LIMIT 1
          ) AS "lastKind",
          (
            SELECT m.recalled_at
            FROM messages m
            WHERE m.conversation_id =
              CASE WHEN ? < u.id THEN ? || ':' || u.id ELSE u.id || ':' || ? END
            ORDER BY m.created_at DESC
            LIMIT 1
          ) AS "lastRecalledAt",
          (
            SELECT m.created_at
            FROM messages m
            WHERE m.conversation_id =
              CASE WHEN ? < u.id THEN ? || ':' || u.id ELSE u.id || ':' || ? END
            ORDER BY m.created_at DESC
            LIMIT 1
          ) AS "lastMessageAt",
          (
            SELECT COUNT(*)::int
            FROM messages m
            WHERE m.conversation_id =
              CASE WHEN ? < u.id THEN ? || ':' || u.id ELSE u.id || ':' || ? END
              AND m.to_id = ?
              AND m.read_at IS NULL
              AND m.recalled_at IS NULL
          ) AS "unreadCount"
        FROM contacts c
        JOIN users u ON u.id = c.contact_id
        WHERE c.owner_id = ? AND u.disabled_at IS NULL
      ) contacts_with_messages
      ORDER BY COALESCE("lastMessageAt", '') DESC
    `).all(
      user.id, user.id, user.id,
      user.id, user.id, user.id,
      user.id, user.id, user.id,
      user.id, user.id, user.id,
      user.id, user.id, user.id, user.id,
      user.id
    );
    const contacts = rows.map((row) => ({
      ...sanitizeUser(rowToUser(row)),
      lastMessage: messagePreview({
        text: row.lastText || '',
        kind: row.lastKind || 'text',
        recalledAt: row.lastRecalledAt || null
      }),
      lastMessageAt: row.lastMessageAt || null,
      unreadCount: row.unreadCount
    }));
    return json(res, 200, { contacts });
  }

  if (req.method === 'POST' && pathName === '/api/contacts') {
    const body = await readBody(req);
    const username = normalizeName(body.username).toLowerCase();
    const target = await findActiveUserByUsername(username);
    if (!target) {
      return json(res, 404, { message: '未找到该用户' });
    }
    if (target.id === user.id) {
      return json(res, 400, { message: '不能添加自己' });
    }
    const now = new Date().toISOString();
    await execTransaction(async () => {
      await db.prepare('INSERT INTO contacts (owner_id, contact_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
        .run(user.id, target.id, now);
      await db.prepare('INSERT INTO contacts (owner_id, contact_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
        .run(target.id, user.id, now);
    });
    return json(res, 201, { contact: sanitizeUser(target) });
  }

  if (req.method === 'DELETE' && pathName.startsWith('/api/contacts/')) {
    const contactId = decodeURIComponent(pathName.slice('/api/contacts/'.length));
    const target = await getUserById(contactId);
    if (!target || target.disabledAt) {
      return json(res, 404, { message: '未找到该联系人' });
    }
    if (target.id === user.id) {
      return json(res, 400, { message: '不能删除自己' });
    }

    const result = await db.prepare(`
      DELETE FROM contacts
      WHERE (owner_id = ? AND contact_id = ?)
        OR (owner_id = ? AND contact_id = ?)
    `).run(user.id, target.id, target.id, user.id);
    if (!result.changes) {
      return json(res, 404, { message: '联系人不存在' });
    }
    return json(res, 200, { ok: true });
  }

  return false;
}
