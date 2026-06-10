import {
  execTransaction,
  findActiveUserByUsername,
  getDb,
  rowToUser,
  sanitizeUser,
  userSelect
} from '../db.js';
import { json, readBody } from '../http-utils.js';
import { messagePreview, normalizeName } from '../utils.js';

export async function handleContacts(req, res, pathName, user) {
  const db = getDb();

  if (req.method === 'GET' && pathName === '/api/contacts') {
    const rows = db.prepare(`
      SELECT
        ${userSelect('u.')},
        (
          SELECT m.text
          FROM messages m
          WHERE m.conversation_id =
            CASE WHEN ? < u.id THEN ? || ':' || u.id ELSE u.id || ':' || ? END
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS lastText,
        (
          SELECT m.kind
          FROM messages m
          WHERE m.conversation_id =
            CASE WHEN ? < u.id THEN ? || ':' || u.id ELSE u.id || ':' || ? END
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS lastKind,
        (
          SELECT m.recalled_at
          FROM messages m
          WHERE m.conversation_id =
            CASE WHEN ? < u.id THEN ? || ':' || u.id ELSE u.id || ':' || ? END
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS lastRecalledAt,
        (
          SELECT m.created_at
          FROM messages m
          WHERE m.conversation_id =
            CASE WHEN ? < u.id THEN ? || ':' || u.id ELSE u.id || ':' || ? END
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS lastMessageAt,
        (
          SELECT COUNT(*)
          FROM messages m
          WHERE m.conversation_id =
            CASE WHEN ? < u.id THEN ? || ':' || u.id ELSE u.id || ':' || ? END
            AND m.to_id = ?
            AND m.read_at IS NULL
            AND m.recalled_at IS NULL
        ) AS unreadCount
      FROM contacts c
      JOIN users u ON u.id = c.contact_id
      WHERE c.owner_id = ? AND u.disabled_at IS NULL
      ORDER BY COALESCE(lastMessageAt, '') DESC
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
    const target = findActiveUserByUsername(username);
    if (!target) {
      return json(res, 404, { message: '未找到该用户' });
    }
    if (target.id === user.id) {
      return json(res, 400, { message: '不能添加自己' });
    }
    const now = new Date().toISOString();
    execTransaction(() => {
      db.prepare('INSERT OR IGNORE INTO contacts (owner_id, contact_id, created_at) VALUES (?, ?, ?)')
        .run(user.id, target.id, now);
      db.prepare('INSERT OR IGNORE INTO contacts (owner_id, contact_id, created_at) VALUES (?, ?, ?)')
        .run(target.id, user.id, now);
    });
    return json(res, 201, { contact: sanitizeUser(target) });
  }

  return false;
}
