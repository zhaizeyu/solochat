import crypto from 'node:crypto';
import { deleteChatImageStorage } from './chat-images.js';
import { getDb } from './db.js';

const EPOCH_START = '1970-01-01T00:00:00.000Z';

export function messageHideSql(alias = 'm') {
  return `
    NOT EXISTS (
      SELECT 1
      FROM conversation_message_hides h
      WHERE h.user_id = ?
        AND h.conversation_id = ${alias}.conversation_id
        AND ${alias}.created_at >= h.start_at
        AND ${alias}.created_at <= h.end_at
    )
  `;
}

export function parseCleanupRequest(body = {}) {
  const scope = String(body.scope || 'self').trim();
  if (scope !== 'self' && scope !== 'both') {
    return { error: '请选择清理范围' };
  }
  const mode = String(body.mode || '').trim();
  if (mode === 'all') {
    return {
      scope,
      mode: 'all',
      startAt: EPOCH_START,
      endAt: new Date().toISOString()
    };
  }
  if (mode !== 'range') {
    return { error: '请选择清理方式' };
  }
  const startAt = String(body.startAt || '').trim();
  const endAt = String(body.endAt || '').trim();
  if (!startAt || !endAt) {
    return { error: '请选择起止时间' };
  }
  const startMs = Date.parse(startAt);
  const endMs = Date.parse(endAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return { error: '时间格式无效' };
  }
  if (startMs > endMs) {
    return { error: '开始时间不能晚于结束时间' };
  }
  return {
    scope,
    mode: 'range',
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(endMs).toISOString()
  };
}

/** @deprecated use parseCleanupRequest */
export function parseHideBounds(body = {}) {
  const parsed = parseCleanupRequest({ ...body, scope: 'self' });
  if (parsed.error) return parsed;
  return {
    mode: parsed.mode,
    startAt: parsed.startAt,
    endAt: parsed.endAt
  };
}

export async function countHideableMessages(userId, conversationId, startAt, endAt) {
  const db = getDb();
  const hideSql = messageHideSql('m');
  const plain = await db.prepare(`
    SELECT COUNT(*)::int AS count
    FROM messages m
    WHERE m.conversation_id = ?
      AND m.created_at >= ?
      AND m.created_at <= ?
      AND ${hideSql}
  `).get(conversationId, startAt, endAt, userId);
  const encrypted = await db.prepare(`
    SELECT COUNT(*)::int AS count
    FROM encrypted_messages m
    WHERE m.conversation_id = ?
      AND m.created_at >= ?
      AND m.created_at <= ?
      AND ${hideSql}
  `).get(conversationId, startAt, endAt, userId);
  return Number(plain?.count || 0) + Number(encrypted?.count || 0);
}

export async function countPurgeableMessages(conversationId, startAt, endAt) {
  const db = getDb();
  const plain = await db.prepare(`
    SELECT COUNT(*)::int AS count
    FROM messages
    WHERE conversation_id = ?
      AND created_at >= ?
      AND created_at <= ?
  `).get(conversationId, startAt, endAt);
  const encrypted = await db.prepare(`
    SELECT COUNT(*)::int AS count
    FROM encrypted_messages
    WHERE conversation_id = ?
      AND created_at >= ?
      AND created_at <= ?
  `).get(conversationId, startAt, endAt);
  return Number(plain?.count || 0) + Number(encrypted?.count || 0);
}

export async function countCleanupMessages(userId, conversationId, request) {
  if (request.scope === 'both') {
    return countPurgeableMessages(conversationId, request.startAt, request.endAt);
  }
  return countHideableMessages(userId, conversationId, request.startAt, request.endAt);
}

export async function createConversationMessageHide(userId, conversationId, { mode, startAt, endAt }) {
  const db = getDb();
  const now = new Date().toISOString();
  const count = await countHideableMessages(userId, conversationId, startAt, endAt);

  if (mode === 'all') {
    await db.prepare(`
      DELETE FROM conversation_message_hides
      WHERE user_id = ? AND conversation_id = ?
    `).run(userId, conversationId);
  }

  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO conversation_message_hides (
      id, user_id, conversation_id, start_at, end_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, userId, conversationId, startAt, endAt, now);

  return {
    id,
    conversationId,
    startAt,
    endAt,
    mode,
    hiddenCount: count,
    createdAt: now
  };
}

async function collectImagePaths(conversationId, startAt, endAt) {
  const db = getDb();
  const plain = await db.prepare(`
    SELECT DISTINCT image_path AS "imagePath"
    FROM messages
    WHERE conversation_id = ?
      AND created_at >= ?
      AND created_at <= ?
      AND image_path IS NOT NULL
      AND image_path <> ''
  `).all(conversationId, startAt, endAt);
  const encrypted = await db.prepare(`
    SELECT DISTINCT image_path AS "imagePath"
    FROM encrypted_messages
    WHERE conversation_id = ?
      AND created_at >= ?
      AND created_at <= ?
      AND image_path IS NOT NULL
      AND image_path <> ''
  `).all(conversationId, startAt, endAt);
  return [...new Set([...plain, ...encrypted].map((row) => row.imagePath).filter(Boolean))];
}

export async function purgeConversationMessages(conversationId, { mode, startAt, endAt }) {
  const db = getDb();
  const count = await countPurgeableMessages(conversationId, startAt, endAt);
  const imagePaths = await collectImagePaths(conversationId, startAt, endAt);

  await db.prepare(`
    DELETE FROM messages
    WHERE conversation_id = ?
      AND created_at >= ?
      AND created_at <= ?
  `).run(conversationId, startAt, endAt);
  await db.prepare(`
    DELETE FROM encrypted_messages
    WHERE conversation_id = ?
      AND created_at >= ?
      AND created_at <= ?
  `).run(conversationId, startAt, endAt);

  // Drop hide ranges fully covered by this purge window for cleanliness.
  await db.prepare(`
    DELETE FROM conversation_message_hides
    WHERE conversation_id = ?
      AND start_at >= ?
      AND end_at <= ?
  `).run(conversationId, startAt, endAt);

  for (const imagePath of imagePaths) {
    await deleteChatImageStorage(imagePath);
  }

  return {
    conversationId,
    startAt,
    endAt,
    mode,
    deletedCount: count
  };
}

export async function runConversationCleanup(userId, conversationId, request) {
  if (request.scope === 'both') {
    const purge = await purgeConversationMessages(conversationId, request);
    return {
      scope: 'both',
      count: purge.deletedCount,
      purge,
      hint: '已对双方彻底删除，数据不可恢复'
    };
  }
  const hide = await createConversationMessageHide(userId, conversationId, request);
  return {
    scope: 'self',
    count: hide.hiddenCount,
    hide,
    hint: '仅对自己隐藏，对方仍可见这些消息'
  };
}
