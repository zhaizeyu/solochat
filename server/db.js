import { Pool } from 'pg';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { adminUsername, bubbleThemes, databaseUrl, initialAdminPassword } from './config.js';
import { storedImageUrlForClient } from './uploads.js';
import { conversationKey, hashPassword, parseJson } from './utils.js';

let pool;
const transactionStorage = new AsyncLocalStorage();

function sqlParams(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

async function query(sql, params = []) {
  const client = transactionStorage.getStore() || pool;
  return client.query(sqlParams(sql), params);
}

export function getDb() {
  return {
    prepare(sql) {
      return {
        async all(...params) {
          const result = await query(sql, params);
          return result.rows;
        },
        async get(...params) {
          const result = await query(sql, params);
          return result.rows[0] || null;
        },
        async run(...params) {
          const result = await query(sql, params);
          return { changes: result.rowCount };
        }
      };
    },
    async exec(sql) {
      return query(sql);
    }
  };
}

export function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    passwordHash: row.passwordHash,
    avatarDataUrl: row.avatarPath || '',
    avatarPath: row.avatarPath || null,
    bubbleTheme: row.bubbleTheme || 'mint',
    bio: row.bio || '',
    createdAt: row.createdAt,
    disabledAt: row.disabledAt || null,
    deletedUsername: row.deletedUsername || null,
    isAdmin: Boolean(row.isAdmin)
  };
}

export function rowToSticker(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    imageDataUrl: row.imagePath || '',
    imagePath: row.imagePath || null,
    createdAt: row.createdAt
  };
}

export function rowToMessage(row) {
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

export function rowToPlannerTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversationId,
    createdBy: row.createdBy,
    time: row.timeText || '',
    place: row.placeText || '',
    plan: row.planText || '',
    done: Boolean(row.doneAt),
    doneAt: row.doneAt || null,
    confirmedByA: Boolean(row.selfConfirmedAt),
    confirmedByB: Boolean(row.contactConfirmedAt),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function userSelect(prefix = '') {
  return `
    ${prefix}id AS id,
    ${prefix}username AS username,
    ${prefix}display_name AS "displayName",
    ${prefix}password_hash AS "passwordHash",
    ${prefix}avatar_path AS "avatarPath",
    ${prefix}bubble_theme AS "bubbleTheme",
    ${prefix}bio AS bio,
    ${prefix}created_at AS "createdAt",
    ${prefix}disabled_at AS "disabledAt",
    ${prefix}deleted_username AS "deletedUsername",
    ${prefix}is_admin AS "isAdmin"
  `;
}

export function stickerSelect(prefix = '') {
  return `
    ${prefix}id AS id,
    ${prefix}owner_id AS "ownerId",
    ${prefix}name AS name,
    ${prefix}image_path AS "imagePath",
    ${prefix}created_at AS "createdAt"
  `;
}

export function messageSelect(prefix = '') {
  return `
    ${prefix}id AS id,
    ${prefix}conversation_id AS "conversationId",
    ${prefix}from_id AS "fromId",
    ${prefix}to_id AS "toId",
    ${prefix}kind AS kind,
    ${prefix}text AS text,
    ${prefix}sticker_json AS "stickerJson",
    ${prefix}quote_json AS "quoteJson",
    ${prefix}created_at AS "createdAt",
    ${prefix}read_at AS "readAt",
    ${prefix}recalled_at AS "recalledAt"
  `;
}

export function plannerTaskSelect(prefix = '') {
  return `
    ${prefix}id AS id,
    ${prefix}conversation_id AS "conversationId",
    ${prefix}created_by AS "createdBy",
    ${prefix}time_text AS "timeText",
    ${prefix}place_text AS "placeText",
    ${prefix}plan_text AS "planText",
    ${prefix}done_at AS "doneAt",
    ${prefix}created_at AS "createdAt",
    ${prefix}updated_at AS "updatedAt"
  `;
}

export function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarDataUrl: storedImageUrlForClient(user.avatarDataUrl || ''),
    bubbleTheme: bubbleThemes.has(user.bubbleTheme) ? user.bubbleTheme : 'mint',
    bio: user.bio || '',
    createdAt: user.createdAt,
    disabledAt: user.disabledAt || null,
    isAdmin: Boolean(user.isAdmin)
  };
}

export function sanitizeSticker(sticker) {
  return {
    id: sticker.id,
    ownerId: sticker.ownerId,
    name: sticker.name,
    imageDataUrl: storedImageUrlForClient(sticker.imageDataUrl),
    createdAt: sticker.createdAt
  };
}

function stickerForClient(sticker) {
  if (!sticker) return null;
  return {
    ...sticker,
    imageDataUrl: storedImageUrlForClient(sticker.imageDataUrl || '')
  };
}

function quoteForClient(quote) {
  if (!quote) return null;
  return {
    ...quote,
    sticker: stickerForClient(quote.sticker)
  };
}

export function messageForClient(message) {
  if (!message) return null;
  return {
    ...message,
    sticker: stickerForClient(message.sticker),
    quote: quoteForClient(message.quote)
  };
}

export async function execTransaction(callback) {
  const client = await pool.connect();
  try {
    return await transactionStorage.run(client, async () => {
      await client.query('BEGIN');
      try {
        const result = await callback();
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  } catch (error) {
    throw error;
  } finally {
    client.release();
  }
}

async function createSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_path TEXT,
      bubble_theme TEXT,
      bio TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      disabled_at TEXT,
      deleted_username TEXT,
      is_admin BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_active_username
      ON users(username)
      WHERE disabled_at IS NULL;

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user
      ON sessions(user_id);

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

    CREATE TABLE IF NOT EXISTS planner_tasks (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      time_text TEXT NOT NULL DEFAULT '',
      place_text TEXT NOT NULL DEFAULT '',
      plan_text TEXT NOT NULL DEFAULT '',
      done_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_planner_tasks_conversation_updated
      ON planner_tasks(conversation_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS planner_confirmations (
      task_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      confirmed_at TEXT NOT NULL,
      PRIMARY KEY (task_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_planner_confirmations_user
      ON planner_confirmations(user_id);
  `);
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT \'\'');
}

export function releaseDeletedUsername(user) {
  if (String(user.username || '').startsWith('deleted:')) return false;
  user.deletedUsername ||= user.username;
  user.username = `deleted:${user.id}:${user.deletedUsername}`;
  return true;
}

async function ensureAdminUser() {
  const admin = rowToUser(await getDb().prepare(`SELECT ${userSelect()} FROM users WHERE username = ?`).get(adminUsername));
  if (admin) {
    if (!admin.isAdmin) {
      await getDb().prepare('UPDATE users SET is_admin = TRUE WHERE id = ?').run(admin.id);
    }
    return;
  }
  await getDb().prepare(`
    INSERT INTO users (
      id, username, display_name, password_hash, avatar_path, bubble_theme,
      bio, created_at, disabled_at, deleted_username, is_admin
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    adminUsername,
    '管理员',
    hashPassword(initialAdminPassword),
    null,
    'mint',
    '',
    new Date().toISOString(),
    null,
    null,
    true
  );
}

async function releaseDeletedUsernames() {
  const users = (await getDb().prepare(`SELECT ${userSelect()} FROM users WHERE disabled_at IS NOT NULL`).all()).map(rowToUser);
  await execTransaction(async () => {
    const update = getDb().prepare('UPDATE users SET username = ?, deleted_username = ? WHERE id = ?');
    for (const user of users) {
      if (releaseDeletedUsername(user)) {
        await update.run(user.username, user.deletedUsername, user.id);
      }
    }
  });
}

export async function openDb() {
  pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  try {
    await createSchema();
  } catch (error) {
    await pool.end().catch(() => {});
    pool = null;
    const url = new URL(databaseUrl);
    throw new Error(`数据库连接失败: ${url.hostname}:${url.port || '5432'} - ${error.message}`);
  }

  await releaseDeletedUsernames();
  await ensureAdminUser();
}

export async function closeDb() {
  await pool?.end();
}

export async function getUserById(id) {
  return rowToUser(await getDb().prepare(`SELECT ${userSelect()} FROM users WHERE id = ?`).get(id));
}

export async function findActiveUserByUsername(username) {
  return rowToUser(
    await getDb().prepare(`SELECT ${userSelect()} FROM users WHERE username = ? AND disabled_at IS NULL`).get(username)
  );
}

export async function getAuthUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const session = await getDb().prepare('SELECT user_id AS "userId" FROM sessions WHERE token = ?').get(token);
  return session ? getUserById(session.userId) : null;
}

export async function sanitizeAdminUser(user) {
  const counts = await getDb().prepare(`
    SELECT
      (SELECT COUNT(*)::int FROM messages WHERE from_id = ? OR to_id = ?) AS "messageCount",
      (SELECT COUNT(*)::int FROM contacts WHERE owner_id = ? OR contact_id = ?) AS "contactCount",
      (SELECT COUNT(*)::int FROM stickers WHERE owner_id = ?) AS "stickerCount",
      (SELECT MAX(created_at) FROM sessions WHERE user_id = ?) AS "lastLoginAt"
  `).get(user.id, user.id, user.id, user.id, user.id, user.id);
  return {
    ...sanitizeUser(user),
    avatarDataUrl: '',
    deletedUsername: user.deletedUsername || null,
    messageCount: counts.messageCount,
    contactCount: counts.contactCount,
    stickerCount: counts.stickerCount,
    lastLoginAt: counts.lastLoginAt || null
  };
}

export async function areContacts(userId, contactId) {
  const row = await getDb()
    .prepare(
      `SELECT 1 FROM contacts
       WHERE (owner_id = ? AND contact_id = ?) OR (owner_id = ? AND contact_id = ?)
       LIMIT 1`
    )
    .get(userId, contactId, contactId, userId);
  return Boolean(row);
}

export async function getStickerByIdForOwner(stickerId, ownerId) {
  return rowToSticker(
    await getDb().prepare(`SELECT ${stickerSelect()} FROM stickers WHERE id = ? AND owner_id = ?`).get(stickerId, ownerId)
  );
}

export async function getMessageById(messageId) {
  return rowToMessage(await getDb().prepare(`SELECT ${messageSelect()} FROM messages WHERE id = ?`).get(messageId));
}

export async function getPlannerTaskById(taskId) {
  return getDb().prepare(`SELECT ${plannerTaskSelect()} FROM planner_tasks WHERE id = ?`).get(taskId);
}

export async function getPlannerTaskForUser(taskId, user) {
  const task = await getPlannerTaskById(taskId);
  if (!task) return null;
  const participantIds = String(task.conversationId || '').split(':');
  const contactId = participantIds.find((id) => id && id !== user.id);
  const target = contactId ? await getUserById(contactId) : null;
  if (!target || target.disabledAt || !(await areContacts(user.id, target.id))) return null;
  return { task, target };
}

export async function getPlannerTasks(conversationId, selfId, contactId) {
  const rows = await getDb().prepare(`
    SELECT
      ${plannerTaskSelect('t.')},
      self_confirmed.confirmed_at AS "selfConfirmedAt",
      contact_confirmed.confirmed_at AS "contactConfirmedAt"
    FROM planner_tasks t
    LEFT JOIN planner_confirmations self_confirmed
      ON self_confirmed.task_id = t.id AND self_confirmed.user_id = ?
    LEFT JOIN planner_confirmations contact_confirmed
      ON contact_confirmed.task_id = t.id AND contact_confirmed.user_id = ?
    WHERE t.conversation_id = ?
    ORDER BY t.updated_at DESC, t.created_at DESC
  `).all(selfId, contactId, conversationId);
  return rows.map(rowToPlannerTask);
}

export async function getPlannerTaskResponse(taskId, selfId, contactId) {
  const conversationId = conversationKey(selfId, contactId);
  return rowToPlannerTask(await getDb().prepare(`
    SELECT
      ${plannerTaskSelect('t.')},
      self_confirmed.confirmed_at AS "selfConfirmedAt",
      contact_confirmed.confirmed_at AS "contactConfirmedAt"
    FROM planner_tasks t
    LEFT JOIN planner_confirmations self_confirmed
      ON self_confirmed.task_id = t.id AND self_confirmed.user_id = ?
    LEFT JOIN planner_confirmations contact_confirmed
      ON contact_confirmed.task_id = t.id AND contact_confirmed.user_id = ?
    WHERE t.id = ? AND t.conversation_id = ?
  `).get(selfId, contactId, taskId, conversationId));
}
