import path from 'node:path';
import crypto from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { localUploadsDir, localUploadsPublicPath, r2Config, useLocalUploads } from './config.js';

function imageExtensionFromMime(mime) {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

function encodeS3Path(value) {
  return String(value)
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function encodeS3Query(value) {
  return encodeURIComponent(String(value));
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function isImageObjectKey(objectKey) {
  return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(path.extname(objectKey).toLowerCase());
}

function objectKeyFromR2PublicUrl(value) {
  if (!isR2PublicUrl(value)) return null;
  const base = `${r2Config.publicBaseUrl.replace(/\/+$/, '')}/`;
  return safeDecodeURIComponent(String(value).slice(base.length));
}

function objectKeyFromLocalPublicUrl(value) {
  const url = String(value || '');
  const prefix = `${localUploadsPublicPath}/`;
  if (!url.startsWith(prefix)) return null;
  return safeDecodeURIComponent(url.slice(prefix.length));
}

function safeLocalUploadPath(objectKey) {
  if (objectKey === null || objectKey === undefined) {
    throw new Error('图片路径无效');
  }
  const normalized = path.posix.normalize(String(objectKey || '').replace(/^\/+/, ''));
  if (!normalized || normalized === '.' || normalized.startsWith('../') || path.isAbsolute(normalized)) {
    throw new Error('图片路径无效');
  }
  const filePath = path.join(localUploadsDir, normalized);
  const relative = path.relative(localUploadsDir, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('图片路径无效');
  }
  return filePath;
}

export function contentTypeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp'
  }[ext] || 'application/octet-stream';
}

export function isR2PublicUrl(value) {
  return Boolean(
    r2Config.publicBaseUrl &&
      String(value || '').startsWith(`${r2Config.publicBaseUrl.replace(/\/+$/, '')}/`)
  );
}

export function isLocalUploadsPublicUrl(value) {
  return Boolean(objectKeyFromLocalPublicUrl(value));
}

export function isStoredImageUrl(value) {
  return isR2PublicUrl(value) || isLocalUploadsPublicUrl(value);
}

export function r2PublicUrlForObjectKey(objectKey) {
  if (!r2Config.publicBaseUrl) {
    throw new Error('R2 配置缺失: R2_PUBLIC_BASE_URL');
  }
  return `${r2Config.publicBaseUrl.replace(/\/+$/, '')}/${encodeS3Path(objectKey)}`;
}

export function localPublicUrlForObjectKey(objectKey) {
  return `${localUploadsPublicPath}/${encodeS3Path(objectKey)}`;
}

export function storedImageUrlForClient(value) {
  const objectKey = objectKeyFromR2PublicUrl(value) || objectKeyFromLocalPublicUrl(value);
  if (!useLocalUploads || !objectKey) return value || '';
  return existsSync(safeLocalUploadPath(objectKey)) ? localPublicUrlForObjectKey(objectKey) : value || '';
}

export function r2PublicUrlForStoredImage(value) {
  const objectKey = objectKeyFromR2PublicUrl(value) || objectKeyFromLocalPublicUrl(value);
  return objectKey ? r2PublicUrlForObjectKey(objectKey) : value || '';
}

function assertR2Config() {
  const missing = Object.entries({
    R2_BUCKET: r2Config.bucket,
    R2_ACCESS_KEY_ID: r2Config.accessKeyId,
    R2_SECRET_ACCESS_KEY: r2Config.secretAccessKey,
    S3_API_ENDPOINT: r2Config.endpoint,
    R2_PUBLIC_BASE_URL: r2Config.publicBaseUrl
  }).filter(([, value]) => !value);
  if (missing.length) {
    throw new Error(`R2 配置缺失: ${missing.map(([key]) => key).join(', ')}`);
  }
}

function r2SignedHeaders(method, objectKey, body, contentType, query = {}) {
  assertR2Config();
  const endpoint = new URL(r2Config.endpoint);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = 'auto';
  const service = 's3';
  const payloadHash = sha256Hex(body || '');
  const canonicalUri = objectKey
    ? `/${encodeS3Path(r2Config.bucket)}/${encodeS3Path(objectKey)}`
    : `/${encodeS3Path(r2Config.bucket)}`;
  const canonicalQuery = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeS3Query(value)}`)
    .join('&');
  const canonicalHeaders = [
    contentType ? `content-type:${contentType}` : null,
    `host:${endpoint.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`
  ].filter(Boolean).join('\n') + '\n';
  const signedHeaders = contentType
    ? 'content-type;host;x-amz-content-sha256;x-amz-date'
    : 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join('\n');
  const dateKey = hmac(`AWS4${r2Config.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = hmac(signingKey, stringToSign, 'hex');

  return {
    url: new URL(`${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ''}`, `${endpoint.protocol}//${endpoint.host}`).toString(),
    headers: {
      ...(contentType ? { 'content-type': contentType } : {}),
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      authorization: `AWS4-HMAC-SHA256 Credential=${r2Config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    }
  };
}

export async function putR2Object(objectKey, buffer, contentType) {
  const signed = r2SignedHeaders('PUT', objectKey, buffer, contentType);
  const response = await fetch(signed.url, {
    method: 'PUT',
    headers: signed.headers,
    body: buffer
  });
  if (!response.ok) {
    throw new Error(`R2 上传失败: ${response.status} ${await response.text()}`);
  }
}

async function getR2Object(objectKey) {
  const signed = r2SignedHeaders('GET', objectKey, '', '');
  const response = await fetch(signed.url, {
    method: 'GET',
    headers: signed.headers
  });
  if (!response.ok) {
    throw new Error(`R2 下载失败: ${response.status} ${await response.text()}`);
  }
  return response;
}

async function listR2Objects(continuationToken) {
  const signed = r2SignedHeaders('GET', '', '', '', {
    'list-type': '2',
    ...(continuationToken ? { 'continuation-token': continuationToken } : {})
  });
  const response = await fetch(signed.url, {
    method: 'GET',
    headers: signed.headers
  });
  if (!response.ok) {
    throw new Error(`R2 列表读取失败: ${response.status} ${await response.text()}`);
  }
  const xml = await response.text();
  return {
    keys: [...xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map((match) => decodeXml(match[1])),
    nextContinuationToken: decodeXml(xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] || '')
  };
}

async function writeLocalUpload(objectKey, buffer) {
  const filePath = safeLocalUploadPath(objectKey);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
}

export async function syncR2ImagesToLocal() {
  if (!useLocalUploads) return { enabled: false, downloaded: 0, skipped: 0 };
  assertR2Config();
  await mkdir(localUploadsDir, { recursive: true });

  let downloaded = 0;
  let skipped = 0;
  let continuationToken = '';

  do {
    const page = await listR2Objects(continuationToken);
    continuationToken = page.nextContinuationToken;
    for (const objectKey of page.keys) {
      if (!isImageObjectKey(objectKey)) continue;
      const filePath = safeLocalUploadPath(objectKey);
      if (existsSync(filePath)) {
        skipped += 1;
        continue;
      }
      const response = await getR2Object(objectKey);
      await mkdir(path.dirname(filePath), { recursive: true });
      await pipeline(Readable.fromWeb(response.body), createWriteStream(filePath));
      downloaded += 1;
    }
  } while (continuationToken);

  return { enabled: true, downloaded, skipped };
}

export function handleLocalUploadRequest(req, res, pathName) {
  if (!useLocalUploads || !pathName.startsWith(`${localUploadsPublicPath}/`)) return false;
  const objectKey = safeDecodeURIComponent(pathName.slice(localUploadsPublicPath.length + 1));
  let filePath;
  try {
    filePath = safeLocalUploadPath(objectKey);
  } catch {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ message: '图片路径无效' }));
    return true;
  }
  if (!existsSync(filePath)) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ message: '图片不存在' }));
    return true;
  }
  res.writeHead(200, {
    'content-type': contentTypeFromPath(filePath),
    'cache-control': 'public, max-age=31536000, immutable'
  });
  createReadStream(filePath).pipe(res);
  return true;
}

export async function saveImageDataUrl(dataUrl, folder, fileBaseName) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:png|jpe?g|gif|webp));base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) {
    throw new Error('图片格式无效');
  }
  const [, mime, base64] = match;
  const ext = imageExtensionFromMime(mime);
  const safeBaseName = String(fileBaseName || crypto.randomUUID()).replace(/[^a-zA-Z0-9._-]/g, '_');
  const objectKey = `${folder}/${safeBaseName}.${ext}`;
  const buffer = Buffer.from(base64, 'base64');
  if (useLocalUploads) {
    await writeLocalUpload(objectKey, buffer);
  }
  await putR2Object(objectKey, buffer, mime);
  return r2PublicUrlForObjectKey(objectKey);
}
