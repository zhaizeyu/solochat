import crypto from 'node:crypto';
import { recallWindowMs } from '../config.js';
import {
  areContacts,
  execTransaction,
  getDb,
  getMessageById,
  getStickerByIdForOwner,
  getUserById,
  messageSelect,
  rowToMessage
} from '../db.js';
import { json, readBody } from '../http-utils.js';
import { conversationKey, messagePreview, parseJson, stringifyJson } from '../utils.js';

function updateQuotesForRecalledMessage(message, now) {
  const db = getDb();
  const rows = db.prepare(`SELECT id, quote_json AS quoteJson FROM messages WHERE quote_json IS NOT NULL`).all();
  const update = db.prepare('UPDATE messages SET quote_json = ? WHERE id = ?');
  for (const row of rows) {
    const quote = parseJson(row.quoteJson);
    if (quote?.id === message.id) {
      update.run(
        stringifyJson({
          ...quote,
          text: '消息已撤回',
          recalledAt: now
        }),
        row.id
      );
    }
  }
}

export async function handleMessages(req, res, pathName, user, url) {
  const db = getDb();

  if (req.method === 'GET' && pathName.startsWith('/api/messages/')) {
    const contactId = pathName.split('/').pop();
    const target = getUserById(contactId);
    if (!target || target.disabledAt || !areContacts(user.id, target.id)) {
      return json(res, 404, { message: '联系人不存在' });
    }
    const key = conversationKey(user.id, target.id);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 100);
    const before = url.searchParams.get('before');
    const after = url.searchParams.get('after');
    let rows;

    if (after) {
      rows = db
        .prepare(`
          SELECT ${messageSelect()}
          FROM messages
          WHERE conversation_id = ? AND created_at > ?
          ORDER BY created_at ASC
          LIMIT ?
        `)
        .all(key, after, limit);
    } else if (before) {
      rows = db
        .prepare(`
          SELECT ${messageSelect()}
          FROM messages
          WHERE conversation_id = ? AND created_at < ?
          ORDER BY created_at DESC
          LIMIT ?
        `)
        .all(key, before, limit)
        .reverse();
    } else {
      rows = db
        .prepare(`
          SELECT ${messageSelect()}
          FROM messages
          WHERE conversation_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `)
        .all(key, limit)
        .reverse();
    }

    const messages = rows.map(rowToMessage);
    const firstCreatedAt = messages[0]?.createdAt || before || null;
    const hasMore = firstCreatedAt
      ? Boolean(
          db
            .prepare('SELECT 1 FROM messages WHERE conversation_id = ? AND created_at < ? LIMIT 1')
            .get(key, firstCreatedAt)
        )
      : false;
    return json(res, 200, { messages, hasMore });
  }

  if (req.method === 'POST' && pathName.startsWith('/api/messages/') && pathName.endsWith('/read')) {
    const parts = pathName.split('/');
    const contactId = parts.at(-2);
    const target = getUserById(contactId);
    if (!target || target.disabledAt || !areContacts(user.id, target.id)) {
      return json(res, 404, { message: '联系人不存在' });
    }
    const key = conversationKey(user.id, target.id);
    const now = new Date().toISOString();
    const result = db.prepare(`
      UPDATE messages
      SET read_at = ?
      WHERE conversation_id = ? AND to_id = ? AND read_at IS NULL
    `).run(now, key, user.id);
    return json(res, 200, { ok: true, readAt: result.changes ? now : null });
  }

  if (req.method === 'PATCH' && pathName.startsWith('/api/messages/') && pathName.endsWith('/recall')) {
    const parts = pathName.split('/');
    const messageId = parts.at(-2);
    const message = getMessageById(messageId);
    if (!message || message.fromId !== user.id) {
      return json(res, 404, { message: '消息不存在' });
    }
    if (message.recalledAt) {
      return json(res, 400, { message: '消息已撤回' });
    }
    if (Date.now() - new Date(message.createdAt).getTime() > recallWindowMs) {
      return json(res, 400, { message: '消息发送超过 8 分钟，不能撤回' });
    }
    const now = new Date().toISOString();
    execTransaction(() => {
      db.prepare('UPDATE messages SET recalled_at = ?, text = ? WHERE id = ?').run(now, '', message.id);
      updateQuotesForRecalledMessage(message, now);
    });
    return json(res, 200, { message: getMessageById(message.id) });
  }

  if (req.method === 'POST' && pathName === '/api/messages') {
    const body = await readBody(req);
    const toId = String(body.toId || '');
    const kind = body.kind === 'sticker' ? 'sticker' : 'text';
    const text = String(body.text || '').trim();
    const quoteId = String(body.quoteId || '');
    const stickerId = String(body.stickerId || '');
    const target = getUserById(toId);
    if (!target || target.disabledAt || !areContacts(user.id, target.id)) {
      return json(res, 404, { message: '联系人不存在' });
    }
    if (kind === 'text' && !text) {
      return json(res, 400, { message: '消息不能为空' });
    }
    if (text.length > 1000) {
      return json(res, 400, { message: '消息最多 1000 字' });
    }
    let sticker = null;
    if (kind === 'sticker') {
      sticker = getStickerByIdForOwner(stickerId, user.id);
      if (!sticker) {
        return json(res, 404, { message: '表情包不存在' });
      }
    }
    const conversationId = conversationKey(user.id, target.id);
    let quote = null;
    if (quoteId) {
      const quotedMessage = db
        .prepare(`SELECT ${messageSelect()} FROM messages WHERE id = ? AND conversation_id = ?`)
        .get(quoteId, conversationId);
      const quoted = rowToMessage(quotedMessage);
      if (!quoted) {
        return json(res, 400, { message: '引用的消息不存在' });
      }
      const author = getUserById(quoted.fromId);
      quote = {
        id: quoted.id,
        fromId: quoted.fromId,
        authorName: author?.displayName || '已注销用户',
        text: messagePreview(quoted),
        kind: quoted.kind || 'text',
        sticker: quoted.kind === 'sticker' && quoted.sticker
          ? {
              id: quoted.sticker.id,
              name: quoted.sticker.name,
              imageDataUrl: quoted.sticker.imageDataUrl
            }
          : null,
        createdAt: quoted.createdAt,
        recalledAt: quoted.recalledAt || null
      };
    }
    const message = {
      id: crypto.randomUUID(),
      conversationId,
      fromId: user.id,
      toId: target.id,
      kind,
      text: kind === 'sticker' ? '[表情包]' : text,
      sticker: sticker
        ? {
            id: sticker.id,
            name: sticker.name,
            imageDataUrl: sticker.imageDataUrl
          }
        : null,
      quote,
      createdAt: new Date().toISOString(),
      readAt: null,
      recalledAt: null
    };
    db.prepare(`
      INSERT INTO messages (
        id, conversation_id, from_id, to_id, kind, text, sticker_json, quote_json,
        created_at, read_at, recalled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      message.id,
      message.conversationId,
      message.fromId,
      message.toId,
      message.kind,
      message.text,
      stringifyJson(message.sticker),
      stringifyJson(message.quote),
      message.createdAt,
      null,
      null
    );
    return json(res, 201, { message });
  }

  return false;
}
