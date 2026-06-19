import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const rootDir = path.join(__dirname, '..');

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

loadEnvFile(path.join(rootDir, '.env'));

export const port = Number(process.env.PORT || 3101);
export const host = process.env.HOST || '0.0.0.0';

function firstEnv(keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return '';
}

function buildDatabaseUrlFromParts() {
  const dbHost = firstEnv(['PGHOST', 'POSTGRES_HOST', 'POSTGRES_HOSTNAME', 'DATABASE_HOST', 'DB_HOST']);
  const dbName = firstEnv(['PGDATABASE', 'POSTGRES_DB', 'POSTGRES_DATABASE', 'DATABASE_NAME', 'DB_NAME']);
  const dbUser = firstEnv(['PGUSER', 'POSTGRES_USER', 'DATABASE_USER', 'DB_USER']);
  const dbPassword = firstEnv(['PGPASSWORD', 'POSTGRES_PASSWORD', 'DATABASE_PASSWORD', 'DB_PASSWORD']);
  if (!dbHost || !dbName || !dbUser) return '';

  const dbPort = firstEnv(['PGPORT', 'POSTGRES_PORT', 'DATABASE_PORT', 'DB_PORT']) || '5432';
  const url = new URL('postgres://localhost');
  url.hostname = dbHost;
  url.port = dbPort;
  url.username = dbUser;
  url.password = dbPassword;
  url.pathname = `/${dbName}`;
  return url.toString();
}

export const databaseUrl = firstEnv(['DATABASE_URL', 'POSTGRES_URL', 'POSTGRESQL_URL']) || buildDatabaseUrlFromParts();
export const r2Config = {
  accountId: process.env.R2_ACCOUNT_ID || '',
  bucket: process.env.R2_BUCKET || '',
  accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  endpoint: process.env.S3_API_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : ''),
  publicBaseUrl: process.env.R2_PUBLIC_BASE_URL || process.env.S3_API || ''
};
export const recallWindowMs = 8 * 60 * 1000;
export const maxImageDataUrlLength = 700_000;
export const bubbleThemes = new Set(['mint', 'pink', 'purple', 'sky', 'peach', 'lavender']);
export const adminUsername = 'admin';
export const initialAdminPassword = process.env.ADMIN_PASSWORD || 'admin123';

function validateDatabaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL 格式无效，请使用 postgres://user:password@host:port/database');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL 协议无效，请使用 postgres:// 或 postgresql://');
  }

  if (!url.hostname || url.pathname === '/' || !url.pathname) {
    throw new Error('DATABASE_URL 缺少数据库 host 或 database 名称');
  }

  const dbName = url.pathname.slice(1);
  if (!dbName || dbName.includes('/')) {
    throw new Error('DATABASE_URL 的 database 名称无效，请使用 postgres://user:password@host:port/database');
  }
}

export function assertRuntimeConfig() {
  const missing = Object.entries({
    DATABASE_URL: databaseUrl,
    R2_BUCKET: r2Config.bucket,
    R2_ACCESS_KEY_ID: r2Config.accessKeyId,
    R2_SECRET_ACCESS_KEY: r2Config.secretAccessKey,
    S3_API_ENDPOINT: r2Config.endpoint,
    R2_PUBLIC_BASE_URL: r2Config.publicBaseUrl
  }).filter(([, value]) => !value);
  if (missing.length) {
    throw new Error(`环境变量缺失: ${missing.map(([key]) => key).join(', ')}`);
  }
  validateDatabaseUrl(databaseUrl);
}
