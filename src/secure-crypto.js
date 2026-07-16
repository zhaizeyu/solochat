import { argon2id } from 'hash-wasm';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
export const secureCryptoVersion = 1;
export const defaultKdfParameters = { memoryKiB: 65536, iterations: 3, parallelism: 1 };

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const padded = String(value || '').replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(value || '').length / 4) * 4, '=');
  return base64ToBytes(padded);
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function aadBytes(fields) {
  return textEncoder.encode(JSON.stringify([
    fields.conversationId,
    fields.messageId,
    fields.senderId,
    fields.sequenceNumber,
    fields.cryptoVersion
  ]));
}

async function importAesGcmKey(raw) {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function importAesKwKey(raw) {
  return crypto.subtle.importKey('raw', raw, 'AES-KW', false, ['wrapKey', 'unwrapKey']);
}

async function hkdf(rawKey, info, length = 32) {
  const key = await crypto.subtle.importKey('raw', rawKey, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: textEncoder.encode(info)
    },
    key,
    length * 8
  );
  return new Uint8Array(bits);
}

export function assertSecureChatSupported() {
  if (!window.isSecureContext || !crypto?.subtle || !crypto?.getRandomValues) {
    throw new Error('当前浏览器不支持安全聊天，请使用最新版 Chrome、Edge、Firefox 或 Safari。');
  }
}

export function isSecureChatSupported() {
  return Boolean(
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    globalThis.crypto?.subtle &&
    globalThis.crypto?.getRandomValues
  );
}

export function makeConversationId(a, b) {
  return [a, b].sort().join(':');
}

export function encodePairingFragment({ conversationId, pairingId, pairingSecret }) {
  const payload = {
    v: secureCryptoVersion,
    c: conversationId,
    p: pairingId,
    s: bytesToBase64Url(pairingSecret)
  };
  return `securePairing=${encodeURIComponent(JSON.stringify(payload))}`;
}

export function parsePairingText(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  let raw = '';
  try {
    const url = new URL(text, window.location.origin);
    raw = new URLSearchParams(url.hash.replace(/^#/, '')).get('securePairing') || url.searchParams.get('securePairing') || '';
  } catch {
    raw = new URLSearchParams(text.replace(/^#/, '')).get('securePairing') || text;
  }
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw.startsWith('{') ? raw : decodeURIComponent(raw));
    return {
      conversationId: String(payload.c || ''),
      pairingId: String(payload.p || ''),
      pairingSecret: base64UrlToBytes(payload.s || '')
    };
  } catch {
    return null;
  }
}

export function readPairingFragment() {
  return parsePairingText(window.location.hash);
}

export function clearPairingFragment() {
  if (!window.location.hash.includes('securePairing=')) return;
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
}

export function generateRootKey() {
  return randomBytes(32);
}

export function generateRecoveryKey() {
  return randomBytes(32);
}

export function generatePairingSecret() {
  return randomBytes(32);
}

export function formatRecoveryCode(recoveryKey) {
  const compact = bytesToBase64Url(recoveryKey);
  return compact.match(/.{1,4}/g).join('-');
}

export function parseRecoveryCode(code) {
  return base64UrlToBytes(String(code || '').replace(/-/g, ''));
}

export async function deriveChatKek(password, userId, salt, parameters = defaultKdfParameters) {
  const saltBytes = typeof salt === 'string' ? base64ToBytes(salt) : salt;
  const hash = await argon2id({
    password,
    salt: saltBytes,
    iterations: parameters.iterations,
    memorySize: parameters.memoryKiB,
    parallelism: parameters.parallelism,
    hashLength: 32,
    outputType: 'binary'
  });
  return hkdf(hash, `chat-key-wrap:v1:user:${userId}`);
}

export async function deriveRecoveryKek(recoveryKey, conversationId) {
  return hkdf(recoveryKey, `recovery-key-wrap:v1:conversation:${conversationId}`);
}

export async function derivePairingKek(pairingSecret, conversationId) {
  return hkdf(pairingSecret, `pairing-key-wrap:v1:conversation:${conversationId}`);
}

export async function wrapRootKey(rootKey, kek, aad, algorithm = 'AES-256-GCM') {
  if (algorithm === 'AES-KW') {
    const wrappingKey = await importAesKwKey(kek);
    const keyToWrap = await crypto.subtle.importKey('raw', rootKey, 'AES-GCM', true, ['encrypt', 'decrypt']);
    const wrapped = await crypto.subtle.wrapKey('raw', keyToWrap, wrappingKey, 'AES-KW');
    return { wrappedKey: bytesToBase64(new Uint8Array(wrapped)), wrapAlgorithm: 'AES-KW', wrapIv: null };
  }
  const iv = randomBytes(12);
  const key = await importAesGcmKey(kek);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: textEncoder.encode(JSON.stringify(aad)) },
    key,
    rootKey
  );
  return { wrappedKey: bytesToBase64(new Uint8Array(encrypted)), wrapAlgorithm: 'AES-256-GCM', wrapIv: bytesToBase64(iv) };
}

export async function unwrapRootKey(wrapped, kek, aad) {
  const algorithm = wrapped.wrapAlgorithm || 'AES-256-GCM';
  if (algorithm === 'AES-KW') {
    const wrappingKey = await importAesKwKey(kek);
    const key = await crypto.subtle.unwrapKey(
      'raw',
      base64ToBytes(wrapped.wrappedKey),
      wrappingKey,
      'AES-KW',
      'AES-GCM',
      true,
      ['encrypt', 'decrypt']
    );
    return new Uint8Array(await crypto.subtle.exportKey('raw', key));
  }
  const key = await importAesGcmKey(kek);
  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToBytes(wrapped.wrapIv),
      additionalData: textEncoder.encode(JSON.stringify(aad))
    },
    key,
    base64ToBytes(wrapped.wrappedKey)
  );
  return new Uint8Array(decrypted);
}

export async function deriveMessageKeys(rootKey) {
  return {
    ab: await importAesGcmKey(await hkdf(rootKey, 'message:A-to-B')),
    ba: await importAesGcmKey(await hkdf(rootKey, 'message:B-to-A'))
  };
}

export function directionForMessage(conversationId, senderId) {
  const [a] = conversationId.split(':');
  return senderId === a ? 'ab' : 'ba';
}

export async function encryptMessage(rootKey, conversationId, senderId, sequenceNumber, payload) {
  const messageId = crypto.randomUUID();
  const keys = await deriveMessageKeys(rootKey);
  const iv = randomBytes(12);
  const fields = { conversationId, messageId, senderId, sequenceNumber, cryptoVersion: secureCryptoVersion };
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadBytes(fields) },
    keys[directionForMessage(conversationId, senderId)],
    textEncoder.encode(JSON.stringify(payload))
  );
  return {
    messageId,
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
    sequenceNumber,
    cryptoVersion: secureCryptoVersion
  };
}

export async function decryptMessage(rootKey, message) {
  const keys = await deriveMessageKeys(rootKey);
  const fields = {
    conversationId: message.conversationId,
    messageId: message.id,
    senderId: message.fromId,
    sequenceNumber: message.sequenceNumber,
    cryptoVersion: message.cryptoVersion
  };
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(message.iv), additionalData: aadBytes(fields) },
    keys[directionForMessage(message.conversationId, message.fromId)],
    base64ToBytes(message.ciphertext)
  );
  return JSON.parse(textDecoder.decode(decrypted));
}

export function randomSalt() {
  return randomBytes(16);
}

export function base64(bytes) {
  return bytesToBase64(bytes);
}
