import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const rootDir = path.join(__dirname, '..');
export const dataDir = path.join(rootDir, 'data');
export const sqlitePath = path.join(dataDir, 'app.sqlite');
export const uploadsDir = path.join(dataDir, 'uploads');
export const port = Number(process.env.PORT || 3101);
export const recallWindowMs = 8 * 60 * 1000;
export const maxImageDataUrlLength = 700_000;
export const bubbleThemes = new Set(['mint', 'pink', 'purple', 'sky', 'peach', 'lavender']);
export const adminUsername = 'admin';
export const initialAdminPassword = process.env.ADMIN_PASSWORD || 'admin123';
