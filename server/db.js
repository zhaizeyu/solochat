import { mkdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { adminUsername, dataDir, initialAdminPassword, sqlitePath, bubbleThemes } from './config.js';
import { conversationKey, hashPassword, parseJson } from './utils.js';

let db;

export function getDb() {
  return db;
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
    ${prefix}display_name AS displayName,
    ${prefix}password_hash AS passwordHash,
    ${prefix}avatar_path AS avatarPath,
    ${prefix}bubble_theme AS bubbleTheme,
    ${prefix}created_at AS createdAt,
    ${prefix}disabled_at AS disabledAt,
    ${prefix}deleted_username AS deletedUsername,
    ${prefix}is_admin AS isAdmin
  `;
}

export function stickerSelect(prefix = '') {
  return `
    ${prefix}id AS id,
    ${prefix}owner_id AS ownerId,
    ${prefix}name AS name,
    ${prefix}image_path AS imagePath,
    ${prefix}created_at AS createdAt
  `;
}

export function messageSelect(prefix = '') {
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

export function plannerTaskSelect(prefix = '') {
  return `
    ${prefix}id AS id,
    ${prefix}conversation_id AS conversationId,
    ${prefix}created_by AS createdBy,
    ${prefix}time_text AS timeText,
    ${prefix}place_text AS placeText,
    ${prefix}plan_text AS planText,
    ${prefix}done_at AS doneAt,
    ${prefix}created_at AS createdAt,
    ${prefix}updated_at AS updatedAt
  `;
}

export function sanitizeUser(user) {
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

export function sanitizeSticker(sticker) {
  return {
    id: sticker.id,
    ownerId: sticker.ownerId,
    name: sticker.name,
    imageDataUrl: sticker.imageDataUrl,
    createdAt: sticker.createdAt
  };
}

export function execTransaction(callback) {
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
}

export function releaseDeletedUsername(user) {
  if (String(user.username || '').startsWith('deleted:')) return false;
  user.deletedUsername ||= user.username;
  user.username = `deleted:${user.id}:${user.deletedUsername}`;
  return true;
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
      id, username, display_name, password_hash, avatar_path, bubble_theme,
      created_at, disabled_at, deleted_username, is_admin
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    adminUsername,
    '管理员',
    hashPassword(initialAdminPassword),
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

export async function openDb() {
  await mkdir(dataDir, { recursive: true });
  db = new DatabaseSync(sqlitePath);
  createSchema();

  releaseDeletedUsernames();
  ensureAdminUser();
}

export function getUserById(id) {
  return rowToUser(db.prepare(`SELECT ${userSelect()} FROM users WHERE id = ?`).get(id));
}

export function findActiveUserByUsername(username) {
  return rowToUser(
    db.prepare(`SELECT ${userSelect()} FROM users WHERE username = ? AND disabled_at IS NULL`).get(username)
  );
}

export function getAuthUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const session = db.prepare('SELECT user_id AS userId FROM sessions WHERE token = ?').get(token);
  return session ? getUserById(session.userId) : null;
}

export function sanitizeAdminUser(user) {
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

export function areContacts(userId, contactId) {
  const row = db
    .prepare(
      `SELECT 1 FROM contacts
       WHERE (owner_id = ? AND contact_id = ?) OR (owner_id = ? AND contact_id = ?)
       LIMIT 1`
    )
    .get(userId, contactId, contactId, userId);
  return Boolean(row);
}

export function getStickerByIdForOwner(stickerId, ownerId) {
  return rowToSticker(
    db.prepare(`SELECT ${stickerSelect()} FROM stickers WHERE id = ? AND owner_id = ?`).get(stickerId, ownerId)
  );
}

export function getMessageById(messageId) {
  return rowToMessage(db.prepare(`SELECT ${messageSelect()} FROM messages WHERE id = ?`).get(messageId));
}

export function getPlannerTaskById(taskId) {
  return db.prepare(`SELECT ${plannerTaskSelect()} FROM planner_tasks WHERE id = ?`).get(taskId);
}

export function getPlannerTaskForUser(taskId, user) {
  const task = getPlannerTaskById(taskId);
  if (!task) return null;
  const participantIds = String(task.conversationId || '').split(':');
  const contactId = participantIds.find((id) => id && id !== user.id);
  const target = contactId ? getUserById(contactId) : null;
  if (!target || target.disabledAt || !areContacts(user.id, target.id)) return null;
  return { task, target };
}

export function getPlannerTasks(conversationId, selfId, contactId) {
  return db.prepare(`
    SELECT
      ${plannerTaskSelect('t.')},
      self_confirmed.confirmed_at AS selfConfirmedAt,
      contact_confirmed.confirmed_at AS contactConfirmedAt
    FROM planner_tasks t
    LEFT JOIN planner_confirmations self_confirmed
      ON self_confirmed.task_id = t.id AND self_confirmed.user_id = ?
    LEFT JOIN planner_confirmations contact_confirmed
      ON contact_confirmed.task_id = t.id AND contact_confirmed.user_id = ?
    WHERE t.conversation_id = ?
    ORDER BY t.updated_at DESC, t.created_at DESC
  `).all(selfId, contactId, conversationId).map(rowToPlannerTask);
}

export function getPlannerTaskResponse(taskId, selfId, contactId) {
  const conversationId = conversationKey(selfId, contactId);
  return rowToPlannerTask(db.prepare(`
    SELECT
      ${plannerTaskSelect('t.')},
      self_confirmed.confirmed_at AS selfConfirmedAt,
      contact_confirmed.confirmed_at AS contactConfirmedAt
    FROM planner_tasks t
    LEFT JOIN planner_confirmations self_confirmed
      ON self_confirmed.task_id = t.id AND self_confirmed.user_id = ?
    LEFT JOIN planner_confirmations contact_confirmed
      ON contact_confirmed.task_id = t.id AND contact_confirmed.user_id = ?
    WHERE t.id = ? AND t.conversation_id = ?
  `).get(selfId, contactId, taskId, conversationId));
}
