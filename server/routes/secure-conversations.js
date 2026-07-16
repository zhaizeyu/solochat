import crypto from 'node:crypto';
import {
  areContacts,
  execTransaction,
  getDb,
  getUserById
} from '../db.js';
import { json, readBody } from '../http-utils.js';
import { conversationKey, parseJson, stringifyJson } from '../utils.js';

const cryptoVersion = 1;
const maxWrappedKeyBytes = 512;
const maxCiphertextBytes = 64 * 1024;
const allowedWrapAlgorithms = new Set(['AES-KW', 'AES-256-GCM']);
const allowedKdfAlgorithms = new Set(['Argon2id']);

function decodeBase64(value) {
  const text = String(value || '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text) || text.length % 4 !== 0) return null;
  try {
    return Buffer.from(text, 'base64');
  } catch {
    return null;
  }
}

function validBase64Bytes(value, { min = 1, max }) {
  const bytes = decodeBase64(value);
  return Boolean(bytes && bytes.length >= min && bytes.length <= max);
}

function validGcmIv(value) {
  const bytes = decodeBase64(value);
  return Boolean(bytes && bytes.length === 12);
}

function cleanPositiveInteger(value, fallback = null) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) return fallback;
  return number;
}

function cleanKdfParameters(value) {
  const params = typeof value === 'string' ? parseJson(value, null) : value;
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
  const memoryKiB = cleanPositiveInteger(params.memoryKiB);
  const iterations = cleanPositiveInteger(params.iterations);
  const parallelism = cleanPositiveInteger(params.parallelism);
  if (!memoryKiB || !iterations || !parallelism) return null;
  if (memoryKiB > 1024 * 1024 || iterations > 20 || parallelism > 16) return null;
  return { memoryKiB, iterations, parallelism };
}

function validateWrappedKeyPayload(body, { requireKdf = true } = {}) {
  const wrappedKey = String(body.wrappedKey || '');
  const wrapAlgorithm = String(body.wrapAlgorithm || 'AES-256-GCM');
  const wrapIv = body.wrapIv == null ? null : String(body.wrapIv);
  const keyVersion = cleanPositiveInteger(body.keyVersion, 1);
  if (!allowedWrapAlgorithms.has(wrapAlgorithm)) return '封装算法无效';
  if (!validBase64Bytes(wrappedKey, { max: maxWrappedKeyBytes })) return '密钥封装数据无效';
  if (wrapAlgorithm === 'AES-256-GCM' && !validGcmIv(wrapIv)) return '密钥封装 IV 无效';
  if (wrapAlgorithm === 'AES-KW' && wrapIv) return 'AES-KW 不应提交 IV';
  if (!keyVersion) return '密钥版本无效';

  if (!requireKdf) return null;
  const kdfAlgorithm = String(body.kdfAlgorithm || 'Argon2id');
  const kdfSalt = String(body.kdfSalt || '');
  const kdfParameters = cleanKdfParameters(body.kdfParameters);
  if (!allowedKdfAlgorithms.has(kdfAlgorithm)) return '密码派生算法无效';
  if (!validBase64Bytes(kdfSalt, { min: 16, max: 64 })) return '密码参数无效';
  if (!kdfParameters) return '密码参数无效';
  return null;
}

function wrappedKeyFields(body) {
  return {
    wrappedKey: String(body.wrappedKey),
    wrapAlgorithm: String(body.wrapAlgorithm || 'AES-256-GCM'),
    wrapIv: body.wrapIv == null ? null : String(body.wrapIv),
    kdfAlgorithm: String(body.kdfAlgorithm || 'Argon2id'),
    kdfSalt: String(body.kdfSalt),
    kdfParameters: stringifyJson(cleanKdfParameters(body.kdfParameters)),
    keyVersion: cleanPositiveInteger(body.keyVersion, 1)
  };
}

function recoveryFields(body) {
  return {
    wrappedKey: String(body.wrappedKey),
    wrapAlgorithm: String(body.wrapAlgorithm || 'AES-256-GCM'),
    wrapIv: body.wrapIv == null ? null : String(body.wrapIv),
    recoveryVersion: cleanPositiveInteger(body.recoveryVersion, 1)
  };
}

async function getContactConversation(user, contactId) {
  const target = await getUserById(String(contactId || ''));
  if (!target || target.disabledAt || !(await areContacts(user.id, target.id))) return null;
  return { target, conversationId: conversationKey(user.id, target.id) };
}

async function requireConversationMember(user, conversationId) {
  const ids = String(conversationId || '').split(':');
  if (ids.length !== 2 || !ids.includes(user.id)) return null;
  const contactId = ids.find((id) => id !== user.id);
  const target = await getUserById(contactId);
  if (!target || target.disabledAt || !(await areContacts(user.id, target.id))) return null;
  return { target, conversationId: conversationKey(user.id, target.id) };
}

async function insertAudit(conversationId, userId, eventType) {
  await getDb().prepare(`
    INSERT INTO secure_audit_events (id, conversation_id, user_id, event_type, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), conversationId, userId, eventType, new Date().toISOString());
}

export async function isSecureConversationActive(conversationId) {
  const row = await getDb().prepare(`
    SELECT enabled, status FROM secure_conversations WHERE conversation_id = ?
  `).get(conversationId);
  return Boolean(row && (row.enabled || row.status === 'waiting_peer'));
}

export async function handleSecureConversations(req, res, pathName, user, url) {
  const db = getDb();

  if (req.method === 'POST' && pathName === '/api/secure-conversations/enable') {
    const body = await readBody(req);
    const context = await getContactConversation(user, body.contactId);
    if (!context) return json(res, 404, { message: '联系人不存在' });
    const ownError = validateWrappedKeyPayload(body.userWrappedKey || {});
    const recoveryError = validateWrappedKeyPayload(body.recoveryWrappedKey || {}, { requireKdf: false });
    if (ownError || recoveryError) return json(res, 400, { message: ownError || recoveryError });
    const own = wrappedKeyFields(body.userWrappedKey);
    const recovery = recoveryFields(body.recoveryWrappedKey);
    const now = new Date().toISOString();

    await execTransaction(async () => {
      await db.prepare(`
        INSERT INTO secure_conversations (
          conversation_id, enabled, status, crypto_version, current_key_version,
          recovery_owner_user_id, created_at, updated_at
        ) VALUES (?, FALSE, 'waiting_peer', ?, ?, ?, ?, ?)
        ON CONFLICT (conversation_id) DO UPDATE SET
          status = CASE WHEN secure_conversations.enabled THEN secure_conversations.status ELSE 'waiting_peer' END,
          crypto_version = CASE WHEN secure_conversations.enabled THEN secure_conversations.crypto_version ELSE EXCLUDED.crypto_version END,
          current_key_version = CASE WHEN secure_conversations.enabled THEN secure_conversations.current_key_version ELSE EXCLUDED.current_key_version END,
          recovery_owner_user_id = CASE WHEN secure_conversations.enabled THEN secure_conversations.recovery_owner_user_id ELSE EXCLUDED.recovery_owner_user_id END,
          updated_at = EXCLUDED.updated_at
      `).run(context.conversationId, cryptoVersion, own.keyVersion, user.id, now, now);
      await db.prepare(`
        INSERT INTO user_wrapped_conversation_keys (
          id, conversation_id, user_id, wrapped_key, wrap_algorithm, wrap_iv,
          kdf_algorithm, kdf_salt, kdf_parameters, key_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (conversation_id, user_id, key_version) DO UPDATE SET
          wrapped_key = EXCLUDED.wrapped_key,
          wrap_algorithm = EXCLUDED.wrap_algorithm,
          wrap_iv = EXCLUDED.wrap_iv,
          kdf_algorithm = EXCLUDED.kdf_algorithm,
          kdf_salt = EXCLUDED.kdf_salt,
          kdf_parameters = EXCLUDED.kdf_parameters,
          updated_at = EXCLUDED.updated_at
      `).run(
        crypto.randomUUID(),
        context.conversationId,
        user.id,
        own.wrappedKey,
        own.wrapAlgorithm,
        own.wrapIv,
        own.kdfAlgorithm,
        own.kdfSalt,
        own.kdfParameters,
        own.keyVersion,
        now,
        now
      );
      await db.prepare(`
        INSERT INTO recovery_wrapped_conversation_keys (
          id, conversation_id, wrapped_key, wrap_algorithm, wrap_iv, recovery_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (conversation_id, recovery_version) DO UPDATE SET
          wrapped_key = EXCLUDED.wrapped_key,
          wrap_algorithm = EXCLUDED.wrap_algorithm,
          wrap_iv = EXCLUDED.wrap_iv,
          updated_at = EXCLUDED.updated_at
      `).run(
        crypto.randomUUID(),
        context.conversationId,
        recovery.wrappedKey,
        recovery.wrapAlgorithm,
        recovery.wrapIv,
        recovery.recoveryVersion,
        now,
        now
      );
      await insertAudit(context.conversationId, user.id, 'secure_chat_enable');
    });

    return json(res, 201, { conversationId: context.conversationId, status: 'waiting_peer' });
  }

  if (req.method === 'DELETE' && pathName.startsWith('/api/secure-conversations/')) {
    const conversationId = decodeURIComponent(pathName.slice('/api/secure-conversations/'.length));
    const context = await requireConversationMember(user, conversationId);
    if (!context) return json(res, 404, { message: '安全聊天不存在' });
    const secure = await db.prepare('SELECT * FROM secure_conversations WHERE conversation_id = ?').get(context.conversationId);
    if (!secure || secure.status === 'off') return json(res, 200, { ok: true, status: 'off' });
    const own = await db.prepare(`
      SELECT 1 FROM user_wrapped_conversation_keys
      WHERE conversation_id = ? AND user_id = ? AND key_version = ?
    `).get(context.conversationId, user.id, secure.current_key_version);
    if (!own) return json(res, 403, { message: '请先完成安全配对' });
    const now = new Date().toISOString();
    await execTransaction(async () => {
      await db.prepare(`
        UPDATE secure_conversations
        SET enabled = FALSE,
            status = 'off',
            recovery_owner_user_id = NULL,
            updated_at = ?
        WHERE conversation_id = ?
      `).run(now, context.conversationId);
      await db.prepare('DELETE FROM user_wrapped_conversation_keys WHERE conversation_id = ?').run(context.conversationId);
      await db.prepare('DELETE FROM recovery_wrapped_conversation_keys WHERE conversation_id = ?').run(context.conversationId);
      await db.prepare('DELETE FROM secure_pairing_keys WHERE conversation_id = ?').run(context.conversationId);
      await insertAudit(context.conversationId, user.id, 'secure_chat_disable');
    });
    return json(res, 200, { ok: true, status: 'off' });
  }

  if (req.method === 'POST' && pathName === '/api/secure-conversations/pairing/create') {
    const body = await readBody(req);
    const conversationId = String(body.conversationId || '');
    const context = await requireConversationMember(user, conversationId);
    if (!context) return json(res, 404, { message: '安全聊天不存在' });
    const secure = await db.prepare('SELECT * FROM secure_conversations WHERE conversation_id = ?').get(context.conversationId);
    if (!secure || secure.enabled || secure.status !== 'waiting_peer') {
      return json(res, 400, { message: '当前安全聊天状态不能创建配对链接' });
    }
    const error = validateWrappedKeyPayload(body.pairingWrappedKey || {}, { requireKdf: false });
    if (error) return json(res, 400, { message: error });
    const pairing = recoveryFields({ ...body.pairingWrappedKey, recoveryVersion: body.keyVersion || secure.current_key_version });
    const ttlMinutes = Math.min(Math.max(Number(body.ttlMinutes || 30), 5), 60 * 24);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString();
    const id = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO secure_pairing_keys (
        id, conversation_id, created_by_user_id, wrapped_key, wrap_algorithm,
        wrap_iv, key_version, expires_at, used_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(
      id,
      context.conversationId,
      user.id,
      pairing.wrappedKey,
      pairing.wrapAlgorithm,
      pairing.wrapIv,
      pairing.recoveryVersion,
      expiresAt,
      now.toISOString()
    );
    await insertAudit(context.conversationId, user.id, 'secure_pairing_create');
    return json(res, 201, { pairingId: id, conversationId: context.conversationId, expiresAt });
  }

  if (req.method === 'POST' && pathName === '/api/secure-conversations/pairing/complete') {
    const body = await readBody(req);
    const conversationId = String(body.conversationId || '');
    const context = await requireConversationMember(user, conversationId);
    if (!context) return json(res, 404, { message: '安全聊天不存在' });
    const pairingId = String(body.pairingId || '');
    const pairing = await db.prepare(`
      SELECT * FROM secure_pairing_keys
      WHERE id = ? AND conversation_id = ? AND used_at IS NULL
    `).get(pairingId, context.conversationId);
    if (!pairing || new Date(pairing.expires_at).getTime() <= Date.now()) {
      return json(res, 400, { message: '配对链接已过期或已使用' });
    }
    if (pairing.created_by_user_id === user.id) {
      return json(res, 400, { message: '配对链接需要由对方使用' });
    }
    const error = validateWrappedKeyPayload(body.userWrappedKey || {});
    if (error) return json(res, 400, { message: error });
    const own = wrappedKeyFields(body.userWrappedKey);
    if (own.keyVersion !== pairing.key_version) return json(res, 400, { message: '密钥版本不匹配' });
    const now = new Date().toISOString();
    await execTransaction(async () => {
      await db.prepare(`
        INSERT INTO user_wrapped_conversation_keys (
          id, conversation_id, user_id, wrapped_key, wrap_algorithm, wrap_iv,
          kdf_algorithm, kdf_salt, kdf_parameters, key_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (conversation_id, user_id, key_version) DO UPDATE SET
          wrapped_key = EXCLUDED.wrapped_key,
          wrap_algorithm = EXCLUDED.wrap_algorithm,
          wrap_iv = EXCLUDED.wrap_iv,
          kdf_algorithm = EXCLUDED.kdf_algorithm,
          kdf_salt = EXCLUDED.kdf_salt,
          kdf_parameters = EXCLUDED.kdf_parameters,
          updated_at = EXCLUDED.updated_at
      `).run(
        crypto.randomUUID(),
        context.conversationId,
        user.id,
        own.wrappedKey,
        own.wrapAlgorithm,
        own.wrapIv,
        own.kdfAlgorithm,
        own.kdfSalt,
        own.kdfParameters,
        own.keyVersion,
        now,
        now
      );
      await db.prepare('UPDATE secure_pairing_keys SET used_at = ? WHERE id = ?').run(now, pairing.id);
      await db.prepare(`
        UPDATE secure_conversations
        SET enabled = TRUE, status = 'enabled', updated_at = ?
        WHERE conversation_id = ?
      `).run(now, context.conversationId);
      await insertAudit(context.conversationId, user.id, 'secure_pairing_complete');
    });
    return json(res, 200, { conversationId: context.conversationId, status: 'enabled' });
  }

  if (req.method === 'GET' && pathName.startsWith('/api/secure-conversations/') && pathName.endsWith('/key-material')) {
    const conversationId = decodeURIComponent(pathName.slice('/api/secure-conversations/'.length, -'/key-material'.length));
    const context = await requireConversationMember(user, conversationId);
    if (!context) return json(res, 404, { message: '安全聊天不存在' });
    const secure = await db.prepare('SELECT * FROM secure_conversations WHERE conversation_id = ?').get(context.conversationId);
    if (!secure) {
      return json(res, 200, {
        conversation: {
          conversationId: context.conversationId,
          enabled: false,
          status: 'off',
          cryptoVersion,
          currentKeyVersion: 1,
          recoveryOwnerUserId: null
        },
        userWrappedKey: null,
        recoveryWrappedKey: null,
        pairingWrappedKey: null
      });
    }
    const wrapped = await db.prepare(`
      SELECT * FROM user_wrapped_conversation_keys
      WHERE conversation_id = ? AND user_id = ? AND key_version = ?
    `).get(context.conversationId, user.id, secure.current_key_version);
    const recovery = await db.prepare(`
      SELECT * FROM recovery_wrapped_conversation_keys
      WHERE conversation_id = ? ORDER BY recovery_version DESC LIMIT 1
    `).get(context.conversationId);
    const pairing = await db.prepare(`
      SELECT * FROM secure_pairing_keys
      WHERE conversation_id = ? AND used_at IS NULL AND expires_at > ? AND created_by_user_id <> ?
      ORDER BY created_at DESC LIMIT 1
    `).get(context.conversationId, new Date().toISOString(), user.id);
    return json(res, 200, {
      conversation: {
        conversationId: context.conversationId,
        enabled: Boolean(secure.enabled),
        status: secure.status,
        cryptoVersion: secure.crypto_version,
        currentKeyVersion: secure.current_key_version,
        recoveryOwnerUserId: secure.recovery_owner_user_id
      },
      userWrappedKey: wrapped ? {
        wrappedKey: wrapped.wrapped_key,
        wrapAlgorithm: wrapped.wrap_algorithm,
        wrapIv: wrapped.wrap_iv,
        kdfAlgorithm: wrapped.kdf_algorithm,
        kdfSalt: wrapped.kdf_salt,
        kdfParameters: parseJson(wrapped.kdf_parameters, {}),
        keyVersion: wrapped.key_version
      } : null,
      recoveryWrappedKey: recovery ? {
        wrappedKey: recovery.wrapped_key,
        wrapAlgorithm: recovery.wrap_algorithm,
        wrapIv: recovery.wrap_iv,
        recoveryVersion: recovery.recovery_version
      } : null,
      pairingWrappedKey: pairing ? {
        pairingId: pairing.id,
        wrappedKey: pairing.wrapped_key,
        wrapAlgorithm: pairing.wrap_algorithm,
        wrapIv: pairing.wrap_iv,
        keyVersion: pairing.key_version,
        expiresAt: pairing.expires_at
      } : null
    });
  }

  if (req.method === 'PUT' && pathName.startsWith('/api/secure-conversations/') && pathName.endsWith('/user-wrapped-key')) {
    const conversationId = decodeURIComponent(pathName.slice('/api/secure-conversations/'.length, -'/user-wrapped-key'.length));
    const context = await requireConversationMember(user, conversationId);
    if (!context) return json(res, 404, { message: '安全聊天不存在' });
    const body = await readBody(req);
    const error = validateWrappedKeyPayload(body);
    if (error) return json(res, 400, { message: error });
    const own = wrappedKeyFields(body);
    const secure = await db.prepare('SELECT * FROM secure_conversations WHERE conversation_id = ?').get(context.conversationId);
    if (!secure || own.keyVersion !== secure.current_key_version) return json(res, 400, { message: '密钥版本不匹配' });
    const now = new Date().toISOString();
    await execTransaction(async () => {
      await db.prepare(`
        INSERT INTO user_wrapped_conversation_keys (
          id, conversation_id, user_id, wrapped_key, wrap_algorithm, wrap_iv,
          kdf_algorithm, kdf_salt, kdf_parameters, key_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (conversation_id, user_id, key_version) DO UPDATE SET
          wrapped_key = EXCLUDED.wrapped_key,
          wrap_algorithm = EXCLUDED.wrap_algorithm,
          wrap_iv = EXCLUDED.wrap_iv,
          kdf_algorithm = EXCLUDED.kdf_algorithm,
          kdf_salt = EXCLUDED.kdf_salt,
          kdf_parameters = EXCLUDED.kdf_parameters,
          updated_at = EXCLUDED.updated_at
      `).run(
        crypto.randomUUID(),
        context.conversationId,
        user.id,
        own.wrappedKey,
        own.wrapAlgorithm,
        own.wrapIv,
        own.kdfAlgorithm,
        own.kdfSalt,
        own.kdfParameters,
        own.keyVersion,
        now,
        now
      );
      await insertAudit(context.conversationId, user.id, 'secure_user_key_update');
    });
    return json(res, 200, { ok: true });
  }

  if (
    (req.method === 'PUT' && pathName.startsWith('/api/secure-conversations/') && pathName.endsWith('/recovery-wrapped-key')) ||
    (req.method === 'POST' && pathName.startsWith('/api/secure-conversations/') && pathName.endsWith('/recovery/rotate'))
  ) {
    const suffix = req.method === 'PUT' ? '/recovery-wrapped-key' : '/recovery/rotate';
    const conversationId = decodeURIComponent(pathName.slice('/api/secure-conversations/'.length, -suffix.length));
    const context = await requireConversationMember(user, conversationId);
    if (!context) return json(res, 404, { message: '安全聊天不存在' });
    const body = await readBody(req);
    const payload = body.recoveryWrappedKey || body;
    const error = validateWrappedKeyPayload(payload, { requireKdf: false });
    if (error) return json(res, 400, { message: error });
    const recovery = recoveryFields(payload);
    const now = new Date().toISOString();
    await execTransaction(async () => {
      await db.prepare(`
        INSERT INTO recovery_wrapped_conversation_keys (
          id, conversation_id, wrapped_key, wrap_algorithm, wrap_iv, recovery_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (conversation_id, recovery_version) DO UPDATE SET
          wrapped_key = EXCLUDED.wrapped_key,
          wrap_algorithm = EXCLUDED.wrap_algorithm,
          wrap_iv = EXCLUDED.wrap_iv,
          updated_at = EXCLUDED.updated_at
      `).run(
        crypto.randomUUID(),
        context.conversationId,
        recovery.wrappedKey,
        recovery.wrapAlgorithm,
        recovery.wrapIv,
        recovery.recoveryVersion,
        now,
        now
      );
      await db.prepare(`
        UPDATE recovery_wrapped_conversation_keys
        SET wrapped_key = wrapped_key
        WHERE conversation_id = ? AND recovery_version = ?
      `).run(context.conversationId, recovery.recoveryVersion);
      await db.prepare(`
        DELETE FROM recovery_wrapped_conversation_keys
        WHERE conversation_id = ? AND recovery_version <> ?
      `).run(context.conversationId, recovery.recoveryVersion);
      await insertAudit(context.conversationId, user.id, 'secure_recovery_rotate');
    });
    return json(res, 200, { ok: true, recoveryVersion: recovery.recoveryVersion });
  }

  if (req.method === 'POST' && pathName.startsWith('/api/secure-conversations/') && pathName.endsWith('/unlock-audit')) {
    const conversationId = decodeURIComponent(pathName.slice('/api/secure-conversations/'.length, -'/unlock-audit'.length));
    const context = await requireConversationMember(user, conversationId);
    if (!context) return json(res, 404, { message: '安全聊天不存在' });
    await insertAudit(context.conversationId, user.id, 'secure_unlock');
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathName === '/api/messages/encrypted') {
    const body = await readBody(req);
    const context = await getContactConversation(user, body.toId);
    if (!context) return json(res, 404, { message: '联系人不存在' });
    const secure = await db.prepare('SELECT * FROM secure_conversations WHERE conversation_id = ?').get(context.conversationId);
    if (!secure || secure.status === 'off') return json(res, 400, { message: '安全聊天尚未启用' });
    const ownKey = await db.prepare(`
      SELECT 1 FROM user_wrapped_conversation_keys
      WHERE conversation_id = ? AND user_id = ? AND key_version = ?
    `).get(context.conversationId, user.id, secure.current_key_version);
    if (!ownKey) return json(res, 403, { message: '请先完成安全配对' });
    const messageId = String(body.messageId || '');
    const ciphertext = String(body.ciphertext || '');
    const iv = String(body.iv || '');
    const sequenceNumber = cleanPositiveInteger(body.sequenceNumber);
    const bodyCryptoVersion = cleanPositiveInteger(body.cryptoVersion);
    const keyVersion = cleanPositiveInteger(body.keyVersion);
    if (!/^[0-9a-fA-F-]{36}$/.test(messageId)) return json(res, 400, { message: '消息编号无效' });
    if (!validBase64Bytes(ciphertext, { max: maxCiphertextBytes })) return json(res, 400, { message: '消息密文无效' });
    if (!validGcmIv(iv)) return json(res, 400, { message: '消息 IV 无效' });
    if (!sequenceNumber || bodyCryptoVersion !== secure.crypto_version || keyVersion !== secure.current_key_version) {
      return json(res, 400, { message: '密钥版本不匹配' });
    }
    const now = new Date().toISOString();
    try {
      await db.prepare(`
        INSERT INTO encrypted_messages (
          message_id, conversation_id, sender_id, recipient_id, ciphertext, iv,
          sequence_number, crypto_version, key_version, created_at, read_at, recalled_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
      `).run(
        messageId,
        context.conversationId,
        user.id,
        context.target.id,
        ciphertext,
        iv,
        sequenceNumber,
        bodyCryptoVersion,
        keyVersion,
        now
      );
    } catch (error) {
      if (error?.code === '23505') return json(res, 409, { message: '消息已提交或序号重复' });
      throw error;
    }
    return json(res, 201, {
      message: {
        id: messageId,
        conversationId: context.conversationId,
        fromId: user.id,
        toId: context.target.id,
        ciphertext,
        iv,
        sequenceNumber,
        cryptoVersion: bodyCryptoVersion,
        keyVersion,
        createdAt: now,
        readAt: null,
        recalledAt: null
      }
    });
  }

  if (req.method === 'GET' && pathName === '/api/messages/encrypted') {
    const context = await getContactConversation(user, url.searchParams.get('contactId'));
    if (!context) return json(res, 404, { message: '联系人不存在' });
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 100);
    const before = url.searchParams.get('before');
    const after = url.searchParams.get('after');
    let rows;
    if (after) {
      rows = await db.prepare(`
        SELECT * FROM encrypted_messages
        WHERE conversation_id = ? AND created_at > ?
        ORDER BY created_at ASC
        LIMIT ?
      `).all(context.conversationId, after, limit);
    } else if (before) {
      rows = (await db.prepare(`
        SELECT * FROM encrypted_messages
        WHERE conversation_id = ? AND created_at < ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(context.conversationId, before, limit)).reverse();
    } else {
      rows = (await db.prepare(`
        SELECT * FROM encrypted_messages
        WHERE conversation_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(context.conversationId, limit)).reverse();
    }
    const messages = rows.map((row) => ({
      id: row.message_id,
      conversationId: row.conversation_id,
      fromId: row.sender_id,
      toId: row.recipient_id,
      ciphertext: row.ciphertext,
      iv: row.iv,
      sequenceNumber: row.sequence_number,
      cryptoVersion: row.crypto_version,
      keyVersion: row.key_version,
      createdAt: row.created_at,
      readAt: row.read_at || null,
      recalledAt: row.recalled_at || null
    }));
    const firstCreatedAt = messages[0]?.createdAt || before || null;
    const hasMore = firstCreatedAt
      ? Boolean(await db.prepare(`
        SELECT 1 FROM encrypted_messages WHERE conversation_id = ? AND created_at < ? LIMIT 1
      `).get(context.conversationId, firstCreatedAt))
      : false;
    return json(res, 200, { messages, hasMore });
  }

  return false;
}
