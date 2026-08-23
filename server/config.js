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
export const testMode = String(process.env.TEST_MODE || 'false').toLowerCase() === 'true';

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

const primaryDatabaseUrl = firstEnv(['DATABASE_URL', 'POSTGRES_URL', 'POSTGRESQL_URL']) || buildDatabaseUrlFromParts();
export const testDatabaseUrl = process.env.TEST_DATABASE_URL || '';
export const databaseUrl = testMode ? testDatabaseUrl : primaryDatabaseUrl;
export const r2Config = {
  accountId: process.env.R2_ACCOUNT_ID || '',
  bucket: process.env.R2_BUCKET || '',
  accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  endpoint: process.env.S3_API_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : ''),
  publicBaseUrl: process.env.R2_PUBLIC_BASE_URL || process.env.S3_API || ''
};
export const useLocalUploads = testMode || String(process.env.USE_LOCAL || 'false').toLowerCase() === 'true';
export const uploadToR2 = !testMode;
export const localUploadsDir = process.env.LOCAL_UPLOADS_DIR || path.join(rootDir, 'data', 'uploads');
export const localUploadsPublicPath = '/uploads';
export const tlsCertPath = process.env.TLS_CERT_PATH || path.join(rootDir, 'data', 'certs', 'cert.pem');
export const tlsKeyPath = process.env.TLS_KEY_PATH || path.join(rootDir, 'data', 'certs', 'key.pem');
// Independent of TEST_MODE: Coolify test/prod both terminate TLS at the proxy.
export const useHttps = String(process.env.USE_HTTPS || 'false').toLowerCase() === 'true';
export const recallWindowMs = 8 * 60 * 1000;
export const maxImageDataUrlLength = 4_300_000;
export const chatImageMaxBytes = 2 * 1024 * 1024;
export const chatImageMaxDataUrlLength = Math.ceil(chatImageMaxBytes * 4 / 3) + 128;
/** Temporary chat images are kept until the next day's daily cleanup. */
export const chatImageTtlMs = 24 * 60 * 60 * 1000;
/** Local hour (0-23) for the daily chat-image cleanup sweep. Default 4 = 04:00. */
export const chatImageCleanupHour = Math.min(
  23,
  Math.max(0, Number(process.env.CHAT_IMAGE_CLEANUP_HOUR ?? 4) || 4)
);
/** IANA timezone for the daily cleanup clock. Default Asia/Shanghai. */
export const chatImageCleanupTimeZone = process.env.CHAT_IMAGE_CLEANUP_TZ || 'Asia/Shanghai';
export const chatImageUploadHourlyLimit = 60;
export const bubbleThemes = new Set(['mint', 'pink', 'purple', 'sky', 'peach', 'lavender']);
export const chatBgPresets = new Set(['soft', 'paper', 'dusk', 'ocean', 'plain']);
export const adminUsername = 'admin';
export const initialAdminPassword = process.env.ADMIN_PASSWORD || 'admin123';

const dyeThemePattern = /^dye:#[0-9a-fA-F]{6}$/;

export function normalizeBubbleTheme(value, fallback = 'mint') {
  const theme = String(value || '').trim();
  if (bubbleThemes.has(theme)) return theme;
  if (dyeThemePattern.test(theme)) return `dye:${theme.slice(4).toLowerCase()}`;
  return fallback;
}

export function isValidBubbleTheme(value) {
  const theme = String(value || '').trim();
  return bubbleThemes.has(theme) || dyeThemePattern.test(theme);
}

export function normalizeChatBgPreset(value, fallback = 'soft') {
  const preset = String(value || '').trim();
  return chatBgPresets.has(preset) ? preset : fallback;
}

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
  const required = {
    [testMode ? 'TEST_DATABASE_URL' : 'DATABASE_URL']: databaseUrl
  };
  if (uploadToR2) {
    Object.assign(required, {
      R2_BUCKET: r2Config.bucket,
      R2_ACCESS_KEY_ID: r2Config.accessKeyId,
      R2_SECRET_ACCESS_KEY: r2Config.secretAccessKey,
      S3_API_ENDPOINT: r2Config.endpoint,
      R2_PUBLIC_BASE_URL: r2Config.publicBaseUrl
    });
  }
  const missing = Object.entries(required).filter(([, value]) => !value);
  if (missing.length) {
    throw new Error(`环境变量缺失: ${missing.map(([key]) => key).join(', ')}`);
  }
  validateDatabaseUrl(databaseUrl);
}
