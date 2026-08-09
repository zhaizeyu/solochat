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
      SELECT
        ${userSelect('u.')},
        last_plain.text AS "lastText",
        last_plain.kind AS "lastKind",
        last_plain.recalled_at AS "lastRecalledAt",
        CASE
          WHEN last_plain.created_at IS NULL THEN last_encrypted.created_at
          WHEN last_encrypted.created_at IS NULL THEN last_plain.created_at
          WHEN last_plain.created_at >= last_encrypted.created_at THEN last_plain.created_at
          ELSE last_encrypted.created_at
        END AS "lastMessageAt",
        (
          COALESCE(plain_unread.unread_count, 0)
          + COALESCE(encrypted_unread.unread_count, 0)
        )::int AS "unreadCount",
        last_encrypted.created_at AS "lastEncryptedAt"
      FROM contacts c
      JOIN users u ON u.id = c.contact_id
      LEFT JOIN LATERAL (
        SELECT m.text, m.kind, m.recalled_at, m.created_at
        FROM messages m
        WHERE m.conversation_id = CASE
          WHEN ? < u.id THEN ? || ':' || u.id
          ELSE u.id || ':' || ?
        END
        ORDER BY m.created_at DESC
        LIMIT 1
      ) last_plain ON TRUE
      LEFT JOIN LATERAL (
        SELECT e.created_at
        FROM encrypted_messages e
        WHERE e.conversation_id = CASE
          WHEN ? < u.id THEN ? || ':' || u.id
          ELSE u.id || ':' || ?
        END
        ORDER BY e.created_at DESC
        LIMIT 1
      ) last_encrypted ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS unread_count
        FROM messages m
        WHERE m.conversation_id = CASE
          WHEN ? < u.id THEN ? || ':' || u.id
          ELSE u.id || ':' || ?
        END
          AND m.to_id = ?
          AND m.read_at IS NULL
          AND m.recalled_at IS NULL
      ) plain_unread ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS unread_count
        FROM encrypted_messages e
        WHERE e.conversation_id = CASE
          WHEN ? < u.id THEN ? || ':' || u.id
          ELSE u.id || ':' || ?
        END
          AND e.recipient_id = ?
          AND e.read_at IS NULL
          AND e.recalled_at IS NULL
      ) encrypted_unread ON TRUE
      WHERE c.owner_id = ? AND u.disabled_at IS NULL
      ORDER BY COALESCE(
        CASE
          WHEN last_plain.created_at IS NULL THEN last_encrypted.created_at
          WHEN last_encrypted.created_at IS NULL THEN last_plain.created_at
          WHEN last_plain.created_at >= last_encrypted.created_at THEN last_plain.created_at
          ELSE last_encrypted.created_at
        END,
        ''
      ) DESC
    `).all(
      user.id, user.id, user.id,
      user.id, user.id, user.id,
      user.id, user.id, user.id, user.id,
      user.id, user.id, user.id, user.id,
      user.id
    );
    const contacts = rows.map((row) => {
      const encryptedIsLatest = Boolean(
        row.lastEncryptedAt
        && String(row.lastEncryptedAt) === String(row.lastMessageAt)
      );
      return {
        ...sanitizeUser(rowToUser(row)),
        lastMessage: encryptedIsLatest
          ? '[加密聊天]'
          : messagePreview({
            text: row.lastText || '',
            kind: row.lastKind || 'text',
            recalledAt: row.lastRecalledAt || null
          }),
        lastMessageAt: row.lastMessageAt || null,
        unreadCount: row.unreadCount
      };
    });
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