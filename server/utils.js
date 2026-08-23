import crypto from 'node:crypto';

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || '').split(':');
  if (!salt || !expected || expected.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(expected)) {
    return false;
  }
  let expectedBytes;
  try {
    expectedBytes = Buffer.from(expected, 'hex');
  } catch {
    return false;
  }
  const actual = crypto.scryptSync(password, salt, 64);
  if (expectedBytes.length !== actual.length) return false;
  return crypto.timingSafeEqual(expectedBytes, actual);
}

export function normalizeName(name) {
  return String(name || '').trim();
}

export function conversationKey(a, b) {
  return [a, b].sort().join(':');
}

export function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function stringifyJson(value) {
  return value == null ? null : JSON.stringify(value);
}

export function messagePreview(message) {
  if (!message) return '';
  if (message.recalledAt) return '消息已撤回';
  if (message.kind === 'sticker') return '[表情包]';
  if (message.kind === 'image') {
    return message.imageDeletedAt || message.imageExpired ? '[图片已过期删除]' : '[图片]';
  }
  return message.text;
}

export function isImageDataUrl(value) {
  return /^data:image\/(png|jpe?g|gif|webp);base64,[a-zA-Z0-9+/=]+$/.test(String(value || ''));
}
