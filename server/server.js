import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const legacyDbPath = path.join(dataDir, 'db.json');
const sqlitePath = path.join(dataDir, 'app.sqlite');
const uploadsDir = path.join(dataDir, 'uploads');
const port = Number(process.env.PORT || 3101);
const sessions = new Map();
const recallWindowMs = 8 * 60 * 1000;
const maxImageDataUrlLength = 700_000;
const bubbleThemes = new Set(['mint', 'pink', 'purple', 'sky', 'peach', 'lavender']);
const adminUsername = 'admin';
const initialAdminPassword = process.env.ADMIN_PASSWORD || 'admin123';

let db;

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
  const [salt, expected] = String(stored || '').split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), actual);
}

function normalizeName(name) {
  return String(name || '').trim();
}

function conversationKey(a, b) {
  return [a, b].sort().join(':');
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function stringifyJson(value) {
  return value == null ? null : JSON.stringify(value);
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    passwordHash: row.passwordHash,
    avatarDataUrl: row.avatarPath || row.avatarDataUrl || '',
    avatarPath: row.avatarPath || null,
    bubbleTheme: row.bubbleTheme || 'mint',
    createdAt: row.createdAt,
    disabledAt: row.disabledAt || null,
    deletedUsername: row.deletedUsername || null,
    isAdmin: Boolean(row.isAdmin)
  };
}

function rowToSticker(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    imageDataUrl: row.imagePath || row.imageDataUrl,
    imagePath: row.imagePath || null,
    createdAt: row.createdAt
  };
}

function rowToMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversationId,
    fromId: row.fromId,
    toId: row.toId,
    kind: row.kind || 'text',
    text: row.text || '',
    sticker: parseJson(row.stickerJson),
    quote: parseJson(row.quoteJson),
    createdAt: row.createdAt,
    readAt: row.readAt || null,
    recalledAt: row.recalledAt || null
  };
}

function userSelect(prefix = '') {
  return `
    ${prefix}id AS id,
    ${prefix}username AS username,
    ${prefix}display_name AS displayName,
    ${prefix}password_hash AS passwordHash,
    ${prefix}avatar_data_url AS avatarDataUrl,
    ${prefix}avatar_path AS avatarPath,
    ${prefix}bubble_theme AS bubbleTheme,
    ${prefix}created_at AS createdAt,
    ${prefix}disabled_at AS disabledAt,
    ${prefix}deleted_username AS deletedUsername,
    ${prefix}is_admin AS isAdmin
  `;
}

function stickerSelect(prefix = '') {
  return `
    ${prefix}id AS id,
    ${prefix}owner_id AS ownerId,
    ${prefix}name AS name,
    ${prefix}image_data_url AS imageDataUrl,
    ${prefix}image_path AS imagePath,
    ${prefix}created_at AS createdAt
  `;
}

function messageSelect(prefix = '') {
  return `
    ${prefix}id AS id,
    ${prefix}conversation_id AS conversationId,
    ${prefix}from_id AS fromId,
    ${prefix}to_id AS toId,
    ${prefix}kind AS kind,
    ${prefix}text AS text,
    ${prefix}sticker_json AS stickerJson,
    ${prefix}quote_json AS quoteJson,
    ${prefix}created_at AS createdAt,
    ${prefix}read_at AS readAt,
    ${prefix}recalled_at AS recalledAt
  `;
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

function sanitizeSticker(sticker) {
  return {
    id: sticker.id,
    ownerId: sticker.ownerId,
    name: sticker.name,
    imageDataUrl: sticker.imageDataUrl,
    createdAt: sticker.createdAt
  };
}

function messagePreview(message) {
  if (!message) return '';
  if (message.recalledAt) return '消息已撤回';
  return message.kind === 'sticker' ? '[表情包]' : message.text;
}

function isImageDataUrl(value) {
  return /^data:image\/(png|jpe?g|gif|webp);base64,[a-zA-Z0-9+/=]+$/.test(String(value || ''));
}

function isUploadPath(value) {
  return String(value || '').startsWith('/uploads/');
}

function imageExtensionFromMime(mime) {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

async function saveImageDataUrl(dataUrl, folder, fileBaseName) {
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

async function serveUpload(req, res) {
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

function execTransaction(callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function createSchema() {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_data_url TEXT,
      avatar_path TEXT,
      bubble_theme TEXT,
      created_at TEXT NOT NULL,
      disabled_at TEXT,
      deleted_username TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_active_username
      ON users(username)
      WHERE disabled_at IS NULL;

    CREATE TABLE IF NOT EXISTS contacts (
      owner_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (owner_id, contact_id)
    );

    CREATE INDEX IF NOT EXISTS idx_contacts_contact
      ON contacts(contact_id);

    CREATE TABLE IF NOT EXISTS stickers (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      image_data_url TEXT NOT NULL,
      image_path TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_stickers_owner_created
      ON stickers(owner_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      sticker_json TEXT,
      quote_json TEXT,
      created_at TEXT NOT NULL,
      read_at TEXT,
      recalled_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
      ON messages(conversation_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_messages_to_unread
      ON messages(to_id, read_at, recalled_at);

    CREATE INDEX IF NOT EXISTS idx_messages_user
      ON messages(from_id, to_id);
  `);
  ensureColumn('users', 'avatar_path', 'TEXT');
  ensureColumn('stickers', 'image_path', 'TEXT');
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function releaseDeletedUsername(user) {
  if (String(user.username || '').startsWith('deleted:')) return false;
  user.deletedUsername ||= user.username;
  user.username = `deleted:${user.id}:${user.deletedUsername}`;
  return true;
}

function importLegacyDb(legacy) {
  legacy.users ||= [];
  legacy.contacts ||= [];
  legacy.messages ||= [];
  legacy.stickers ||= [];

  for (const user of legacy.users) {
    if (user.disabledAt) releaseDeletedUsername(user);
  }

  const insertUser = db.prepare(`
    INSERT OR REPLACE INTO users (
      id, username, display_name, password_hash, avatar_data_url, avatar_path, bubble_theme,
      created_at, disabled_at, deleted_username, is_admin
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertContact = db.prepare(`
    INSERT OR IGNORE INTO contacts (owner_id, contact_id, created_at)
    VALUES (?, ?, ?)
  `);
  const insertSticker = db.prepare(`
    INSERT OR REPLACE INTO stickers (id, owner_id, name, image_data_url, image_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertMessage = db.prepare(`
    INSERT OR REPLACE INTO messages (
      id, conversation_id, from_id, to_id, kind, text, sticker_json, quote_json,
      created_at, read_at, recalled_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  execTransaction(() => {
    for (const user of legacy.users) {
      insertUser.run(
        user.id,
        user.username,
        user.displayName || user.username,
        user.passwordHash,
        user.avatarDataUrl || null,
        null,
        user.bubbleTheme || 'mint',
        user.createdAt || new Date().toISOString(),
        user.disabledAt || null,
        user.deletedUsername || null,
        user.isAdmin ? 1 : 0
      );
    }
    for (const contact of legacy.contacts) {
      insertContact.run(contact.ownerId, contact.contactId, contact.createdAt || new Date().toISOString());
    }
    for (const sticker of legacy.stickers) {
      insertSticker.run(
        sticker.id,
        sticker.ownerId,
        sticker.name || '表情包',
        sticker.imageDataUrl || '',
        null,
        sticker.createdAt || new Date().toISOString()
      );
    }
    for (const message of legacy.messages) {
      insertMessage.run(
        message.id,
        message.conversationId || conversationKey(message.fromId, message.toId),
        message.fromId,
        message.toId,
        message.kind || 'text',
        message.text || '',
        stringifyJson(message.sticker),
        stringifyJson(message.quote),
        message.createdAt || new Date().toISOString(),
        message.readAt || null,
        message.recalledAt || null
      );
    }
  });
}

async function openDb() {
  await mkdir(dataDir, { recursive: true });
  db = new DatabaseSync(sqlitePath);
  createSchema();

  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (userCount === 0 && existsSync(legacyDbPath)) {
    const legacy = JSON.parse(await readFile(legacyDbPath, 'utf8'));
    importLegacyDb(legacy);
    console.log(`Imported legacy data from ${legacyDbPath} into ${sqlitePath}`);
  }

  releaseDeletedUsernames();
  ensureAdminUser();
  await migrateStoredImagesToFiles();
}

async function migrateStoredImagesToFiles() {
  const users = db
    .prepare(`SELECT id, avatar_data_url AS avatarDataUrl FROM users WHERE avatar_data_url LIKE 'data:image/%'`)
    .all();
  for (const user of users) {
    const avatarPath = await saveImageDataUrl(user.avatarDataUrl, 'avatars', user.id);
    db.prepare('UPDATE users SET avatar_data_url = NULL, avatar_path = ? WHERE id = ?').run(avatarPath, user.id);
  }

  const stickers = db
    .prepare(`SELECT id, image_data_url AS imageDataUrl FROM stickers WHERE image_data_url LIKE 'data:image/%'`)
    .all();
  for (const sticker of stickers) {
    const imagePath = await saveImageDataUrl(sticker.imageDataUrl, 'stickers', sticker.id);
    db.prepare('UPDATE stickers SET image_data_url = ?, image_path = ? WHERE id = ?').run('', imagePath, sticker.id);
  }

  const stickerPaths = new Map(
    db.prepare('SELECT id, image_path AS imagePath FROM stickers WHERE image_path IS NOT NULL').all()
      .map((sticker) => [sticker.id, sticker.imagePath])
  );
  const messages = db
    .prepare(`SELECT id, sticker_json AS stickerJson, quote_json AS quoteJson FROM messages WHERE sticker_json LIKE '%data:image/%' OR quote_json LIKE '%data:image/%'`)
    .all();
  const updateMessage = db.prepare('UPDATE messages SET sticker_json = ?, quote_json = ? WHERE id = ?');
  for (const message of messages) {
    const sticker = parseJson(message.stickerJson);
    const quote = parseJson(message.quoteJson);
    let changed = false;

    if (sticker && isImageDataUrl(sticker.imageDataUrl)) {
      sticker.imageDataUrl = stickerPaths.get(sticker.id) || await saveImageDataUrl(sticker.imageDataUrl, 'message-stickers', sticker.id || message.id);
      changed = true;
    }
    if (quote?.sticker && isImageDataUrl(quote.sticker.imageDataUrl)) {
      quote.sticker.imageDataUrl = stickerPaths.get(quote.sticker.id) || await saveImageDataUrl(quote.sticker.imageDataUrl, 'message-stickers', quote.sticker.id || message.id);
      changed = true;
    }
    if (changed) {
      updateMessage.run(stringifyJson(sticker), stringifyJson(quote), message.id);
    }
  }
}

function getUserById(id) {
  return rowToUser(db.prepare(`SELECT ${userSelect()} FROM users WHERE id = ?`).get(id));
}

function findActiveUserByUsername(username) {
  return rowToUser(
    db.prepare(`SELECT ${userSelect()} FROM users WHERE username = ? AND disabled_at IS NULL`).get(username)
  );
}

function getAuthUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const userId = sessions.get(token);
  return userId ? getUserById(userId) : null;
}

function ensureAdminUser() {
  const admin = rowToUser(db.prepare(`SELECT ${userSelect()} FROM users WHERE username = ?`).get(adminUsername));
  if (admin) {
    if (!admin.isAdmin) {
      db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(admin.id);
    }
    return;
  }
  db.prepare(`
    INSERT INTO users (
      id, username, display_name, password_hash, avatar_data_url, avatar_path, bubble_theme,
      created_at, disabled_at, deleted_username, is_admin
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    adminUsername,
    '管理员',
    hashPassword(initialAdminPassword),
    null,
    null,
    'mint',
    new Date().toISOString(),
    null,
    null,
    1
  );
}

function releaseDeletedUsernames() {
  const users = db.prepare(`SELECT ${userSelect()} FROM users WHERE disabled_at IS NOT NULL`).all().map(rowToUser);
  const update = db.prepare('UPDATE users SET username = ?, deleted_username = ? WHERE id = ?');
  execTransaction(() => {
    for (const user of users) {
      if (releaseDeletedUsername(user)) {
        update.run(user.username, user.deletedUsername, user.id);
      }
    }
  });
}

function sanitizeAdminUser(user) {
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM messages WHERE from_id = ? OR to_id = ?) AS messageCount,
      (SELECT COUNT(*) FROM contacts WHERE owner_id = ? OR contact_id = ?) AS contactCount,
      (SELECT COUNT(*) FROM stickers WHERE owner_id = ?) AS stickerCount
  `).get(user.id, user.id, user.id, user.id, user.id);
  return {
    ...sanitizeUser(user),
    avatarDataUrl: '',
    deletedUsername: user.deletedUsername || null,
    messageCount: counts.messageCount,
    contactCount: counts.contactCount,
    stickerCount: counts.stickerCount
  };
}

function areContacts(userId, contactId) {
  const row = db
    .prepare(
      `SELECT 1 FROM contacts
       WHERE (owner_id = ? AND contact_id = ?) OR (owner_id = ? AND contact_id = ?)
       LIMIT 1`
    )
    .get(userId, contactId, contactId, userId);
  return Boolean(row);
}

function getStickerByIdForOwner(stickerId, ownerId) {
  return rowToSticker(
    db.prepare(`SELECT ${stickerSelect()} FROM stickers WHERE id = ? AND owner_id = ?`).get(stickerId, ownerId)
  );
}

function getMessageById(messageId) {
  return rowToMessage(db.prepare(`SELECT ${messageSelect()} FROM messages WHERE id = ?`).get(messageId));
}

function updateQuotesForRecalledMessage(message, now) {
  const rows = db.prepare(`SELECT id, quote_json AS quoteJson FROM messages WHERE quote_json IS NOT NULL`).all();
  const update = db.prepare('UPDATE messages SET quote_json = ? WHERE id = ?');
  for (const row of rows) {
    const quote = parseJson(row.quoteJson);
    if (quote?.id === message.id) {
      update.run(
        stringifyJson({
          ...quote,
          text: '消息已撤回',
          recalledAt: now
        }),
        row.id
      );
    }
  }
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
      avatarDataUrl: '',
      bubbleTheme: 'mint',
      createdAt: new Date().toISOString(),
      disabledAt: null,
      deletedUsername: null,
      isAdmin: false
    };
    db.prepare(`
      INSERT INTO users (
        id, username, display_name, password_hash, avatar_data_url, avatar_path, bubble_theme,
        created_at, disabled_at, deleted_username, is_admin
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id,
      user.username,
      user.displayName,
      user.passwordHash,
      null,
      null,
      user.bubbleTheme,
      user.createdAt,
      null,
      null,
      0
    );
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
      const users = db
        .prepare(`SELECT ${userSelect()} FROM users ORDER BY created_at DESC`)
        .all()
        .map(rowToUser)
        .map(sanitizeAdminUser);
      return json(res, 200, { users });
    }

    if (req.method === 'PATCH' && pathName.startsWith('/api/admin/users/') && pathName.endsWith('/password')) {
      const userId = pathName.split('/').at(-2);
      const target = getUserById(userId);
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
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), target.id);
      return json(res, 200, { user: sanitizeAdminUser(getUserById(target.id)) });
    }

    if (req.method === 'DELETE' && pathName.startsWith('/api/admin/users/') && pathName.endsWith('/data')) {
      const userId = pathName.split('/').at(-2);
      const target = getUserById(userId);
      if (!target) {
        return json(res, 404, { message: '用户不存在' });
      }
      if (!target.disabledAt) {
        return json(res, 400, { message: '只能清理已注销用户的数据' });
      }
      if (target.isAdmin) {
        return json(res, 400, { message: '不能清理管理员账号' });
      }
      execTransaction(() => {
        db.prepare('DELETE FROM contacts WHERE owner_id = ? OR contact_id = ?').run(target.id, target.id);
        db.prepare('DELETE FROM messages WHERE from_id = ? OR to_id = ?').run(target.id, target.id);
        db.prepare('DELETE FROM stickers WHERE owner_id = ?').run(target.id);
        db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
      });
      for (const [token, userIdForSession] of sessions.entries()) {
        if (userIdForSession === target.id) sessions.delete(token);
      }
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { message: '接口不存在' });
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
    if (Object.hasOwn(updates, 'displayName')) {
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(updates.displayName, user.id);
    }
    if (Object.hasOwn(updates, 'avatarPath')) {
      db.prepare('UPDATE users SET avatar_data_url = NULL, avatar_path = ? WHERE id = ?').run(updates.avatarPath, user.id);
    }
    if (Object.hasOwn(updates, 'bubbleTheme')) {
      db.prepare('UPDATE users SET bubble_theme = ? WHERE id = ?').run(updates.bubbleTheme, user.id);
    }
    return json(res, 200, { user: sanitizeUser(getUserById(user.id)) });
  }

  if (req.method === 'GET' && pathName === '/api/stickers') {
    const stickers = db
      .prepare(`SELECT ${stickerSelect()} FROM stickers WHERE owner_id = ? ORDER BY created_at DESC`)
      .all(user.id)
      .map(rowToSticker)
      .map(sanitizeSticker);
    return json(res, 200, { stickers });
  }

  if (req.method === 'POST' && pathName === '/api/stickers') {
    const body = await readBody(req);
    const name = normalizeName(body.name).slice(0, 32) || '表情包';
    const imageDataUrl = String(body.imageDataUrl || '');
    if ((!isImageDataUrl(imageDataUrl) || imageDataUrl.length > maxImageDataUrlLength) && !isUploadPath(imageDataUrl)) {
      return json(res, 400, { message: '表情包需为 700KB 以内的图片' });
    }
    const imagePath = isUploadPath(imageDataUrl)
      ? imageDataUrl
      : await saveImageDataUrl(imageDataUrl, 'stickers', crypto.randomUUID());
    const sticker = {
      id: crypto.randomUUID(),
      ownerId: user.id,
      name,
      imageDataUrl: imagePath,
      imagePath,
      createdAt: new Date().toISOString()
    };
    db.prepare('INSERT INTO stickers (id, owner_id, name, image_data_url, image_path, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sticker.id, sticker.ownerId, sticker.name, '', sticker.imagePath, sticker.createdAt);
    return json(res, 201, { sticker: sanitizeSticker(sticker) });
  }

  if (req.method === 'DELETE' && pathName.startsWith('/api/stickers/')) {
    const stickerId = pathName.split('/').pop();
    const sticker = getStickerByIdForOwner(stickerId, user.id);
    if (!sticker) {
      return json(res, 404, { message: '表情包不存在' });
    }
    db.prepare('DELETE FROM stickers WHERE id = ? AND owner_id = ?').run(sticker.id, user.id);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'DELETE' && pathName === '/api/me') {
    if (user.isAdmin) {
      return json(res, 400, { message: '管理员账号不能注销' });
    }
    const now = new Date().toISOString();
    const updated = { ...user, disabledAt: now, displayName: `${user.displayName}（已注销）` };
    releaseDeletedUsername(updated);
    execTransaction(() => {
      db.prepare(`
        UPDATE users
        SET username = ?, display_name = ?, disabled_at = ?, deleted_username = ?
        WHERE id = ?
      `).run(updated.username, updated.displayName, updated.disabledAt, updated.deletedUsername, updated.id);
      db.prepare('DELETE FROM contacts WHERE owner_id = ? OR contact_id = ?').run(user.id, user.id);
    });
    for (const [token, userId] of sessions.entries()) {
      if (userId === user.id) sessions.delete(token);
    }
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathName === '/api/contacts') {
    const rows = db.prepare(`
      SELECT
        ${userSelect('u.')},
        (
          SELECT m.text
          FROM messages m
          WHERE m.conversation_id =
            CASE WHEN ? < u.id THEN ? || ':' || u.id ELSE u.id || ':' || ? END
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS lastText,
        (
          SELECT m.kind
          FROM messages m
          WHERE m.conversation_id =
            CASE WHEN ? < u.id THEN ? || ':' || u.id ELSE u.id || ':' || ? END
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS lastKind,
        (
          SELECT m.recalled_at
          FROM messages m
          WHERE m.conversation_id =
            CASE WHEN ? < u.id THEN ? || ':' || u.id ELSE u.id || ':' || ? END
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS lastRecalledAt,
        (
          SELECT m.created_at
          FROM messages m
          WHERE m.conversation_id =
            CASE WHEN ? < u.id THEN ? || ':' || u.id ELSE u.id || ':' || ? END
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS lastMessageAt,
        (
          SELECT COUNT(*)
          FROM messages m
          WHERE m.conversation_id =
            CASE WHEN ? < u.id THEN ? || ':' || u.id ELSE u.id || ':' || ? END
            AND m.to_id = ?
            AND m.read_at IS NULL
            AND m.recalled_at IS NULL
        ) AS unreadCount
      FROM contacts c
      JOIN users u ON u.id = c.contact_id
      WHERE c.owner_id = ? AND u.disabled_at IS NULL
      ORDER BY COALESCE(lastMessageAt, '') DESC
    `).all(
      user.id, user.id, user.id,
      user.id, user.id, user.id,
      user.id, user.id, user.id,
      user.id, user.id, user.id,
      user.id, user.id, user.id, user.id,
      user.id
    );
    const contacts = rows.map((row) => ({
      ...sanitizeUser(rowToUser(row)),
      lastMessage: messagePreview({
        text: row.lastText || '',
        kind: row.lastKind || 'text',
        recalledAt: row.lastRecalledAt || null
      }),
      lastMessageAt: row.lastMessageAt || null,
      unreadCount: row.unreadCount
    }));
    return json(res, 200, { contacts });
  }

  if (req.method === 'POST' && pathName === '/api/contacts') {
    const body = await readBody(req);
    const username = normalizeName(body.username).toLowerCase();
    const target = findActiveUserByUsername(username);
    if (!target) {
      return json(res, 404, { message: '未找到该用户' });
    }
    if (target.id === user.id) {
      return json(res, 400, { message: '不能添加自己' });
    }
    const now = new Date().toISOString();
    execTransaction(() => {
      db.prepare('INSERT OR IGNORE INTO contacts (owner_id, contact_id, created_at) VALUES (?, ?, ?)')
        .run(user.id, target.id, now);
      db.prepare('INSERT OR IGNORE INTO contacts (owner_id, contact_id, created_at) VALUES (?, ?, ?)')
        .run(target.id, user.id, now);
    });
    return json(res, 201, { contact: sanitizeUser(target) });
  }

  if (req.method === 'GET' && pathName.startsWith('/api/messages/')) {
    const contactId = pathName.split('/').pop();
    const target = getUserById(contactId);
    if (!target || target.disabledAt || !areContacts(user.id, target.id)) {
      return json(res, 404, { message: '联系人不存在' });
    }
    const key = conversationKey(user.id, target.id);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 100);
    const before = url.searchParams.get('before');
    const after = url.searchParams.get('after');
    let rows;

    if (after) {
      rows = db
        .prepare(`
          SELECT ${messageSelect()}
          FROM messages
          WHERE conversation_id = ? AND created_at > ?
          ORDER BY created_at ASC
          LIMIT ?
        `)
        .all(key, after, limit);
    } else if (before) {
      rows = db
        .prepare(`
          SELECT ${messageSelect()}
          FROM messages
          WHERE conversation_id = ? AND created_at < ?
          ORDER BY created_at DESC
          LIMIT ?
        `)
        .all(key, before, limit)
        .reverse();
    } else {
      rows = db
        .prepare(`
          SELECT ${messageSelect()}
          FROM messages
          WHERE conversation_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `)
        .all(key, limit)
        .reverse();
    }

    const messages = rows.map(rowToMessage);
    const firstCreatedAt = messages[0]?.createdAt || before || null;
    const hasMore = firstCreatedAt
      ? Boolean(
          db
            .prepare('SELECT 1 FROM messages WHERE conversation_id = ? AND created_at < ? LIMIT 1')
            .get(key, firstCreatedAt)
        )
      : false;
    return json(res, 200, { messages, hasMore });
  }

  if (req.method === 'POST' && pathName.startsWith('/api/messages/') && pathName.endsWith('/read')) {
    const parts = pathName.split('/');
    const contactId = parts.at(-2);
    const target = getUserById(contactId);
    if (!target || target.disabledAt || !areContacts(user.id, target.id)) {
      return json(res, 404, { message: '联系人不存在' });
    }
    const key = conversationKey(user.id, target.id);
    const now = new Date().toISOString();
    const result = db.prepare(`
      UPDATE messages
      SET read_at = ?
      WHERE conversation_id = ? AND to_id = ? AND read_at IS NULL
    `).run(now, key, user.id);
    return json(res, 200, { ok: true, readAt: result.changes ? now : null });
  }

  if (req.method === 'PATCH' && pathName.startsWith('/api/messages/') && pathName.endsWith('/recall')) {
    const parts = pathName.split('/');
    const messageId = parts.at(-2);
    const message = getMessageById(messageId);
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
    execTransaction(() => {
      db.prepare('UPDATE messages SET recalled_at = ?, text = ? WHERE id = ?').run(now, '', message.id);
      updateQuotesForRecalledMessage(message, now);
    });
    return json(res, 200, { message: getMessageById(message.id) });
  }

  if (req.method === 'POST' && pathName === '/api/messages') {
    const body = await readBody(req);
    const toId = String(body.toId || '');
    const kind = body.kind === 'sticker' ? 'sticker' : 'text';
    const text = String(body.text || '').trim();
    const quoteId = String(body.quoteId || '');
    const stickerId = String(body.stickerId || '');
    const target = getUserById(toId);
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
      sticker = getStickerByIdForOwner(stickerId, user.id);
      if (!sticker) {
        return json(res, 404, { message: '表情包不存在' });
      }
    }
    const conversationId = conversationKey(user.id, target.id);
    let quote = null;
    if (quoteId) {
      const quotedMessage = db
        .prepare(`SELECT ${messageSelect()} FROM messages WHERE id = ? AND conversation_id = ?`)
        .get(quoteId, conversationId);
      const quoted = rowToMessage(quotedMessage);
      if (!quoted) {
        return json(res, 400, { message: '引用的消息不存在' });
      }
      const author = getUserById(quoted.fromId);
      quote = {
        id: quoted.id,
        fromId: quoted.fromId,
        authorName: author?.displayName || '已注销用户',
        text: messagePreview(quoted),
        kind: quoted.kind || 'text',
        sticker: quoted.kind === 'sticker' && quoted.sticker
          ? {
              id: quoted.sticker.id,
              name: quoted.sticker.name,
              imageDataUrl: quoted.sticker.imageDataUrl
            }
          : null,
        createdAt: quoted.createdAt,
        recalledAt: quoted.recalledAt || null
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
    db.prepare(`
      INSERT INTO messages (
        id, conversation_id, from_id, to_id, kind, text, sticker_json, quote_json,
        created_at, read_at, recalled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      message.id,
      message.conversationId,
      message.fromId,
      message.toId,
      message.kind,
      message.text,
      stringifyJson(message.sticker),
      stringifyJson(message.quote),
      message.createdAt,
      null,
      null
    );
    return json(res, 201, { message });
  }

  return json(res, 404, { message: '接口不存在' });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url?.startsWith('/uploads/')) {
      await serveUpload(req, res);
      return;
    }
    if (req.url?.startsWith('/api/')) {
      await handleApi(req, res);
      return;
    }
    json(res, 404, { message: '仅提供 API 服务，请通过 Vite 打开前端' });
  } catch (error) {
    json(res, 500, { message: error.message || '服务器错误' });
  }
});

await openDb();
server.listen(port, () => {
  console.log(`API server listening on http://localhost:${port}`);
});
