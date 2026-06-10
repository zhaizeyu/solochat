import http from 'node:http';
import { port } from './config.js';
import { getAuthUser, openDb } from './db.js';
import { json } from './http-utils.js';
import { handleAdmin } from './routes/admin.js';
import { handleCurrentUser, handlePublicAuth } from './routes/auth-users.js';
import { handleContacts } from './routes/contacts.js';
import { handleMessages } from './routes/messages.js';
import { handlePlanner } from './routes/planner.js';
import { handleStickers } from './routes/stickers.js';
import { serveUpload } from './uploads.js';

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathName = url.pathname;

  if (await handlePublicAuth(req, res, pathName)) return;

  const user = getAuthUser(req);
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
  if (await handleMessages(req, res, pathName, user, url)) return;

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
