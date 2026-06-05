import http from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const dbPath = path.join(dataDir, 'db.json');
const port = Number(process.env.PORT || 3101);
const sessions = new Map();
const recallWindowMs = 8 * 60 * 1000;
const maxImageDataUrlLength = 700_000;
const bubbleThemes = new Set(['mint', 'pink', 'purple', 'sky', 'peach', 'lavender']);
const adminUsername = 'admin';
const initialAdminPassword = process.env.ADMIN_PASSWORD || 'admin123';

let db = {
  users: [],
  contacts: [],
  messages: [],
  stickers: []
};

async function loadDb() {
  await mkdir(dataDir, { recursive: true });
  if (!existsSync(dbPath)) {
    ensureAdminUser();
    await saveDb();
    return;
  }
  const text = await readFile(dbPath, 'utf8');
  db = JSON.parse(text);
  db.stickers ||= [];
  const deletedUsernamesReleased = releaseDeletedUsernames();
  const adminUserEnsured = ensureAdminUser();
  if (deletedUsernamesReleased || adminUserEnsured) {
    await saveDb();
  }
}

async function saveDb() {
  await mkdir(dataDir, { recursive: true });
  const tmpPath = `${dbPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(db, null, 2));
  await rename(tmpPath, dbPath);
}

function json(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('JSON 格式无效'));
      }
    });
    req.on('error', reject);
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = stored.split(':');
  const actual = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), actual);
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarDataUrl: user.avatarDataUrl || '',
    bubbleTheme: bubbleThemes.has(user.bubbleTheme) ? user.bubbleTheme : 'mint',
    createdAt: user.createdAt,
    disabledAt: user.disabledAt || null,
    isAdmin: Boolean(user.isAdmin)
  };
}

function getAuthUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const userId = sessions.get(token);
  return userId ? db.users.find((user) => user.id === userId) : null;
}

function normalizeName(name) {
  return String(name || '').trim();
}

function findActiveUserByUsername(username) {
  return db.users.find((user) => user.username === username && !user.disabledAt);
}

function ensureAdminUser() {
  const admin = db.users.find((user) => user.username === adminUsername);
  if (admin) {
    if (!admin.isAdmin) {
      admin.isAdmin = true;
      return true;
    }
    return false;
  }
  db.users.push({
    id: crypto.randomUUID(),
    username: adminUsername,
    displayName: '管理员',
    passwordHash: hashPassword(initialAdminPassword),
    isAdmin: true,
    createdAt: new Date().toISOString()
  });
  return true;
}

function releaseDeletedUsername(user) {
  if (String(user.username || '').startsWith('deleted:')) return false;
  user.deletedUsername ||= user.username;
  user.username = `deleted:${user.id}:${user.deletedUsername}`;
  return true;
}

function releaseDeletedUsernames() {
  let changed = false;
  for (const user of db.users) {
    if (user.disabledAt) {
      changed = releaseDeletedUsername(user) || changed;
    }
  }
  return changed;
}

function conversationKey(a, b) {
  return [a, b].sort().join(':');
}

function messagePreview(message) {
  if (!message) return '';
  if (message.recalledAt) return '消息已撤回';
  return message.kind === 'sticker' ? '[表情包]' : message.text;
}

function isImageDataUrl(value) {
  return /^data:image\/(png|jpe?g|gif|webp);base64,[a-zA-Z0-9+/=]+$/.test(String(value || ''));
}

function sanitizeSticker(sticker) {
  return {
    id: sticker.id,
    ownerId: sticker.ownerId,
    name: sticker.name,
    imageDataUrl: sticker.imageDataUrl,
    createdAt: sticker.createdAt
  };
}

function sanitizeAdminUser(user) {
  return {
    ...sanitizeUser(user),
    avatarDataUrl: '',
    deletedUsername: user.deletedUsername || null,
    messageCount: db.messages.filter((message) => message.fromId === user.id || message.toId === user.id).length,
    contactCount: db.contacts.filter((item) => item.ownerId === user.id || item.contactId === user.id).length,
    stickerCount: db.stickers.filter((sticker) => sticker.ownerId === user.id).length
  };
}

function areContacts(userId, contactId) {
  return db.contacts.some(
    (item) =>
      (item.ownerId === userId && item.contactId === contactId) ||
      (item.ownerId === contactId && item.contactId === userId)
  );
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathName = url.pathname;

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
    if (findActiveUserByUsername(username)) {
      return json(res, 409, { message: '用户名已存在' });
    }

    const user = {
      id: crypto.randomUUID(),
      username,
      displayName,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString()
    };
    db.users.push(user);
    await saveDb();
    return json(res, 201, { user: sanitizeUser(user) });
  }

  if (req.method === 'POST' && pathName === '/api/login') {
    const body = await readBody(req);
    const username = normalizeName(body.username).toLowerCase();
    const user = findActiveUserByUsername(username);
    if (!user || !verifyPassword(String(body.password || ''), user.passwordHash)) {
      return json(res, 401, { message: '用户名或密码错误' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, user.id);
    return json(res, 200, { token, user: sanitizeUser(user) });
  }

  const user = getAuthUser(req);
  if (!user) {
    return json(res, 401, { message: '请先登录' });
  }
  if (user.disabledAt) {
    return json(res, 401, { message: '账号已注销' });
  }

  if (req.method === 'GET' && pathName === '/api/me') {
    return json(res, 200, { user: sanitizeUser(user) });
  }

  if (pathName.startsWith('/api/admin/')) {
    if (!user.isAdmin) {
      return json(res, 403, { message: '需要管理员权限' });
    }

    if (req.method === 'GET' && pathName === '/api/admin/users') {
      const users = db.users
        .map(sanitizeAdminUser)
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      return json(res, 200, { users });
    }

    if (req.method === 'PATCH' && pathName.startsWith('/api/admin/users/') && pathName.endsWith('/password')) {
      const userId = pathName.split('/').at(-2);
      const target = db.users.find((item) => item.id === userId);
      const body = await readBody(req);
      const password = String(body.password || '');
      if (!target) {
        return json(res, 404, { message: '用户不存在' });
      }
      if (target.disabledAt) {
        return json(res, 400, { message: '已注销用户不能重置密码' });
      }
      if (password.length < 6) {
        return json(res, 400, { message: '密码至少 6 位' });
      }
      target.passwordHash = hashPassword(password);
      await saveDb();
      return json(res, 200, { user: sanitizeAdminUser(target) });
    }

    if (req.method === 'DELETE' && pathName.startsWith('/api/admin/users/') && pathName.endsWith('/data')) {
      const userId = pathName.split('/').at(-2);
      const target = db.users.find((item) => item.id === userId);
      if (!target) {
        return json(res, 404, { message: '用户不存在' });
      }
      if (!target.disabledAt) {
        return json(res, 400, { message: '只能清理已注销用户的数据' });
      }
      if (target.isAdmin) {
        return json(res, 400, { message: '不能清理管理员账号' });
      }
      db.users = db.users.filter((item) => item.id !== target.id);
      db.contacts = db.contacts.filter((item) => item.ownerId !== target.id && item.contactId !== target.id);
      db.messages = db.messages.filter((message) => message.fromId !== target.id && message.toId !== target.id);
      db.stickers = db.stickers.filter((sticker) => sticker.ownerId !== target.id);
      for (const [token, userIdForSession] of sessions.entries()) {
        if (userIdForSession === target.id) sessions.delete(token);
      }
      await saveDb();
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { message: '接口不存在' });
  }

  if (req.method === 'PATCH' && pathName === '/api/me') {
    const body = await readBody(req);
    if (Object.hasOwn(body, 'displayName')) {
      const displayName = normalizeName(body.displayName);
      if (displayName.length < 1 || displayName.length > 24) {
        return json(res, 400, { message: '昵称需为 1-24 个字符' });
      }
      user.displayName = displayName;
    }
    if (Object.hasOwn(body, 'avatarDataUrl')) {
      const avatarDataUrl = String(body.avatarDataUrl || '');
      if (avatarDataUrl && (!isImageDataUrl(avatarDataUrl) || avatarDataUrl.length > maxImageDataUrlLength)) {
        return json(res, 400, { message: '头像需为 700KB 以内的图片' });
      }
      user.avatarDataUrl = avatarDataUrl;
    }
    if (Object.hasOwn(body, 'bubbleTheme')) {
      const bubbleTheme = String(body.bubbleTheme || '');
      if (!bubbleThemes.has(bubbleTheme)) {
        return json(res, 400, { message: '气泡颜色无效' });
      }
      user.bubbleTheme = bubbleTheme;
    }
    await saveDb();
    return json(res, 200, { user: sanitizeUser(user) });
  }

  if (req.method === 'GET' && pathName === '/api/stickers') {
    const stickers = db.stickers
      .filter((sticker) => sticker.ownerId === user.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(sanitizeSticker);
    return json(res, 200, { stickers });
  }

  if (req.method === 'POST' && pathName === '/api/stickers') {
    const body = await readBody(req);
    const name = normalizeName(body.name).slice(0, 32) || '表情包';
    const imageDataUrl = String(body.imageDataUrl || '');
    if (!isImageDataUrl(imageDataUrl) || imageDataUrl.length > maxImageDataUrlLength) {
      return json(res, 400, { message: '表情包需为 700KB 以内的图片' });
    }
    const sticker = {
      id: crypto.randomUUID(),
      ownerId: user.id,
      name,
      imageDataUrl,
      createdAt: new Date().toISOString()
    };
    db.stickers.push(sticker);
    await saveDb();
    return json(res, 201, { sticker: sanitizeSticker(sticker) });
  }

  if (req.method === 'DELETE' && pathName.startsWith('/api/stickers/')) {
    const stickerId = pathName.split('/').pop();
    const sticker = db.stickers.find((item) => item.id === stickerId && item.ownerId === user.id);
    if (!sticker) {
      return json(res, 404, { message: '表情包不存在' });
    }
    db.stickers = db.stickers.filter((item) => item.id !== sticker.id);
    await saveDb();
    return json(res, 200, { ok: true });
  }

  if (req.method === 'DELETE' && pathName === '/api/me') {
    if (user.isAdmin) {
      return json(res, 400, { message: '管理员账号不能注销' });
    }
    const now = new Date().toISOString();
    user.disabledAt = now;
    user.displayName = `${user.displayName}（已注销）`;
    releaseDeletedUsername(user);
    db.contacts = db.contacts.filter((item) => item.ownerId !== user.id && item.contactId !== user.id);
    for (const [token, userId] of sessions.entries()) {
      if (userId === user.id) sessions.delete(token);
    }
    await saveDb();
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathName === '/api/contacts') {
    const contactIds = db.contacts
      .filter((item) => item.ownerId === user.id)
      .map((item) => item.contactId);
    const contacts = db.users
      .filter((item) => contactIds.includes(item.id) && !item.disabledAt)
      .map((item) => {
        const lastMessage = [...db.messages]
          .reverse()
          .find((message) => message.conversationId === conversationKey(user.id, item.id));
        const unreadCount = db.messages.filter(
          (message) =>
            message.conversationId === conversationKey(user.id, item.id) &&
            message.toId === user.id &&
            !message.readAt &&
            !message.recalledAt
        ).length;
        return {
          ...sanitizeUser(item),
          lastMessage: messagePreview(lastMessage),
          lastMessageAt: lastMessage?.createdAt || null,
          unreadCount
        };
      })
      .sort((a, b) => String(b.lastMessageAt || '').localeCompare(String(a.lastMessageAt || '')));
    return json(res, 200, { contacts });
  }

  if (req.method === 'POST' && pathName === '/api/contacts') {
    const body = await readBody(req);
    const username = normalizeName(body.username).toLowerCase();
    const target = db.users.find((item) => item.username === username && !item.disabledAt);
    if (!target) {
      return json(res, 404, { message: '未找到该用户' });
    }
    if (target.id === user.id) {
      return json(res, 400, { message: '不能添加自己' });
    }
    for (const [ownerId, contactId] of [
      [user.id, target.id],
      [target.id, user.id]
    ]) {
      if (!db.contacts.some((item) => item.ownerId === ownerId && item.contactId === contactId)) {
        db.contacts.push({ ownerId, contactId, createdAt: new Date().toISOString() });
      }
    }
    await saveDb();
    return json(res, 201, { contact: sanitizeUser(target) });
  }

  if (req.method === 'GET' && pathName.startsWith('/api/messages/')) {
    const contactId = pathName.split('/').pop();
    const target = db.users.find((item) => item.id === contactId);
    if (!target || target.disabledAt || !areContacts(user.id, target.id)) {
      return json(res, 404, { message: '联系人不存在' });
    }
    const key = conversationKey(user.id, target.id);
    const messages = db.messages
      .filter((message) => message.conversationId === key)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return json(res, 200, { messages });
  }

  if (req.method === 'POST' && pathName.startsWith('/api/messages/') && pathName.endsWith('/read')) {
    const parts = pathName.split('/');
    const contactId = parts.at(-2);
    const target = db.users.find((item) => item.id === contactId);
    if (!target || target.disabledAt || !areContacts(user.id, target.id)) {
      return json(res, 404, { message: '联系人不存在' });
    }
    const key = conversationKey(user.id, target.id);
    const now = new Date().toISOString();
    let changed = false;
    for (const message of db.messages) {
      if (message.conversationId === key && message.toId === user.id && !message.readAt) {
        message.readAt = now;
        changed = true;
      }
    }
    if (changed) await saveDb();
    return json(res, 200, { ok: true, readAt: changed ? now : null });
  }

  if (req.method === 'PATCH' && pathName.startsWith('/api/messages/') && pathName.endsWith('/recall')) {
    const parts = pathName.split('/');
    const messageId = parts.at(-2);
    const message = db.messages.find((item) => item.id === messageId);
    if (!message || message.fromId !== user.id) {
      return json(res, 404, { message: '消息不存在' });
    }
    if (message.recalledAt) {
      return json(res, 400, { message: '消息已撤回' });
    }
    if (Date.now() - new Date(message.createdAt).getTime() > recallWindowMs) {
      return json(res, 400, { message: '消息发送超过 8 分钟，不能撤回' });
    }
    const now = new Date().toISOString();
    message.recalledAt = now;
    message.text = '';
    for (const item of db.messages) {
      if (item.quote?.id === message.id) {
        item.quote = {
          ...item.quote,
          text: '消息已撤回',
          recalledAt: now
        };
      }
    }
    await saveDb();
    return json(res, 200, { message });
  }

  if (req.method === 'POST' && pathName === '/api/messages') {
    const body = await readBody(req);
    const toId = String(body.toId || '');
    const kind = body.kind === 'sticker' ? 'sticker' : 'text';
    const text = String(body.text || '').trim();
    const quoteId = String(body.quoteId || '');
    const stickerId = String(body.stickerId || '');
    const target = db.users.find((item) => item.id === toId);
    if (!target || target.disabledAt || !areContacts(user.id, target.id)) {
      return json(res, 404, { message: '联系人不存在' });
    }
    if (kind === 'text' && !text) {
      return json(res, 400, { message: '消息不能为空' });
    }
    if (text.length > 1000) {
      return json(res, 400, { message: '消息最多 1000 字' });
    }
    let sticker = null;
    if (kind === 'sticker') {
      sticker = db.stickers.find((item) => item.id === stickerId && item.ownerId === user.id);
      if (!sticker) {
        return json(res, 404, { message: '表情包不存在' });
      }
    }
    const conversationId = conversationKey(user.id, target.id);
    let quote = null;
    if (quoteId) {
      const quotedMessage = db.messages.find(
        (message) => message.id === quoteId && message.conversationId === conversationId
      );
      if (!quotedMessage) {
        return json(res, 400, { message: '引用的消息不存在' });
      }
      const author = db.users.find((item) => item.id === quotedMessage.fromId);
      quote = {
        id: quotedMessage.id,
        fromId: quotedMessage.fromId,
        authorName: author?.displayName || '已注销用户',
        text: messagePreview(quotedMessage),
        kind: quotedMessage.kind || 'text',
        sticker: quotedMessage.kind === 'sticker' && quotedMessage.sticker
          ? {
              id: quotedMessage.sticker.id,
              name: quotedMessage.sticker.name,
              imageDataUrl: quotedMessage.sticker.imageDataUrl
            }
          : null,
        createdAt: quotedMessage.createdAt,
        recalledAt: quotedMessage.recalledAt || null
      };
    }
    const message = {
      id: crypto.randomUUID(),
      conversationId,
      fromId: user.id,
      toId: target.id,
      kind,
      text: kind === 'sticker' ? '[表情包]' : text,
      sticker: sticker
        ? {
            id: sticker.id,
            name: sticker.name,
            imageDataUrl: sticker.imageDataUrl
          }
        : null,
      quote,
      createdAt: new Date().toISOString(),
      readAt: null,
      recalledAt: null
    };
    db.messages.push(message);
    await saveDb();
    return json(res, 201, { message });
  }

  return json(res, 404, { message: '接口不存在' });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url?.startsWith('/api/')) {
      await handleApi(req, res);
      return;
    }
    json(res, 404, { message: '仅提供 API 服务，请通过 Vite 打开前端' });
  } catch (error) {
    json(res, 500, { message: error.message || '服务器错误' });
  }
});

await loadDb();
server.listen(port, () => {
  console.log(`API server listening on http://localhost:${port}`);
});
