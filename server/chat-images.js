import crypto from 'node:crypto';
import {
  chatImageMaxDataUrlLength,
  chatImageMaxBytes,
  chatImageCleanupHour,
  chatImageCleanupTimeZone,
  chatImageUploadHourlyLimit
} from './config.js';
import { getDb } from './db.js';
import { deleteStoredImage, saveImageDataUrl } from './uploads.js';
import { isImageDataUrl } from './utils.js';

function estimateDataUrlBytes(dataUrl) {
  const match = String(dataUrl || '').match(/^data:image\/(?:png|jpe?g|gif|webp);base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) return Number.POSITIVE_INFINITY;
  const base64 = match[1];
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function zonedDateTimeParts(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

function zonedLocalTimeToUtcMs(year, month, day, hour, minute, second, timeZone) {
  let guess = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 4; i += 1) {
    const parts = zonedDateTimeParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const target = Date.UTC(year, month - 1, day, hour, minute, second);
    const delta = target - asUtc;
    if (delta === 0) break;
    guess += delta;
  }
  return guess;
}

function advanceOneCalendarDay(year, month, day, timeZone) {
  const probe = new Date(zonedLocalTimeToUtcMs(year, month, day, 12, 0, 0, timeZone) + 24 * 60 * 60 * 1000);
  return zonedDateTimeParts(probe, timeZone);
}

/**
 * Expire at the next day's daily cleanup time (default 04:00 Asia/Shanghai).
 * Images sent on the same calendar day share the same expiry and are removed together.
 */
export function chatImageExpiresAt(fromDate = new Date()) {
  const timeZone = chatImageCleanupTimeZone;
  const hour = chatImageCleanupHour;
  const parts = zonedDateTimeParts(fromDate, timeZone);
  const nextDay = advanceOneCalendarDay(parts.year, parts.month, parts.day, timeZone);
  return new Date(
    zonedLocalTimeToUtcMs(nextDay.year, nextDay.month, nextDay.day, hour, 0, 0, timeZone)
  ).toISOString();
}

export function isChatImageExpired(expiresAt, now = Date.now()) {
  if (!expiresAt) return false;
  const expires = new Date(expiresAt).getTime();
  return Number.isFinite(expires) && expires <= now;
}

/** Next daily cleanup instant in the configured timezone (default 04:00 Asia/Shanghai). */
export function nextChatImageCleanupAt(fromDate = new Date()) {
  const timeZone = chatImageCleanupTimeZone;
  const hour = chatImageCleanupHour;
  const parts = zonedDateTimeParts(fromDate, timeZone);
  let year = parts.year;
  let month = parts.month;
  let day = parts.day;
  let candidate = zonedLocalTimeToUtcMs(year, month, day, hour, 0, 0, timeZone);
  if (candidate <= fromDate.getTime()) {
    const advanced = advanceOneCalendarDay(year, month, day, timeZone);
    year = advanced.year;
    month = advanced.month;
    day = advanced.day;
    candidate = zonedLocalTimeToUtcMs(year, month, day, hour, 0, 0, timeZone);
  }
  return new Date(candidate);
}

export async function saveChatImageDataUrl(imageDataUrl, userId) {
  const value = String(imageDataUrl || '');
  if (!isImageDataUrl(value) || value.length > chatImageMaxDataUrlLength) {
    throw Object.assign(new Error('临时图片需为 2MB 以内的图片'), { statusCode: 400 });
  }
  if (estimateDataUrlBytes(value) > chatImageMaxBytes) {
    throw Object.assign(new Error('临时图片需为 2MB 以内的图片'), { statusCode: 400 });
  }
  const db = getDb();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const plainCount = await db.prepare(`
    SELECT COUNT(*)::int AS count
    FROM messages
    WHERE from_id = ? AND kind = 'image' AND created_at >= ?
  `).get(userId, since);
  const encryptedCount = await db.prepare(`
    SELECT COUNT(*)::int AS count
    FROM encrypted_messages
    WHERE sender_id = ? AND image_path IS NOT NULL AND image_path <> '' AND created_at >= ?
  `).get(userId, since);
  const used = Number(plainCount?.count || 0) + Number(encryptedCount?.count || 0);
  if (used >= chatImageUploadHourlyLimit) {
    throw Object.assign(new Error('发送图片过于频繁，请稍后再试'), { statusCode: 429 });
  }
  const imagePath = await saveImageDataUrl(value, 'chat-images', `${userId}-${crypto.randomUUID()}`);
  return {
    imagePath,
    expiresAt: chatImageExpiresAt()
  };
}

export async function markChatImageDeleted(imagePath) {
  if (!imagePath) return;
  const db = getDb();
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE messages
    SET image_deleted_at = COALESCE(image_deleted_at, ?), text = ?
    WHERE image_path = ? AND image_deleted_at IS NULL
  `).run(now, '[图片已过期删除]', imagePath);
  await db.prepare(`
    UPDATE encrypted_messages
    SET image_deleted_at = COALESCE(image_deleted_at, ?)
    WHERE image_path = ? AND image_deleted_at IS NULL
  `).run(now, imagePath);
}

export async function deleteChatImageStorage(imagePath) {
  if (!imagePath) return;
  await deleteStoredImage(imagePath).catch(() => {});
  await markChatImageDeleted(imagePath);
}

export async function expireDueChatImages({ limit = 100 } = {}) {
  const db = getDb();
  const now = new Date().toISOString();
  const plain = await db.prepare(`
    SELECT DISTINCT image_path AS "imagePath"
    FROM messages
    WHERE kind = 'image'
      AND image_path IS NOT NULL
      AND image_path <> ''
      AND image_deleted_at IS NULL
      AND image_expires_at IS NOT NULL
      AND image_expires_at <= ?
    LIMIT ?
  `).all(now, limit);
  const encrypted = await db.prepare(`
    SELECT DISTINCT image_path AS "imagePath"
    FROM encrypted_messages
    WHERE image_path IS NOT NULL
      AND image_path <> ''
      AND image_deleted_at IS NULL
      AND image_expires_at IS NOT NULL
      AND image_expires_at <= ?
    LIMIT ?
  `).all(now, limit);

  const paths = [...new Set([...plain, ...encrypted].map((row) => row.imagePath).filter(Boolean))];
  let deleted = 0;
  for (const imagePath of paths) {
    await deleteChatImageStorage(imagePath);
    deleted += 1;
  }
  return { deleted, checked: paths.length };
}

/** Run the daily sweep until no more expired images remain. */
export async function expireAllDueChatImages({ batchSize = 200, maxBatches = 50 } = {}) {
  let deleted = 0;
  let batches = 0;
  for (let i = 0; i < maxBatches; i += 1) {
    const result = await expireDueChatImages({ limit: batchSize });
    batches += 1;
    deleted += result.deleted;
    if (result.deleted === 0) break;
  }
  return { deleted, batches };
}

export async function ensureMessageImageState(message) {
  if (!message || message.kind !== 'image') return message;
  if (message.imageDeletedAt) {
    return {
      ...message,
      text: message.text || '[图片已过期删除]',
      imageDataUrl: '',
      imageExpired: true
    };
  }
  if (isChatImageExpired(message.imageExpiresAt) && message.imagePath) {
    await deleteChatImageStorage(message.imagePath);
    return {
      ...message,
      imageDeletedAt: new Date().toISOString(),
      text: '[图片已过期删除]',
      imageDataUrl: '',
      imageExpired: true
    };
  }
  return {
    ...message,
    imageExpired: false
  };
}

export function scheduleDailyChatImageCleanup(runCleanup) {
  let timer = null;

  async function tick() {
    try {
      await runCleanup();
    } finally {
      const delay = Math.max(1000, nextChatImageCleanupAt().getTime() - Date.now());
      timer = setTimeout(tick, delay);
      timer.unref?.();
    }
  }

  const firstDelay = Math.max(1000, nextChatImageCleanupAt().getTime() - Date.now());
  timer = setTimeout(tick, firstDelay);
  timer.unref?.();

  return {
    nextAt: nextChatImageCleanupAt(),
    stop() {
      if (timer) clearTimeout(timer);
    }
  };
}
