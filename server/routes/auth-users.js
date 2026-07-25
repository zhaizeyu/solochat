import crypto from 'node:crypto';
import { bubbleThemes, maxImageDataUrlLength } from '../config.js';
import {
  execTransaction,
  findActiveUserByUsername,
  getDb,
  getUserById,
  releaseDeletedUsername,
  sanitizeUser
} from '../db.js';
import { json, readBody } from '../http-utils.js';
import { saveImageDataUrl } from '../uploads.js';
import { hashPassword, isImageDataUrl, normalizeName, verifyPassword } from '../utils.js';
import { applyLoginPasswordRewraps } from './secure-conversations.js';

export async function handlePublicAuth(req, res, pathName) {
  const db = getDb();

  if (req.method === 'POST' && pathName === '/api/register') {
    const body = await readBody(req);
    const username = normalizeName(body.username).toLowerCase();
    const displayName = normalizeName(body.displayName) || username;
    const password = String(body.password || '');

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return json(res, 400, { message: '用户名需为 3-20 位字母、数字或下划线' });
    }
    if (password.length < 6) {
      return json(res, 400, { message: '密码至少 6 位' });
    }
    if (await findActiveUserByUsername(username)) {
      return json(res, 409, { message: '用户名已存在' });
    }

    const user = {
      id: crypto.randomUUID(),
      username,
      displayName,
      passwordHash: hashPassword(password),
      avatarDataUrl: '',
      bubbleTheme: 'mint',
      bio: '',
      createdAt: new Date().toISOString(),
      disabledAt: null,
      deletedUsername: null,
      isAdmin: false
    };
    try {
      await db.prepare(`
        INSERT INTO users (
          id, username, display_name, password_hash, avatar_path, bubble_theme,
          bio, created_at, disabled_at, deleted_username, is_admin
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        user.id,
        user.username,
        user.displayName,
        user.passwordHash,
        null,
        user.bubbleTheme,
        user.bio,
        user.createdAt,
        null,
        null,
        0
      );
    } catch (error) {
      if (error?.code === '23505' || String(error.message || '').includes('unique')) {
        return json(res, 409, { message: '用户名已存在' });
      }
      throw error;
    }
    return json(res, 201, { user: sanitizeUser(user) });
  }

  if (req.method === 'POST' && pathName === '/api/login') {
    const body = await readBody(req);
    const username = normalizeName(body.username).toLowerCase();
    const user = await findActiveUserByUsername(username);
    if (!user || !verifyPassword(String(body.password || ''), user.passwordHash)) {
      return json(res, 401, { message: '用户名或密码错误' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    await db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)')
      .run(token, user.id, new Date().toISOString());
    return json(res, 200, { token, user: sanitizeUser(user) });
  }

  return false;
}

export async function handleCurrentUser(req, res, pathName, user) {
  const db = getDb();

  if (req.method === 'GET' && pathName === '/api/me') {
    return json(res, 200, { user: sanitizeUser(user) });
  }

  if (req.method === 'PATCH' && pathName === '/api/me') {
    const body = await readBody(req);
    const updates = {};
    if (Object.hasOwn(body, 'displayName')) {
      const displayName = normalizeName(body.displayName);
      if (displayName.length < 1 || displayName.length > 24) {
        return json(res, 400, { message: '昵称需为 1-24 个字符' });
      }
      updates.displayName = displayName;
    }
    if (Object.hasOwn(body, 'avatarDataUrl')) {
      const avatarDataUrl = String(body.avatarDataUrl || '');
      if (avatarDataUrl && (!isImageDataUrl(avatarDataUrl) || avatarDataUrl.length > maxImageDataUrlLength)) {
        return json(res, 400, { message: '头像需为 700KB 以内的图片' });
      }
      updates.avatarPath = avatarDataUrl ? await saveImageDataUrl(avatarDataUrl, 'avatars', user.id) : null;
    }
    if (Object.hasOwn(body, 'bubbleTheme')) {
      const bubbleTheme = String(body.bubbleTheme || '');
      if (!bubbleThemes.has(bubbleTheme)) {
        return json(res, 400, { message: '气泡颜色无效' });
      }
      updates.bubbleTheme = bubbleTheme;
    }
    if (Object.hasOwn(body, 'bio')) {
      const bio = String(body.bio || '').trim();
      if (bio.length > 120) {
        return json(res, 400, { message: '个人简介最多 120 个字符' });
      }
      updates.bio = bio;
    }
    if (Object.hasOwn(updates, 'displayName')) {
      await db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(updates.displayName, user.id);
    }
    if (Object.hasOwn(updates, 'avatarPath')) {
      await db.prepare('UPDATE users SET avatar_path = ? WHERE id = ?').run(updates.avatarPath, user.id);
    }
    if (Object.hasOwn(updates, 'bubbleTheme')) {
      await db.prepare('UPDATE users SET bubble_theme = ? WHERE id = ?').run(updates.bubbleTheme, user.id);
    }
    if (Object.hasOwn(updates, 'bio')) {
      await db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(updates.bio, user.id);
    }
    return json(res, 200, { user: sanitizeUser(await getUserById(user.id)) });
  }

  if (req.method === 'POST' && pathName === '/api/me/verify-password') {
    const body = await readBody(req);
    if (!verifyPassword(String(body.password || ''), user.passwordHash)) {
      return json(res, 401, { message: '登录密码错误' });
    }
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathName === '/api/me/password') {
    const body = await readBody(req);
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    if (!verifyPassword(currentPassword, user.passwordHash)) {
      return json(res, 401, { message: '当前登录密码错误' });
    }
    if (newPassword.length < 6) {
      return json(res, 400, { message: '新密码至少 6 位' });
    }
    if (currentPassword === newPassword) {
      return json(res, 400, { message: '新密码不能与当前密码相同' });
    }
    const userWrappedKeys = Array.isArray(body.userWrappedKeys) ? body.userWrappedKeys : [];
    const handshakeKeys = Array.isArray(body.handshakeKeys) ? body.handshakeKeys : [];
    try {
      await execTransaction(async () => {
        await applyLoginPasswordRewraps(user.id, userWrappedKeys, handshakeKeys);
        await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), user.id);
        await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      });
    } catch (error) {
      return json(res, 400, { message: error.message || '密钥重封失败' });
    }
    return json(res, 200, {
      ok: true,
      rewrappedUserKeys: userWrappedKeys.length,
      rewrappedHandshakeKeys: handshakeKeys.length
    });
  }

  if (req.method === 'DELETE' && pathName === '/api/me') {
    if (user.isAdmin) {
      return json(res, 400, { message: '管理员账号不能注销' });
    }
    const now = new Date().toISOString();
    const updated = { ...user, disabledAt: now, displayName: `${user.displayName}（已注销）` };
    releaseDeletedUsername(updated);
    await execTransaction(async () => {
      await db.prepare(`
        UPDATE users
        SET username = ?, display_name = ?, disabled_at = ?, deleted_username = ?
        WHERE id = ?
      `).run(updated.username, updated.displayName, updated.disabledAt, updated.deletedUsername, updated.id);
      await db.prepare('DELETE FROM contacts WHERE owner_id = ? OR contact_id = ?').run(user.id, user.id);
      await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    });
    return json(res, 200, { ok: true });
  }

  return false;
}
