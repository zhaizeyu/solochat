# Deployment

## Coolify with Dockerfile

Use the Dockerfile build pack and keep the Dockerfile path as `Dockerfile` at the repository root.

Required environment variables:

```env
DATABASE_URL=postgres://user:password@host:5432/solochat
TEST_MODE=false
TEST_DATABASE_URL=postgres://user:password@host:5433/postgres
R2_BUCKET=solochat
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
S3_API_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
R2_PUBLIC_BASE_URL=https://uploads.example.com
USE_LOCAL=false
USE_HTTPS=false
HOST=0.0.0.0
PORT=3000
```

### HTTPS / 安全聊天（重要）

`TEST_MODE` **只**切换测试库 / 本地上传，**不**控制 HTTPS。应用层 HTTPS 仅由 `USE_HTTPS` 决定（默认 `false`）。

Coolify（测试或生产）在入口终止 TLS，**容器内应使用 HTTP**：

- 设置 `USE_HTTPS=false`（或不设置）
- Coolify 测试环境可以 `TEST_MODE=true`，同时保持 `USE_HTTPS=false`
- 浏览器仍通过 Coolify 的 `https://你的域名` 访问，WebCrypto / 安全聊天可正常工作

本地直接跑进程、需要安全聊天时：`.env` 里设 `USE_HTTPS=true`，并准备自签证书（`scripts/ensure-certs.sh` / `npm run app:start` 会自动生成）。

若错误日志出现证书相关警告：检查是否误开了 `USE_HTTPS=true` 却没有挂载证书。缺少证书时会回退为 HTTP 并打警告，不再直接崩溃。

Coolify can still render templates such as `{{ team.DATABASE_URL }}` before the container starts. The app only reads the final environment variable values.

Set `USE_LOCAL=true` to mirror R2 images into local storage on startup and serve client image URLs from `/uploads/...` when the local file exists. New uploads are also written to local storage before being uploaded to R2. The local directory defaults to `data/uploads`; set `LOCAL_UPLOADS_DIR` if you need a different mounted persistent volume.

Set `TEST_MODE=true` to use `TEST_DATABASE_URL` instead of `DATABASE_URL`. In test mode, uploads are stored only under the local uploads directory and the app does not upload, sync, list, or delete R2 objects.

## Local Docker

Build the image:

```sh
docker build -t solochat .
```

Run with a local `.env` file:

```sh
docker run --rm --env-file .env -e HOST=0.0.0.0 -e PORT=3000 -p 3000:3000 solochat
```

If your local `.env` uses `DATABASE_URL=...@127.0.0.1:5432/...`, the database address points inside the container. On Linux, either run with host networking:

```sh
docker run --rm --network host --env-file .env -e HOST=0.0.0.0 -e PORT=3000 solochat
```

or change the local container env to use a host-reachable database name, such as `host.docker.internal` with Docker's host-gateway mapping.
