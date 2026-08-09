import crypto from 'node:crypto';
import {
  areContacts,
  execTransaction,
  getDb,
  getUserById
} from '../db.js';
import { json, readBody } from '../http-utils.js';
import { conversationKey, parseJson, stringifyJson } from '../utils.js';

const cryptoVersion = 2;
const maxWrappedKeyBytes = 2048;
const maxPublicKeyBytes = 300;
const maxCiphertextBytes = 64 * 1024;
const allowedWrapAlgorithms = new Set(['AES-256-GCM']);
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
  if (!validGcmIv(wrapIv)) return '密钥封装 IV 无效';
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

function formatWrappedKeyRow(row) {
  if (!row) return null;
  return {
    wrappedKey: row.wrappedKey,
    wrapAlgorithm: row.wrapAlgorithm,
    wrapIv: row.wrapIv,
    kdfAlgorithm: row.kdfAlgorithm,
    kdfSalt: row.kdfSalt,
    kdfParameters: parseJson(row.kdfParameters, null),
    keyVersion: row.keyVersion
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

async function upsertUserWrappedKey(db, conversationId, userId, own, now) {
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
    conversationId,
    userId,
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
}

async function upsertHandshakeKey(db, conversationId, userId, publicKey, wrappedPrivate, now) {
  await db.prepare(`
    INSERT INTO secure_handshake_keys (
      conversation_id, user_id, public_key, wrapped_private_key, wrap_algorithm, wrap_iv,
      kdf_algorithm, kdf_salt, kdf_parameters, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (conversation_id, user_id) DO UPDATE SET
      public_key = EXCLUDED.public_key,
      wrapped_private_key = EXCLUDED.wrapped_private_key,
      wrap_algorithm = EXCLUDED.wrap_algorithm,
      wrap_iv = EXCLUDED.wrap_iv,
      kdf_algorithm = EXCLUDED.kdf_algorithm,
      kdf_salt = EXCLUDED.kdf_salt,
      kdf_parameters = EXCLUDED.kdf_parameters,
      updated_at = EXCLUDED.updated_at
  `).run(
    conversationId,
    userId,
    publicKey,
    wrappedPrivate.wrappedKey,
    wrappedPrivate.wrapAlgorithm,
    wrappedPrivate.wrapIv,
    wrappedPrivate.kdfAlgorithm,
    wrappedPrivate.kdfSalt,
    wrappedPrivate.kdfParameters,
    now,
    now
  );
}

async function listUserWrappedKeys(db, conversationId, userId) {
  const rows = await db.prepare(`
    SELECT wrapped_key AS "wrappedKey", wrap_algorithm AS "wrapAlgorithm", wrap_iv AS "wrapIv",
           kdf_algorithm AS "kdfAlgorithm", kdf_salt AS "kdfSalt", kdf_parameters AS "kdfParameters",
           key_version AS "keyVersion"
    FROM user_wrapped_conversation_keys
    WHERE conversation_id = ? AND user_id = ?
    ORDER BY key_version ASC
  `).all(conversationId, userId);
  return rows.map(formatWrappedKeyRow);
}

export async function applyLoginPasswordRewraps(userId, userWrappedKeys = [], handshakeKeys = []) {
  const db = getDb();
  const now = new Date().toISOString();
  for (const item of userWrappedKeys) {
    const conversationId = String(item.conversationId || '');
    const context = await requireConversationMember({ id: userId }, conversationId);
    if (!context) throw new Error('会话密钥所属会话无效');
    const wrapError = validateWrappedKeyPayload(item);
    if (wrapError) throw new Error(wrapError);
    const own = wrappedKeyFields(item);
    const existing = await db.prepare(`
      SELECT 1 FROM user_wrapped_conversation_keys
      WHERE conversation_id = ? AND user_id = ? AND key_version = ?
    `).get(conversationId, userId, own.keyVersion);
    if (!existing) throw new Error('要重封的会话密钥不存在');
    await upsertUserWrappedKey(db, conversationId, userId, own, now);
  }
  for (const item of handshakeKeys) {
    const conversationId = String(item.conversationId || '');
    const context = await requireConversationMember({ id: userId }, conversationId);
    if (!context) throw new Error('握手密钥所属会话无效');
    const wrapError = validateWrappedKeyPayload(item.wrappedPrivateKey || {});
    if (wrapError) throw new Error(wrapError);
    const wrappedPrivate = wrappedKeyFields(item.wrappedPrivateKey);
    const existing = await db.prepare(`
      SELECT public_key AS "publicKey" FROM secure_handshake_keys
      WHERE conversation_id = ? AND user_id = ? AND COALESCE(wrapped_private_key, '') <> ''
    `).get(conversationId, userId);
    if (!existing?.publicKey) throw new Error('要重封的握手私钥不存在');
    await db.prepare(`
      UPDATE secure_handshake_keys
      SET wrapped_private_key = ?, wrap_algorithm = ?, wrap_iv = ?,
          kdf_algorithm = ?, kdf_salt = ?, kdf_parameters = ?, updated_at = ?
      WHERE conversation_id = ? AND user_id = ?
    `).run(
      wrappedPrivate.wrappedKey,
      wrappedPrivate.wrapAlgorithm,
      wrappedPrivate.wrapIv,
      wrappedPrivate.kdfAlgorithm,
      wrappedPrivate.kdfSalt,
      wrappedPrivate.kdfParameters,
      now,
      conversationId,
      userId
    );
  }
}

function conversationPayload(secure, conversationId, nextKeyVersion = null) {
  const currentKeyVersion = Number(secure?.current_key_version || 0);
  const resolvedNext = nextKeyVersion ?? (
    !secure || secure.status === 'off'
      ? currentKeyVersion + 1
      : Math.max(currentKeyVersion, 1)
  );
  return {
    conversationId,
    enabled: Boolean(secure?.enabled),
    status: secure?.status || 'off',
    cryptoVersion: secure?.crypto_version || cryptoVersion,
    currentKeyVersion,
    nextKeyVersion: resolvedNext,
    initiatorUserId: secure?.recovery_owner_user_id || null,
    closeRequestedBy: secure?.close_requested_by || null,
    closeRequestedAt: secure?.close_requested_at || null
  };
}

export async function isSecureConversationActive(conversationId) {
  const row = await getDb().prepare(`
    SELECT enabled, status FROM secure_conversations WHERE conversation_id = ?
  `).get(conversationId);
  return Boolean(row && (
    row.enabled
    || row.status === 'waiting_peer'
    || row.status === 'closing'
  ));
}

export async function handleSecureConversations(req, res, pathName, user, url) {
  const db = getDb();

  if (req.method === 'POST' && pathName === '/api/secure-conversations/rewrap-keys') {
    const body = await readBody(req);
    const userWrappedKeys = Array.isArray(body.userWrappedKeys) ? body.userWrappedKeys : [];
    const handshakeKeys = Array.isArray(body.handshakeKeys) ? body.handshakeKeys : [];
    if (!userWrappedKeys.length && !handshakeKeys.length) {
      return json(res, 400, { message: '没有需要更新的安全聊天' });
    }
    try {
      await execTransaction(async () => {
        await applyLoginPasswordRewraps(user.id, userWrappedKeys, handshakeKeys);
      });
    } catch (error) {
      return json(res, 400, { message: error.message || '未能更新安全聊天，请稍后再试' });
    }
    return json(res, 200, {
      ok: true,
      rewrappedUserKeys: userWrappedKeys.length,
      rewrappedHandshakeKeys: handshakeKeys.length
    });
  }

  if (req.method === 'GET' && pathName === '/api/secure-conversations/my-key-wraps') {
    const userWraps = await db.prepare(`
      SELECT conversation_id AS "conversationId",
             wrapped_key AS "wrappedKey", wrap_algorithm AS "wrapAlgorithm", wrap_iv AS "wrapIv",
             kdf_algorithm AS "kdfAlgorithm", kdf_salt AS "kdfSalt", kdf_parameters AS "kdfParameters",
             key_version AS "keyVersion"
      FROM user_wrapped_conversation_keys
      WHERE user_id = ?
      ORDER BY conversation_id ASC, key_version ASC
    `).all(user.id);
    const handshakeRows = await db.prepare(`
      SELECT h.conversation_id AS "conversationId",
             h.public_key AS "publicKey",
             h.wrapped_private_key AS "wrappedPrivateKey",
             h.wrap_algorithm AS "wrapAlgorithm",
             h.wrap_iv AS "wrapIv",
             h.kdf_algorithm AS "kdfAlgorithm",
             h.kdf_salt AS "kdfSalt",
             h.kdf_parameters AS "kdfParameters",
             COALESCE(s.current_key_version, 1) AS "currentKeyVersion"
      FROM secure_handshake_keys h
      LEFT JOIN secure_conversations s ON s.conversation_id = h.conversation_id
      WHERE h.user_id = ? AND COALESCE(h.wrapped_private_key, '') <> ''
      ORDER BY h.conversation_id ASC
    `).all(user.id);
    return json(res, 200, {
      userWrappedKeys: userWraps.map((row) => ({
        conversationId: row.conversationId,
        ...formatWrappedKeyRow(row)
      })),
      handshakeKeys: handshakeRows.map((row) => ({
        conversationId: row.conversationId,
        publicKey: row.publicKey,
        currentKeyVersion: row.currentKeyVersion,
        wrappedPrivateKey: {
          wrappedKey: row.wrappedPrivateKey,
          wrapAlgorithm: row.wrapAlgorithm,
          wrapIv: row.wrapIv,
          kdfAlgorithm: row.kdfAlgorithm,
          kdfSalt: row.kdfSalt,
          kdfParameters: parseJson(row.kdfParameters, null),
          keyVersion: row.currentKeyVersion
        }
      }))
    });
  }

  // A invites B: publish ECDH public key + wrapped private key (with login password)
  if (req.method === 'POST' && pathName === '/api/secure-conversations/invite') {
    const body = await readBody(req);
    const context = await getContactConversation(user, body.contactId);
    if (!context) return json(res, 404, { message: '联系人不存在' });
    const publicKey = String(body.publicKey || '');
    if (!validBase64Bytes(publicKey, { min: 50, max: maxPublicKeyBytes })) {
      return json(res, 400, { message: '握手公钥无效' });
    }
    const wrapError = validateWrappedKeyPayload(body.wrappedPrivateKey || {});
    if (wrapError) return json(res, 400, { message: wrapError });
    const existing = await db.prepare('SELECT * FROM secure_conversations WHERE conversation_id = ?').get(context.conversationId);
    if (existing && (existing.enabled || existing.status === 'closing')) {
      return json(res, 409, { message: '安全聊天已在进行中或正在关闭' });
    }
    if (existing && existing.status === 'waiting_peer' && existing.recovery_owner_user_id && existing.recovery_owner_user_id !== user.id) {
      return json(res, 409, { message: '对方已经发起邀请，请打开安全面板同意开启' });
    }
    const nextVersion = !existing || existing.status === 'off'
      ? Number(existing?.current_key_version || 0) + 1
      : Number(existing.current_key_version || 1);
    const wrappedPrivate = wrappedKeyFields(body.wrappedPrivateKey);
    if (wrappedPrivate.keyVersion !== nextVersion) {
      return json(res, 400, { message: '密钥版本不匹配' });
    }
    const now = new Date().toISOString();
    await execTransaction(async () => {
      await db.prepare(`
        INSERT INTO secure_conversations (
          conversation_id, enabled, status, crypto_version, current_key_version,
          recovery_owner_user_id, close_requested_by, close_requested_at, created_at, updated_at
        ) VALUES (?, FALSE, 'waiting_peer', ?, ?, ?, NULL, NULL, ?, ?)
        ON CONFLICT (conversation_id) DO UPDATE SET
          enabled = FALSE,
          status = 'waiting_peer',
          crypto_version = EXCLUDED.crypto_version,
          current_key_version = EXCLUDED.current_key_version,
          recovery_owner_user_id = EXCLUDED.recovery_owner_user_id,
          close_requested_by = NULL,
          close_requested_at = NULL,
          updated_at = EXCLUDED.updated_at
      `).run(context.conversationId, cryptoVersion, nextVersion, user.id, now, now);
      // Keep historical user_wrapped_conversation_keys; only reset handshake for this invite.
      await db.prepare('DELETE FROM secure_handshake_keys WHERE conversation_id = ?').run(context.conversationId);
      await db.prepare('DELETE FROM secure_pairing_keys WHERE conversation_id = ?').run(context.conversationId);
      await db.prepare('DELETE FROM recovery_wrapped_conversation_keys WHERE conversation_id = ?').run(context.conversationId);
      await upsertHandshakeKey(db, context.conversationId, user.id, publicKey, wrappedPrivate, now);
      await insertAudit(context.conversationId, user.id, 'secure_chat_invite');
    });
    return json(res, 201, { conversationId: context.conversationId, status: 'waiting_peer', keyVersion: nextVersion });
  }

  // B accepts: publish ECDH public key + user-wrapped root key
  if (req.method === 'POST' && pathName === '/api/secure-conversations/accept') {
    const body = await readBody(req);
    const conversationId = String(body.conversationId || '');
    const context = await requireConversationMember(user, conversationId);
    if (!context) return json(res, 404, { message: '安全聊天不存在' });
    const secure = await db.prepare('SELECT * FROM secure_conversations WHERE conversation_id = ?').get(context.conversationId);
    if (!secure || secure.status !== 'waiting_peer' || secure.enabled) {
      return json(res, 400, { message: '当前没有待处理的邀请' });
    }
    if (secure.recovery_owner_user_id === user.id) {
      return json(res, 400, { message: '不能同意自己发起的邀请' });
    }
    const publicKey = String(body.publicKey || '');
    if (!validBase64Bytes(publicKey, { min: 50, max: maxPublicKeyBytes })) {
      return json(res, 400, { message: '握手公钥无效' });
    }
    const wrapError = validateWrappedKeyPayload(body.userWrappedKey || {});
    if (wrapError) return json(res, 400, { message: wrapError });
    const own = wrappedKeyFields(body.userWrappedKey);
    if (own.keyVersion !== secure.current_key_version) {
      return json(res, 400, { message: '密钥版本不匹配' });
    }
    const initiator = await db.prepare(`
      SELECT public_key AS "publicKey" FROM secure_handshake_keys
      WHERE conversation_id = ? AND user_id = ?
    `).get(context.conversationId, secure.recovery_owner_user_id);
    if (!initiator?.publicKey) return json(res, 400, { message: '邀请方握手信息缺失' });
    const now = new Date().toISOString();
    await execTransaction(async () => {
      await db.prepare(`
        INSERT INTO secure_handshake_keys (
          conversation_id, user_id, public_key, wrapped_private_key, wrap_algorithm, wrap_iv,
          kdf_algorithm, kdf_salt, kdf_parameters, created_at, updated_at
        ) VALUES (?, ?, ?, '', 'AES-256-GCM', NULL, 'Argon2id', '', '{}', ?, ?)
        ON CONFLICT (conversation_id, user_id) DO UPDATE SET
          public_key = EXCLUDED.public_key,
          updated_at = EXCLUDED.updated_at
      `).run(context.conversationId, user.id, publicKey, now, now);
      await upsertUserWrappedKey(db, context.conversationId, user.id, own, now);
      await db.prepare(`
        UPDATE secure_conversations SET updated_at = ? WHERE conversation_id = ?
      `).run(now, context.conversationId);
      await insertAudit(context.conversationId, user.id, 'secure_chat_accept');
    });
    return json(res, 200, { conversationId: context.conversationId, status: 'waiting_peer', peerAccepted: true });
  }

  // A completes after B accepted: store user-wrapped root, enable conversation
  if (req.method === 'POST' && pathName === '/api/secure-conversations/complete') {
    const body = await readBody(req);
    const conversationId = String(body.conversationId || '');
    const context = await requireConversationMember(user, conversationId);
    if (!context) return json(res, 404, { message: '安全聊天不存在' });
    const secure = await db.prepare('SELECT * FROM secure_conversations WHERE conversation_id = ?').get(context.conversationId);
    if (!secure || secure.status === 'off') return json(res, 400, { message: '安全聊天不存在' });
    if (secure.recovery_owner_user_id !== user.id) {
      return json(res, 403, { message: '只有发起邀请的一方可以完成开启' });
    }
    const peer = await db.prepare(`
      SELECT public_key AS "publicKey" FROM secure_handshake_keys
      WHERE conversation_id = ? AND user_id = ?
    `).get(context.conversationId, context.target.id);
    const peerWrapped = await db.prepare(`
      SELECT 1 FROM user_wrapped_conversation_keys
      WHERE conversation_id = ? AND user_id = ? AND key_version = ?
    `).get(context.conversationId, context.target.id, secure.current_key_version);
    if (!peer?.publicKey || !peerWrapped) {
      return json(res, 400, { message: '对方还没有同意邀请' });
    }
    const wrapError = validateWrappedKeyPayload(body.userWrappedKey || {});
    if (wrapError) return json(res, 400, { message: wrapError });
    const own = wrappedKeyFields(body.userWrappedKey);
    if (own.keyVersion !== secure.current_key_version) {
      return json(res, 400, { message: '密钥版本不匹配' });
    }
    const now = new Date().toISOString();
    await execTransaction(async () => {
      await upsertUserWrappedKey(db, context.conversationId, user.id, own, now);
      await db.prepare(`
        UPDATE secure_conversations
        SET enabled = TRUE, status = 'enabled', close_requested_by = NULL, close_requested_at = NULL, updated_at = ?
        WHERE conversation_id = ?
      `).run(now, context.conversationId);
      await db.prepare('DELETE FROM secure_handshake_keys WHERE conversation_id = ?').run(context.conversationId);
      await insertAudit(context.conversationId, user.id, 'secure_chat_enable');
    });
    return json(res, 200, { conversationId: context.conversationId, status: 'enabled' });
  }

  if (req.method === 'POST' && pathName === '/api/secure-conversations/close/request') {
    const body = await readBody(req);
    const conversationId = String(body.conversationId || '');
    const context = await requireConversationMember(user, conversationId);
    if (!context) return json(res, 404, { message: '安全聊天不存在' });
    const secure = await db.prepare('SELECT * FROM secure_conversations WHERE conversation_id = ?').get(context.conversationId);
    if (!secure || secure.status !== 'enabled' || !secure.enabled) {
      return json(res, 400, { message: '当前无法申请关闭' });
    }
    const now = new Date().toISOString();
    await db.prepare(`
      UPDATE secure_conversations
      SET status = 'closing', close_requested_by = ?, close_requested_at = ?, updated_at = ?
      WHERE conversation_id = ?
    `).run(user.id, now, now, context.conversationId);
    await insertAudit(context.conversationId, user.id, 'secure_chat_close_request');
    return json(res, 200, { conversationId: context.conversationId, status: 'closing', closeRequestedBy: user.id });
  }

  if (req.method === 'POST' && pathName === '/api/secure-conversations/close/confirm') {
    const body = await readBody(req);
    const conversationId = String(body.conversationId || '');
    const context = await requireConversationMember(user, conversationId);
    if (!context) return json(res, 404, { message: '安全聊天不存在' });
    const secure = await db.prepare('SELECT * FROM secure_conversations WHERE conversation_id = ?').get(context.conversationId);
    if (!secure || secure.status !== 'closing') {
      return json(res, 400, { message: '当前没有待确认的关闭申请' });
    }
    if (!secure.close_requested_by || secure.close_requested_by === user.id) {
      return json(res, 403, { message: '需要对方确认关闭' });
    }
    const now = new Date().toISOString();
    await execTransaction(async () => {
      await db.prepare(`
        UPDATE secure_conversations
        SET enabled = FALSE, status = 'off', recovery_owner_user_id = NULL,
            close_requested_by = NULL, close_requested_at = NULL, updated_at = ?
        WHERE conversation_id = ?
      `).run(now, context.conversationId);
      // Keep historical wrapped keys and encrypted messages.
      await db.prepare('DELETE FROM secure_handshake_keys WHERE conversation_id = ?').run(context.conversationId);
      await db.prepare('DELETE FROM secure_pairing_keys WHERE conversation_id = ?').run(context.conversationId);
      await db.prepare('DELETE FROM recovery_wrapped_conversation_keys WHERE conversation_id = ?').run(context.conversationId);
      await insertAudit(context.conversationId, user.id, 'secure_chat_close_confirm');
    });
    return json(res, 200, { ok: true, status: 'off' });
  }

  if (req.method === 'POST' && pathName === '/api/secure-conversations/close/cancel') {
    const body = await readBody(req);
    const conversationId = String(body.conversationId || '');
    const context = await requireConversationMember(user, conversationId);
    if (!context) return json(res, 404, { message: '安全聊天不存在' });
    const secure = await db.prepare('SELECT * FROM secure_conversations WHERE conversation_id = ?').get(context.conversationId);
    if (!secure || secure.status !== 'closing') {
      return json(res, 400, { message: '当前没有可取消的关闭申请' });
    }
    const now = new Date().toISOString();
    await db.prepare(`
      UPDATE secure_conversations
      SET status = 'enabled', enabled = TRUE, close_requested_by = NULL, close_requested_at = NULL, updated_at = ?
      WHERE conversation_id = ?
    `).run(now, context.conversationId);
    await insertAudit(context.conversationId, user.id, 'secure_chat_close_cancel');
    return json(res, 200, { conversationId: context.conversationId, status: 'enabled' });
  }

  // Cancel pending invite (single party). Does not delete historical wrapped keys.
  if (req.method === 'DELETE' && pathName.startsWith('/api/secure-conversations/')) {
    const rest = decodeURIComponent(pathName.slice('/api/secure-conversations/'.length));
    if (rest.includes('/')) return false;
    const conversationId = rest;
    const context = await requireConversationMember(user, conversationId);
    if (!context) return json(res, 404, { message: '安全聊天不存在' });
    const secure = await db.prepare('SELECT * FROM secure_conversations WHERE conversation_id = ?').get(context.conversationId);
    if (!secure || secure.status === 'off') return json(res, 200, { ok: true, status: 'off' });
    if (secure.status === 'enabled' || secure.status === 'closing') {
      return json(res, 400, { message: '已开启的安全聊天需要双方都同意后才能关闭' });
    }
    if (secure.status !== 'waiting_peer') {
      return json(res, 400, { message: '当前状态无法取消' });
    }
    const now = new Date().toISOString();
    await execTransaction(async () => {
      await db.prepare('DELETE FROM secure_handshake_keys WHERE conversation_id = ?').run(context.conversationId);
      await db.prepare(`
        DELETE FROM user_wrapped_conversation_keys
        WHERE conversation_id = ? AND key_version = ?
      `).run(context.conversationId, secure.current_key_version);
      const remaining = await db.prepare(`
        SELECT COALESCE(MAX(key_version), 0) AS "maxVersion"
        FROM user_wrapped_conversation_keys
        WHERE conversation_id = ?
      `).get(context.conversationId);
      const restoredVersion = Number(remaining?.maxVersion || 0);
      await db.prepare(`
        UPDATE secure_conversations
        SET enabled = FALSE, status = 'off', recovery_owner_user_id = NULL,
            close_requested_by = NULL, close_requested_at = NULL,
            current_key_version = ?, updated_at = ?
        WHERE conversation_id = ?
      `).run(restoredVersion, now, context.conversationId);
      await insertAudit(context.conversationId, user.id, 'secure_chat_invite_cancel');
    });
    return json(res, 200, { ok: true, status: 'off' });
  }

  if (req.method === 'GET' && pathName.startsWith('/api/secure-conversations/') && pathName.endsWith('/key-material')) {
    const conversationId = decodeURIComponent(pathName.slice('/api/secure-conversations/'.length, -'/key-material'.length));
    const context = await requireConversationMember(user, conversationId);
    if (!context) return json(res, 404, { message: '联系人不存在' });
    const secure = await db.prepare('SELECT * FROM secure_conversations WHERE conversation_id = ?').get(context.conversationId);
    const historicalUserWrappedKeys = await listUserWrappedKeys(db, context.conversationId, user.id);
    const hasHistoricalKeys = historicalUserWrappedKeys.length > 0;

    if (!secure || secure.status === 'off') {
      const currentKeyVersion = secure?.current_key_version || (hasHistoricalKeys
        ? historicalUserWrappedKeys[historicalUserWrappedKeys.length - 1].keyVersion
        : 0);
      return json(res, 200, {
        conversation: conversationPayload(
          secure ? { ...secure, status: 'off', enabled: false } : null,
          context.conversationId,
          (currentKeyVersion || 0) + 1
        ),
        userWrappedKey: null,
        historicalUserWrappedKeys,
        hasHistoricalKeys,
        handshake: null,
        peerHandshake: null,
        peerAccepted: false
      });
    }

    const userWrapped = historicalUserWrappedKeys.find((item) => item.keyVersion === secure.current_key_version) || null;
    const ownHandshake = await db.prepare(`
      SELECT public_key AS "publicKey",
             wrapped_private_key AS "wrappedPrivateKey",
             wrap_algorithm AS "wrapAlgorithm",
             wrap_iv AS "wrapIv",
             kdf_algorithm AS "kdfAlgorithm",
             kdf_salt AS "kdfSalt",
             kdf_parameters AS "kdfParameters"
      FROM secure_handshake_keys
      WHERE conversation_id = ? AND user_id = ?
    `).get(context.conversationId, user.id);
    const peerHandshake = await db.prepare(`
      SELECT public_key AS "publicKey"
      FROM secure_handshake_keys
      WHERE conversation_id = ? AND user_id = ?
    `).get(context.conversationId, context.target.id);
    const peerAccepted = Boolean(await db.prepare(`
      SELECT 1 FROM user_wrapped_conversation_keys
      WHERE conversation_id = ? AND user_id = ? AND key_version = ?
    `).get(
      context.conversationId,
      secure.recovery_owner_user_id === user.id ? context.target.id : user.id,
      secure.current_key_version
    ));

    return json(res, 200, {
      conversation: conversationPayload(secure, context.conversationId),
      userWrappedKey: userWrapped,
      historicalUserWrappedKeys,
      hasHistoricalKeys,
      handshake: ownHandshake?.publicKey
        ? {
            publicKey: ownHandshake.publicKey,
            wrappedPrivateKey: ownHandshake.wrappedPrivateKey
              ? {
                  wrappedKey: ownHandshake.wrappedPrivateKey,
                  wrapAlgorithm: ownHandshake.wrapAlgorithm,
                  wrapIv: ownHandshake.wrapIv,
                  kdfAlgorithm: ownHandshake.kdfAlgorithm,
                  kdfSalt: ownHandshake.kdfSalt,
                  kdfParameters: parseJson(ownHandshake.kdfParameters, null)
                }
              : null
          }
        : null,
      peerHandshake: peerHandshake?.publicKey ? { publicKey: peerHandshake.publicKey } : null,
      peerAccepted
    });
  }

  if (req.method === 'PUT' && pathName.startsWith('/api/secure-conversations/') && pathName.endsWith('/user-wrapped-key')) {
    const conversationId = decodeURIComponent(pathName.slice('/api/secure-conversations/'.length, -'/user-wrapped-key'.length));
    const context = await requireConversationMember(user, conversationId);
    if (!context) return json(res, 404, { message: '安全聊天不存在' });
    const secure = await db.prepare('SELECT * FROM secure_conversations WHERE conversation_id = ?').get(context.conversationId);
    if (!secure || secure.status === 'off') return json(res, 404, { message: '安全聊天不存在' });
    const body = await readBody(req);
    const wrapError = validateWrappedKeyPayload(body || {});
    if (wrapError) return json(res, 400, { message: wrapError });
    const own = wrappedKeyFields(body);
    if (own.keyVersion !== secure.current_key_version) {
      return json(res, 400, { message: '密钥版本不匹配' });
    }
    const now = new Date().toISOString();
    await upsertUserWrappedKey(db, context.conversationId, user.id, own, now);
    await insertAudit(context.conversationId, user.id, 'secure_user_key_update');
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathName === '/api/messages/encrypted/next-sequence') {
    const contactId = String(url.searchParams.get('contactId') || '');
    const context = await getContactConversation(user, contactId);
    if (!context) return json(res, 404, { message: '联系人不存在' });
    const keyVersion = cleanPositiveInteger(url.searchParams.get('keyVersion'), 1);
    if (!keyVersion) return json(res, 400, { message: '密钥版本无效' });
    const row = await db.prepare(`
      SELECT COALESCE(MAX(sequence_number), 0) AS "maxSequence"
      FROM encrypted_messages
      WHERE conversation_id = ? AND sender_id = ? AND key_version = ?
    `).get(context.conversationId, user.id, keyVersion);
    return json(res, 200, {
      conversationId: context.conversationId,
      keyVersion,
      nextSequence: Number(row?.maxSequence || 0) + 1
    });
  }

  if (req.method === 'POST' && pathName === '/api/messages/encrypted') {
    const body = await readBody(req);
    const context = await getContactConversation(user, body.toId);
    if (!context) return json(res, 404, { message: '联系人不存在' });
    const secure = await db.prepare('SELECT * FROM secure_conversations WHERE conversation_id = ?').get(context.conversationId);
    if (!secure || secure.status === 'off') {
      return json(res, 400, { message: '请先开启安全聊天' });
    }
    if (secure.status !== 'enabled' && secure.status !== 'closing' && secure.status !== 'waiting_peer') {
      return json(res, 400, { message: '请先开启安全聊天' });
    }
    const ownKey = await db.prepare(`
      SELECT 1 FROM user_wrapped_conversation_keys
      WHERE conversation_id = ? AND user_id = ? AND key_version = ?
    `).get(context.conversationId, user.id, secure.current_key_version);
    if (!ownKey) {
      return json(res, 403, { message: secure.enabled || secure.status === 'closing' ? '请先输入密码继续安全聊天' : '请先和对方完成安全聊天开启' });
    }
    if (!secure.enabled && secure.status !== 'closing' && secure.recovery_owner_user_id !== user.id) {
      return json(res, 403, { message: '对方还没有完成开启，暂时不能发送' });
    }
    // During waiting_peer only initiator with own key could send; initiator has no own key until complete.
    if (secure.status === 'waiting_peer' && !secure.enabled) {
      return json(res, 403, { message: '请先完成安全聊天开启' });
    }
    const messageId = String(body.messageId || '');
    const ciphertext = String(body.ciphertext || '');
    const iv = String(body.iv || '');
    const sequenceNumber = cleanPositiveInteger(body.sequenceNumber);
    const messageCryptoVersion = cleanPositiveInteger(body.cryptoVersion, cryptoVersion);
    const keyVersion = cleanPositiveInteger(body.keyVersion, secure.current_key_version);
    if (!/^[0-9a-f-]{36}$/i.test(messageId)) return json(res, 400, { message: '消息 ID 无效' });
    if (!validBase64Bytes(ciphertext, { max: maxCiphertextBytes })) return json(res, 400, { message: '密文无效' });
    if (!validGcmIv(iv)) return json(res, 400, { message: 'IV 无效' });
    if (!sequenceNumber) return json(res, 400, { message: '序号无效' });
    if (keyVersion !== secure.current_key_version) return json(res, 400, { message: '密钥版本不匹配' });
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
        messageCryptoVersion,
        keyVersion,
        now
      );
    } catch (error) {
      if (String(error.message || '').includes('unique') || error.code === '23505') {
        return json(res, 409, { message: '消息序号或 ID 冲突' });
      }
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
        cryptoVersion: messageCryptoVersion,
        keyVersion,
        createdAt: now,
        readAt: null,
        recalledAt: null
      }
    });
  }

  if (req.method === 'GET' && pathName === '/api/messages/encrypted') {
    const contactId = String(url.searchParams.get('contactId') || '');
    const context = await getContactConversation(user, contactId);
    if (!context) return json(res, 404, { message: '联系人不存在' });
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 100);
    const before = url.searchParams.get('before');
    const after = url.searchParams.get('after');
    let rows;
    if (after) {
      rows = await db.prepare(`
        SELECT message_id AS id, conversation_id AS "conversationId", sender_id AS "fromId",
               recipient_id AS "toId", ciphertext, iv, sequence_number AS "sequenceNumber",
               crypto_version AS "cryptoVersion", key_version AS "keyVersion",
               created_at AS "createdAt", read_at AS "readAt", recalled_at AS "recalledAt"
        FROM encrypted_messages
        WHERE conversation_id = ? AND created_at > ?
        ORDER BY created_at ASC
        LIMIT ?
      `).all(context.conversationId, after, limit);
    } else if (before) {
      rows = await db.prepare(`
        SELECT message_id AS id, conversation_id AS "conversationId", sender_id AS "fromId",
               recipient_id AS "toId", ciphertext, iv, sequence_number AS "sequenceNumber",
               crypto_version AS "cryptoVersion", key_version AS "keyVersion",
               created_at AS "createdAt", read_at AS "readAt", recalled_at AS "recalledAt"
        FROM encrypted_messages
        WHERE conversation_id = ? AND created_at < ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(context.conversationId, before, limit);
      rows.reverse();
    } else {
      rows = await db.prepare(`
        SELECT message_id AS id, conversation_id AS "conversationId", sender_id AS "fromId",
               recipient_id AS "toId", ciphertext, iv, sequence_number AS "sequenceNumber",
               crypto_version AS "cryptoVersion", key_version AS "keyVersion",
               created_at AS "createdAt", read_at AS "readAt", recalled_at AS "recalledAt"
        FROM encrypted_messages
        WHERE conversation_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(context.conversationId, limit);
      rows.reverse();
    }
    const hasMore = rows.length >= limit;
    return json(res, 200, { messages: rows, hasMore });
  }

  return false;
}
