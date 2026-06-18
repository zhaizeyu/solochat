import crypto from 'node:crypto';
import { maxImageDataUrlLength } from '../config.js';
import { getDb, getStickerByIdForOwner, rowToSticker, sanitizeSticker, stickerSelect } from '../db.js';
import { json, readBody } from '../http-utils.js';
import { isR2PublicUrl, saveImageDataUrl } from '../uploads.js';
import { isImageDataUrl, normalizeName } from '../utils.js';

export async function handleStickers(req, res, pathName, user) {
  const db = getDb();

  if (req.method === 'GET' && pathName === '/api/stickers') {
    const stickers = (await db
      .prepare(`SELECT ${stickerSelect()} FROM stickers WHERE owner_id = ? ORDER BY created_at DESC`)
      .all(user.id))
      .map(rowToSticker)
      .map(sanitizeSticker);
    return json(res, 200, { stickers });
  }

  if (req.method === 'POST' && pathName === '/api/stickers') {
    const body = await readBody(req);
    const name = normalizeName(body.name).slice(0, 32) || '表情包';
    const imageDataUrl = String(body.imageDataUrl || '');
    const isStoredImage = isR2PublicUrl(imageDataUrl);
    if ((!isImageDataUrl(imageDataUrl) || imageDataUrl.length > maxImageDataUrlLength) && !isStoredImage) {
      return json(res, 400, { message: '表情包需为 700KB 以内的图片' });
    }
    const imagePath = isStoredImage
      ? imageDataUrl
      : await saveImageDataUrl(imageDataUrl, 'stickers', crypto.randomUUID());
    const sticker = {
      id: crypto.randomUUID(),
      ownerId: user.id,
      name,
      imageDataUrl: imagePath,
      imagePath,
      createdAt: new Date().toISOString()
    };
    await db.prepare('INSERT INTO stickers (id, owner_id, name, image_path, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(sticker.id, sticker.ownerId, sticker.name, sticker.imagePath, sticker.createdAt);
    return json(res, 201, { sticker: sanitizeSticker(sticker) });
  }

  if (req.method === 'DELETE' && pathName.startsWith('/api/stickers/')) {
    const stickerId = pathName.split('/').pop();
    const sticker = await getStickerByIdForOwner(stickerId, user.id);
    if (!sticker) {
      return json(res, 404, { message: '表情包不存在' });
    }
    await db.prepare('DELETE FROM stickers WHERE id = ? AND owner_id = ?').run(sticker.id, user.id);
    return json(res, 200, { ok: true });
  }

  return false;
}
