import { argon2id } from 'hash-wasm';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
export const secureCryptoVersion = 2;
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
    throw new Error('安全聊天需要 HTTPS（或本机 localhost）。请使用 https 访问本站。');
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

export async function deriveLoginKek(password, userId, salt, parameters = defaultKdfParameters) {
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
  return hkdf(hash, `login-key-wrap:v2:user:${userId}`);
}

/** @deprecated use deriveLoginKek */
export async function deriveChatKek(password, userId, salt, parameters = defaultKdfParameters) {
  return deriveLoginKek(password, userId, salt, parameters);
}

export async function wrapBytes(rawBytes, kek, aad, algorithm = 'AES-256-GCM') {
  const iv = randomBytes(12);
  const key = await importAesGcmKey(kek);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: textEncoder.encode(JSON.stringify(aad)) },
    key,
    rawBytes
  );
  return {
    wrappedKey: bytesToBase64(new Uint8Array(encrypted)),
    wrapAlgorithm: algorithm,
    wrapIv: bytesToBase64(iv)
  };
}

export async function unwrapBytes(wrapped, kek, aad) {
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

export async function wrapRootKey(rootKey, kek, aad, algorithm = 'AES-256-GCM') {
  return wrapBytes(rootKey, kek, aad, algorithm);
}

export async function unwrapRootKey(wrapped, kek, aad) {
  return unwrapBytes(wrapped, kek, aad);
}

export async function generateEcdhKeyPair() {
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));
  const privateKey = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
  return { publicKey, privateKey, keyPair };
}

export async function deriveSharedRootKey(privateKeyBytes, peerPublicKeyBytes) {
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits']
  );
  const publicKey = await crypto.subtle.importKey(
    'spki',
    peerPublicKeyBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  return hkdf(new Uint8Array(bits), `secure-chat-root:v${secureCryptoVersion}`);
}

const messageKeyCache = new WeakMap();

export async function deriveMessageKeys(rootKey) {
  const cached = messageKeyCache.get(rootKey);
  if (cached) return cached;
  const keys = {
    ab: await importAesGcmKey(await hkdf(rootKey, 'message:A-to-B')),
    ba: await importAesGcmKey(await hkdf(rootKey, 'message:B-to-A'))
  };
  messageKeyCache.set(rootKey, keys);
  return keys;
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

export function fromBase64(value) {
  return base64ToBytes(value);
}

// Kept for older test helpers / unused UI paths
export function generateRootKey() {
  return randomBytes(32);
}

export function generateRecoveryKey() {
  return randomBytes(32);
}

export function generatePairingSecret() {
  return randomBytes(32);
}

export function formatRecoveryCode() {
  return '';
}

export function parseRecoveryCode() {
  return new Uint8Array();
}

export function encodePairingFragment() {
  return '';
}

export function parsePairingText() {
  return null;
}

export function readPairingFragment() {
  return null;
}

export function clearPairingFragment() {}

export async function deriveRecoveryKek() {
  return randomBytes(32);
}

export async function derivePairingKek() {
  return randomBytes(32);
}
