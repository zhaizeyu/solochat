import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { after, before } from 'node:test';
import { Pool } from 'pg';

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

loadEnvFile(new URL('../.env', import.meta.url));

const baseDatabaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRESQL_URL;
const schemaName = `test_solochat_${process.pid}_${Date.now()}`;

export const hasDatabase = Boolean(baseDatabaseUrl);
export const state = {};

function databaseUrlForSchema(schema) {
  const url = new URL(baseDatabaseUrl);
  url.searchParams.set('options', `-c search_path=${schema}`);
  return url.toString();
}

function makeReq(method, body) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  req.method = method;
  req.headers = {};
  return req;
}

function makeRes() {
  return {
    statusCode: 0,
    headers: null,
    body: '',
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk = '') {
      this.body += chunk;
    }
  };
}

before(async () => {
  if (!hasDatabase) return;

  const setupPool = new Pool({ connectionString: baseDatabaseUrl });
  try {
    await setupPool.query(`CREATE SCHEMA ${schemaName}`);
  } finally {
    await setupPool.end();
  }

  process.env.DATABASE_URL = databaseUrlForSchema(schemaName);
  process.env.ADMIN_PASSWORD = 'admin123';
  process.env.USE_LOCAL = 'true';
  process.env.R2_PUBLIC_BASE_URL ||= 'https://uploads.test';
  process.env.R2_BUCKET ||= 'solochat-test';
  process.env.R2_ACCESS_KEY_ID ||= 'test-access-key';
  process.env.R2_SECRET_ACCESS_KEY ||= 'test-secret-key';
  process.env.S3_API_ENDPOINT ||= 'https://r2.test';

  const [
    dbModule,
    authModule,
    contactsModule,
    messagesModule,
    plannerModule,
    stickersModule,
    adminModule,
    utilsModule
  ] = await Promise.all([
    import('../server/db.js'),
    import('../server/routes/auth-users.js'),
    import('../server/routes/contacts.js'),
    import('../server/routes/messages.js'),
    import('../server/routes/planner.js'),
    import('../server/routes/stickers.js'),
    import('../server/routes/admin.js'),
    import('../server/utils.js')
  ]);

  Object.assign(state, {
    ...dbModule,
    ...authModule,
    ...contactsModule,
    ...messagesModule,
    ...plannerModule,
    ...stickersModule,
    ...adminModule,
    ...utilsModule
  });

  await state.openDb();
  state.adminUser = await state.findActiveUserByUsername('admin');
  assert.ok(state.adminUser?.isAdmin);
});

after(async () => {
  if (!hasDatabase) return;
  await state.closeDb?.();
  const teardownPool = new Pool({ connectionString: baseDatabaseUrl });
  try {
    await teardownPool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  } finally {
    await teardownPool.end();
  }
});

export async function call(handler, { method = 'GET', path, user, body, url = new URL(`http://localhost${path}`) }) {
  const req = makeReq(method, body);
  const res = makeRes();
  const handled = await handler(req, res, path, user, url);
  assert.equal(handled, true);
  return {
    status: res.statusCode,
    body: res.body ? JSON.parse(res.body) : null
  };
}

export async function register(username, options = {}) {
  const result = await call(state.handlePublicAuth, {
    method: 'POST',
    path: '/api/register',
    body: {
      username,
      displayName: options.displayName || username,
      password: options.password || 'secret1'
    }
  });
  assert.equal(result.status, 201);
  return state.findActiveUserByUsername(username.toLowerCase());
}

export async function login(username, password = 'secret1') {
  const result = await call(state.handlePublicAuth, {
    method: 'POST',
    path: '/api/login',
    body: { username, password }
  });
  assert.equal(result.status, 200);
  return result.body;
}

export async function addContact(user, username) {
  const result = await call(state.handleContacts, {
    method: 'POST',
    path: '/api/contacts',
    user,
    body: { username }
  });
  assert.equal(result.status, 201);
  return result.body.contact;
}

export async function deleteContact(user, contactId) {
  const result = await call(state.handleContacts, {
    method: 'DELETE',
    path: `/api/contacts/${encodeURIComponent(contactId)}`,
    user
  });
  assert.equal(result.status, 200);
  return result;
}

export async function sendMessage(user, toId, text, options = {}) {
  const result = await call(state.handleMessages, {
    method: 'POST',
    path: '/api/messages',
    user,
    body: { toId, text, ...options }
  });
  assert.equal(result.status, 201);
  return result.body.message;
}

export async function addPlannerTask(user, contactId, plan, options = {}) {
  const result = await call(state.handlePlanner, {
    method: 'POST',
    path: `/api/planner/${contactId}/tasks`,
    user,
    body: { plan, ...options }
  });
  assert.equal(result.status, 201);
  return result.body.task;
}

export async function count(sql, ...params) {
  const row = await state.getDb().prepare(sql).get(...params);
  return Number(row.count);
}
