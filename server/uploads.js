import path from 'node:path';
import crypto from 'node:crypto';
import { r2Config } from './config.js';

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

export function r2PublicUrlForObjectKey(objectKey) {
  if (!r2Config.publicBaseUrl) {
    throw new Error('R2 配置缺失: R2_PUBLIC_BASE_URL');
  }
  return `${r2Config.publicBaseUrl.replace(/\/+$/, '')}/${encodeS3Path(objectKey)}`;
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

function r2SignedHeaders(method, objectKey, body, contentType) {
  assertR2Config();
  const endpoint = new URL(r2Config.endpoint);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = 'auto';
  const service = 's3';
  const payloadHash = sha256Hex(body || '');
  const canonicalUri = `/${encodeS3Path(r2Config.bucket)}/${encodeS3Path(objectKey)}`;
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
    '',
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
    url: new URL(canonicalUri, `${endpoint.protocol}//${endpoint.host}`).toString(),
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
  await putR2Object(objectKey, buffer, mime);
  return r2PublicUrlForObjectKey(objectKey);
}
