import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { uploadsDir } from './config.js';
import { json } from './http-utils.js';

function imageExtensionFromMime(mime) {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

export async function saveImageDataUrl(dataUrl, folder, fileBaseName) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:png|jpe?g|gif|webp));base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) {
    throw new Error('图片格式无效');
  }
  const [, mime, base64] = match;
  const ext = imageExtensionFromMime(mime);
  const safeBaseName = String(fileBaseName || crypto.randomUUID()).replace(/[^a-zA-Z0-9._-]/g, '_');
  const relativePath = `/uploads/${folder}/${safeBaseName}.${ext}`;
  const absoluteDir = path.join(uploadsDir, folder);
  const absolutePath = path.join(absoluteDir, `${safeBaseName}.${ext}`);
  await mkdir(absoluteDir, { recursive: true });
  await writeFile(absolutePath, Buffer.from(base64, 'base64'));
  return relativePath;
}

export async function serveUpload(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const relative = decodeURIComponent(url.pathname.replace(/^\/uploads\//, ''));
  const filePath = path.normalize(path.join(uploadsDir, relative));
  if (!filePath.startsWith(uploadsDir + path.sep)) {
    return json(res, 400, { message: '文件路径无效' });
  }
  if (!existsSync(filePath)) {
    return json(res, 404, { message: '文件不存在' });
  }
  const ext = path.extname(filePath).toLowerCase();
  const contentType = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp'
  }[ext] || 'application/octet-stream';
  const buffer = await readFile(filePath);
  res.writeHead(200, {
    'content-type': contentType,
    'cache-control': 'public, max-age=31536000, immutable'
  });
  res.end(buffer);
}
