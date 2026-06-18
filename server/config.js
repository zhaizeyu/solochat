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
export const databaseUrl = process.env.DATABASE_URL || '';
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
}
