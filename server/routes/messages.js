import crypto from 'node:crypto';
import { recallWindowMs } from '../config.js';
import {
  deleteChatImageStorage,
  ensureMessageImageState,
  saveChatImageDataUrl
} from '../chat-images.js';
import {
  areContacts,
  execTransaction,
  getDb,
  getMessageById,
  getStickerByIdForOwner,
  getUserById,
  messageForClient,
  messageSelect,
  rowToMessage
} from '../db.js';
import { json, readBody } from '../http-utils.js';
import { isSecureConversationActive } from './secure-conversations.js';
import { storedImageUrlForClient } from '../uploads.js';
import { conversationKey, messagePreview, parseJson, stringifyJson } from '../utils.js';

async function updateQuotesForRecalledMessage(message, now) {
  const db = getDb();
  const rows = await db.prepare(`
    SELECT id, quote_json AS "quoteJson"
    FROM messages
    WHERE conversation_id = ? AND quote_json IS NOT NULL
  `).all(message.conversationId);
  const update = db.prepare('UPDATE messages SET quote_json = ? WHERE id = ?');
  for (const row of rows) {
    const quote = parseJson(row.quoteJson);
    if (quote?.id === message.id) {
      await update.run(
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

async function mapMessagesForClient(messages) {
  const mapped = [];
  for (const message of messages) {
    mapped.push(messageForClient(await ensureMessageImageState(message)));
  }
  return mapped;
}

export async function handleMessages(req, res, pathName, user, url) {
  const db = getDb();

  if (req.method === 'GET' && pathName.startsWith('/api/messages/')) {
    const contactId = pathName.split('/').pop();
    const target = await getUserById(contactId);
    if (!target || target.disabledAt || !(await areContacts(user.id, target.id))) {
      return json(res, 404, { message: '联系人不存在' });
    }
    const key = conversationKey(user.id, target.id);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 100);
    const before = url.searchParams.get('before');
    const after = url.searchParams.get('after');
    let rows;

    if (after) {
      rows = await db
        .prepare(`
          SELECT ${messageSelect()}
          FROM messages
          WHERE conversation_id = ? AND created_at > ?
          ORDER BY created_at ASC
          LIMIT ?
        `)
        .all(key, after, limit);
    } else if (before) {
      rows = (await db
        .prepare(`
          SELECT ${messageSelect()}
          FROM messages
          WHERE conversation_id = ? AND created_at < ?
          ORDER BY created_at DESC
          LIMIT ?
        `)
        .all(key, before, limit))
        .reverse();
    } else {
      rows = (await db
        .prepare(`
          SELECT ${messageSelect()}
          FROM messages
          WHERE conversation_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `)
        .all(key, limit))
        .reverse();
    }

    const messages = rows.map(rowToMessage);
    const firstCreatedAt = messages[0]?.createdAt || before || null;
    const hasMore = firstCreatedAt
      ? Boolean(
          await db
            .prepare('SELECT 1 FROM messages WHERE conversation_id = ? AND created_at < ? LIMIT 1')
            .get(key, firstCreatedAt)
        )
      : false;
    return json(res, 200, { messages: await mapMessagesForClient(messages), hasMore });
  }

  if (req.method === 'POST' && pathName.startsWith('/api/messages/') && pathName.endsWith('/read')) {
    const parts = pathName.split('/');
    const contactId = parts.at(-2);
    const target = await getUserById(contactId);
    if (!target || target.disabledAt || !(await areContacts(user.id, target.id))) {
      return json(res, 404, { message: '联系人不存在' });
    }
    const key = conversationKey(user.id, target.id);
    const now = new Date().toISOString();
    const plainResult = await db.prepare(`
      UPDATE messages
      SET read_at = ?
      WHERE conversation_id = ? AND to_id = ? AND read_at IS NULL
    `).run(now, key, user.id);
    const encryptedResult = await db.prepare(`
      UPDATE encrypted_messages
      SET read_at = ?
      WHERE conversation_id = ? AND recipient_id = ? AND read_at IS NULL
    `).run(now, key, user.id);
    const changed = Boolean(plainResult.changes || encryptedResult.changes);
    return json(res, 200, { ok: true, readAt: changed ? now : null });
  }

  if (req.method === 'PATCH' && pathName.startsWith('/api/messages/') && pathName.endsWith('/recall')) {
    const parts = pathName.split('/');
    const messageId = parts.at(-2);
    const message = await getMessageById(messageId);
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
    await execTransaction(async () => {
      await db.prepare('UPDATE messages SET recalled_at = ?, text = ? WHERE id = ?').run(now, '', message.id);
      await updateQuotesForRecalledMessage(message, now);
    });
    if (message.kind === 'image' && message.imagePath && !message.imageDeletedAt) {
      await deleteChatImageStorage(message.imagePath);
    }
    return json(res, 200, { message: messageForClient(await ensureMessageImageState(await getMessageById(message.id))) });
  }

  if (req.method === 'POST' && pathName === '/api/messages') {
    const body = await readBody(req);
    const toId = String(body.toId || '');
    const kind = body.kind === 'sticker' ? 'sticker' : body.kind === 'image' ? 'image' : 'text';
    const text = String(body.text || '').trim();
    const quoteId = String(body.quoteId || '');
    const stickerId = String(body.stickerId || '');
    const imageDataUrl = String(body.imageDataUrl || '');
    const target = await getUserById(toId);
    if (!target || target.disabledAt || !(await areContacts(user.id, target.id))) {
      return json(res, 404, { message: '联系人不存在' });
    }
    if (kind === 'text' && !text) {
      return json(res, 400, { message: '消息不能为空' });
    }
    if (text.length > 1000) {
      return json(res, 400, { message: '消息最多 1000 字' });
    }
    let sticker = null;
    let imagePath = null;
    let imageExpiresAt = null;
    if (kind === 'sticker') {
      sticker = await getStickerByIdForOwner(stickerId, user.id);
      if (!sticker) {
        return json(res, 404, { message: '表情包不存在' });
      }
    }
    if (kind === 'image') {
      try {
        const saved = await saveChatImageDataUrl(imageDataUrl, user.id);
        imagePath = saved.imagePath;
        imageExpiresAt = saved.expiresAt;
      } catch (error) {
        return json(res, error.statusCode || 400, { message: error.message || '图片上传失败' });
      }
    }
    const conversationId = conversationKey(user.id, target.id);
    if ((kind === 'text' || kind === 'image') && (await isSecureConversationActive(conversationId))) {
      return json(res, 409, { message: '安全聊天进行中，请直接发送消息（会自动加密）' });
    }
    let quote = null;
    if (quoteId) {
      const quotedMessage = await db
        .prepare(`SELECT ${messageSelect()} FROM messages WHERE id = ? AND conversation_id = ?`)
        .get(quoteId, conversationId);
      const quoted = rowToMessage(quotedMessage);
      if (!quoted) {
        return json(res, 400, { message: '引用的消息不存在' });
      }
      const author = await getUserById(quoted.fromId);
      quote = {
        id: quoted.id,
        fromId: quoted.fromId,
        authorName: author?.displayName || '已注销用户',
        text: messagePreview(quoted),
        kind: quoted.kind || 'text',
        sticker: quoted.kind === 'sticker' && quoted.sticker
          ? {
              id: quoted.sticker.id,
              name: '表情包',
              imageDataUrl: quoted.sticker.imageDataUrl
            }
          : null,
        imageDataUrl: quoted.kind === 'image' && !quoted.imageDeletedAt
          ? storedImageUrlForClient(quoted.imagePath || '')
          : null,
        imageExpired: quoted.kind === 'image' ? Boolean(quoted.imageDeletedAt || quoted.imageExpired) : false,
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
      text: kind === 'sticker' ? '[表情包]' : kind === 'image' ? '[图片]' : text,
      sticker: sticker
        ? {
            id: sticker.id,
            name: sticker.name,
            imageDataUrl: sticker.imageDataUrl
          }
        : null,
      imagePath,
      imageExpiresAt,
      imageDeletedAt: null,
      quote,
      createdAt: new Date().toISOString(),
      readAt: null,
      recalledAt: null
    };
    await db.prepare(`
      INSERT INTO messages (
        id, conversation_id, from_id, to_id, kind, text, sticker_json, quote_json,
        image_path, image_expires_at, image_deleted_at,
        created_at, read_at, recalled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      message.id,
      message.conversationId,
      message.fromId,
      message.toId,
      message.kind,
      message.text,
      stringifyJson(message.sticker),
      stringifyJson(message.quote),
      message.imagePath,
      message.imageExpiresAt,
      null,
      message.createdAt,
      null,
      null
    );
    return json(res, 201, { message: messageForClient(message) });
  }

  return false;
}
