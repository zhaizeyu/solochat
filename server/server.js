import http from 'node:http';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import next from 'next';
import { assertRuntimeConfig, host, port, rootDir } from './config.js';
import { getAuthUser, openDb } from './db.js';
import { json } from './http-utils.js';
import { handleAdmin } from './routes/admin.js';
import { handleCurrentUser, handlePublicAuth } from './routes/auth-users.js';
import { handleContacts } from './routes/contacts.js';
import { handleMessages } from './routes/messages.js';
import { handleMoments } from './routes/moments.js';
import { handlePlanner } from './routes/planner.js';
import { handleStickers } from './routes/stickers.js';
import { handleLocalUploadRequest, syncR2ImagesToLocal } from './uploads.js';

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handleNext = app.getRequestHandler();
const chunksDir = path.join(rootDir, '.next', 'static', 'chunks');

function getLatestCssChunk() {
  try {
    return readdirSync(chunksDir)
      .filter((fileName) => fileName.endsWith('.css'))
      .map((fileName) => {
        const filePath = path.join(chunksDir, fileName);
        return { filePath, mtimeMs: statSync(filePath).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath;
  } catch {
    return '';
  }
}

function handleCssChunkRequest(req, res, pathName) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (!pathName.startsWith('/_next/static/chunks/') || !pathName.endsWith('.css')) return false;

  const requestedPath = path.join(chunksDir, path.basename(pathName));
  const relativePath = path.relative(chunksDir, requestedPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return false;

  const cssPath = existsSync(requestedPath) ? requestedPath : getLatestCssChunk();
  if (!cssPath) return false;

  res.writeHead(200, {
    'content-type': 'text/css; charset=utf-8',
    'cache-control': existsSync(requestedPath) ? 'public, max-age=31536000, immutable' : 'no-store'
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  createReadStream(cssPath).pipe(res);
  return true;
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathName = url.pathname;

  if (await handlePublicAuth(req, res, pathName)) return;

  const user = await getAuthUser(req);
  if (!user) {
    return json(res, 401, { message: '请先登录' });
  }
  if (user.disabledAt) {
    return json(res, 401, { message: '账号已注销' });
  }

  if (await handleCurrentUser(req, res, pathName, user)) return;
  if (await handleAdmin(req, res, pathName, user)) return;
  if (await handleStickers(req, res, pathName, user)) return;
  if (await handleContacts(req, res, pathName, user)) return;
  if (await handlePlanner(req, res, pathName, user)) return;
  if (await handleMoments(req, res, pathName, user)) return;
  if (await handleMessages(req, res, pathName, user, url)) return;

  return json(res, 404, { message: '接口不存在' });
}

assertRuntimeConfig();
await openDb();
const localSync = await syncR2ImagesToLocal();
if (localSync.enabled) {
  console.log(`USE_LOCAL enabled: synced R2 images to local uploads (${localSync.downloaded} downloaded, ${localSync.skipped} skipped)`);
}
await app.prepare();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (handleCssChunkRequest(req, res, url.pathname)) {
      return;
    }
    if (handleLocalUploadRequest(req, res, url.pathname)) {
      return;
    }
    if (req.url?.startsWith('/api/')) {
      await handleApi(req, res);
      return;
    }
    await handleNext(req, res);
  } catch (error) {
    json(res, 500, { message: error.message || '服务器错误' });
  }
});

server.listen(port, host, () => {
  console.log(`Next.js app listening on http://${host}:${port}`);
});
