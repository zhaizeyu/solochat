import crypto from 'node:crypto';
import { maxImageDataUrlLength } from '../config.js';
import {
  areContacts,
  getDb,
  getMomentForUser,
  getMoments,
  getUserById
} from '../db.js';
import { json, readBody } from '../http-utils.js';
import { isStoredImageUrl, r2PublicUrlForStoredImage, saveImageDataUrl } from '../uploads.js';
import { conversationKey, isImageDataUrl } from '../utils.js';

function normalizeMomentText(value) {
  return String(value || '').trim().slice(0, 1000);
}

function normalizeMomentDate(value) {
  const date = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Date().toISOString().slice(0, 10);
}

async function saveMomentImage(imageDataUrl, momentId) {
  if (!imageDataUrl) return null;
  const isStoredImage = isStoredImageUrl(imageDataUrl);
  if ((!isImageDataUrl(imageDataUrl) || imageDataUrl.length > maxImageDataUrlLength) && !isStoredImage) {
    throw new Error('图片需为 700KB 以内的图片');
  }
  return isStoredImage
    ? r2PublicUrlForStoredImage(imageDataUrl)
    : saveImageDataUrl(imageDataUrl, 'moments', momentId);
}

export async function handleMoments(req, res, pathName, user) {
  const db = getDb();

  if (req.method === 'GET' && pathName.startsWith('/api/moments/')) {
    const contactId = pathName.split('/').pop();
    const target = await getUserById(contactId);
    if (!target || target.disabledAt || !(await areContacts(user.id, target.id))) {
      return json(res, 404, { message: '联系人不存在' });
    }
    const conversationId = conversationKey(user.id, target.id);
    return json(res, 200, { moments: await getMoments(conversationId) });
  }

  if (req.method === 'POST' && pathName.startsWith('/api/moments/')) {
    const contactId = pathName.split('/').pop();
    const target = await getUserById(contactId);
    if (!target || target.disabledAt || !(await areContacts(user.id, target.id))) {
      return json(res, 404, { message: '联系人不存在' });
    }
    const body = await readBody(req);
    const text = normalizeMomentText(body.text);
    if (!text) {
      return json(res, 400, { message: '回忆内容不能为空' });
    }
    const id = crypto.randomUUID();
    let imagePath = null;
    try {
      imagePath = await saveMomentImage(String(body.imageDataUrl || ''), id);
    } catch (error) {
      return json(res, 400, { message: error.message });
    }
    const now = new Date().toISOString();
    const conversationId = conversationKey(user.id, target.id);
    await db.prepare(`
      INSERT INTO couple_moments (
        id, conversation_id, author_id, text, happened_at, image_path,
        created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, conversationId, user.id, text, normalizeMomentDate(body.happenedAt), imagePath, now, now, null);
    return json(res, 201, { moments: await getMoments(conversationId) });
  }

  if (req.method === 'PATCH' && pathName.startsWith('/api/moments/items/')) {
    const momentId = pathName.split('/').pop();
    const access = await getMomentForUser(momentId, user);
    if (!access) {
      return json(res, 404, { message: '回忆不存在' });
    }
    const body = await readBody(req);
    const current = access.moment;
    const text = Object.hasOwn(body, 'text') ? normalizeMomentText(body.text) : current.text;
    if (!text) {
      return json(res, 400, { message: '回忆内容不能为空' });
    }
    let imagePath = current.imagePath;
    if (Object.hasOwn(body, 'imageDataUrl')) {
      try {
        imagePath = await saveMomentImage(String(body.imageDataUrl || ''), momentId);
      } catch (error) {
        return json(res, 400, { message: error.message });
      }
    }
    const happenedAt = Object.hasOwn(body, 'happenedAt') ? normalizeMomentDate(body.happenedAt) : current.happenedAt;
    const now = new Date().toISOString();
    await db.prepare(`
      UPDATE couple_moments
      SET text = ?, happened_at = ?, image_path = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL
    `).run(text, happenedAt, imagePath, now, momentId);
    return json(res, 200, { moments: await getMoments(current.conversationId) });
  }

  if (req.method === 'DELETE' && pathName.startsWith('/api/moments/items/')) {
    const momentId = pathName.split('/').pop();
    const access = await getMomentForUser(momentId, user);
    if (!access) {
      return json(res, 404, { message: '回忆不存在' });
    }
    const now = new Date().toISOString();
    await db.prepare('UPDATE couple_moments SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(now, now, momentId);
    return json(res, 200, { ok: true });
  }

  return false;
}
