import http from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import next from 'next';
import { assertRuntimeConfig, host, port, rootDir } from './config.js';
import { getAuthUser, getDb, openDb } from './db.js';
import { json } from './http-utils.js';
import { handleAdmin } from './routes/admin.js';
import { handleCurrentUser, handlePublicAuth } from './routes/auth-users.js';
import { handleContacts } from './routes/contacts.js';
import { handleMessages } from './routes/messages.js';
import { handleMoments } from './routes/moments.js';
import { handlePlanner } from './routes/planner.js';
import { handleSecureConversations } from './routes/secure-conversations.js';
import { handleStickers } from './routes/stickers.js';
import { handleLocalUploadRequest, syncR2ImagesToLocal, cleanupOrphanedMomentImages } from './uploads.js';

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handleNext = app.getRequestHandler();
const chunksDir = path.join(rootDir, '.next', 'static', 'chunks');
const chunkContentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.mjs', 'application/javascript; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.map', 'application/json; charset=utf-8']
]);

function handleStaticChunkRequest(req, res, pathName) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (!pathName.startsWith('/_next/static/chunks/')) return false;

  const requestedPath = path.join(chunksDir, path.basename(pathName));
  const relativePath = path.relative(chunksDir, requestedPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return false;

  const extension = path.extname(requestedPath);
  const contentType = chunkContentTypes.get(extension);
  if (!contentType) return false;

  if (!existsSync(requestedPath)) {
    res.writeHead(404, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store'
    });
    res.end('Chunk not found. Reload the page to fetch the latest build.');
    return true;
  }

  res.writeHead(200, {
    'content-type': contentType,
    'cache-control': 'public, max-age=31536000, immutable'
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  createReadStream(requestedPath).pipe(res);
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
  if (await handleSecureConversations(req, res, pathName, user, url)) return;
  if (await handleMessages(req, res, pathName, user, url)) return;

  return json(res, 404, { message: '接口不存在' });
}

assertRuntimeConfig();
await openDb();
const localSync = await syncR2ImagesToLocal();
if (localSync.enabled) {
  console.log(`USE_LOCAL enabled: synced R2 images to local uploads (${localSync.downloaded} downloaded, ${localSync.skipped} skipped)`);
}
const orphanCleanup = await cleanupOrphanedMomentImages(getDb());
if (orphanCleanup.orphaned.length) {
  console.log(
    `Cleaned orphaned moment images: ${orphanCleanup.deletedR2.length} from R2, ${orphanCleanup.deletedLocal.length} from local (${orphanCleanup.orphaned.length} found)`
  );
} else {
  console.log('No orphaned moment images found');
}
await app.prepare();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (handleStaticChunkRequest(req, res, url.pathname)) {
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
