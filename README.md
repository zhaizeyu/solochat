# doolulu

一个面向熟人之间使用的轻量私聊与双人计划应用。支持账号与联系人、文字和表情消息、引用与撤回、未读状态、共同计划，以及简单的管理员后台。

## 功能

- 注册、登录、个人资料与气泡主题
- 按用户名添加联系人并进行一对一私聊
- 发送文字和自定义图片表情，收藏对方发来的表情
- 引用消息、已读状态与 8 分钟内撤回
- 为每段会话创建共同计划，并由双方分别确认完成
- 可选安全聊天：端到端加密正文，密码解锁，邀请链接配对
- 响应式桌面端与移动端界面
- 管理员查看用户状态及清理用户数据
- PostgreSQL 持久化，Cloudflare R2 图片存储
- 可选将 R2 图片同步到本地目录，提高读取可用性

## 技术栈

- Next.js 16
- React 19
- Tailwind CSS 4
- shadcn/ui
- PostgreSQL
- Cloudflare R2（S3 兼容接口）
- Node.js 自定义 HTTP 服务

## 本地运行

### 1. 准备环境

建议使用 Node.js 22，并准备：

- 一个 PostgreSQL 数据库
- 一个 Cloudflare R2 存储桶及其访问凭据
- 指向该存储桶的公开访问域名

安装依赖：

```bash
npm install
```

### 2. 配置环境变量

复制示例配置：

```bash
cp .env.example .env
```

编辑 `.env`：

```env
DATABASE_URL=postgres://postgres:password@127.0.0.1:5432/solochat
TEST_MODE=false
TEST_DATABASE_URL=postgres://postgres:password@127.0.0.1:5433/postgres

R2_ACCOUNT_ID=your-cloudflare-account-id
R2_BUCKET=solochat
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
S3_API_ENDPOINT=https://your-cloudflare-account-id.r2.cloudflarestorage.com
R2_PUBLIC_BASE_URL=https://uploads.example.com

USE_LOCAL=false
ADMIN_PASSWORD=change-me
HOST=0.0.0.0
PORT=3101
```

数据库也可以使用 `PGHOST`、`PGPORT`、`PGUSER`、`PGPASSWORD` 和 `PGDATABASE` 分项配置。若同时提供，`DATABASE_URL` 优先。

> R2 配置目前是必填项（`TEST_MODE=true` 时除外）。`USE_LOCAL=true` 会将 R2 图片镜像到本地，而不是替代 R2；本地目录默认为 `data/uploads`，可通过 `LOCAL_UPLOADS_DIR` 修改。
> `TEST_MODE=true` 时会使用 `TEST_DATABASE_URL`，图片只保存到本地 `/uploads/...`，不会上传、同步或删除 R2 对象；并且默认启用 HTTPS（自签证书），因为安全聊天依赖浏览器安全上下文（`crypto.subtle`）。访问地址为 `https://主机:PORT`，需在浏览器中信任自签证书。

### 安全聊天（简版）

1. 双方已是联系人，且通过 **HTTPS** 打开站点。
2. 一方点「安全」→「开启」，设置密码；保存恢复密钥，并把邀请链接发给对方。
3. 对方打开邀请链接（或粘贴链接）→「加入并设密码」。
4. 之后各自用密码解锁即可收发加密消息；刷新页面需重新解锁。

服务器只保存封装密钥与密文，看不到明文。关闭安全聊天会使现有密码/恢复密钥失效；旧密文不会自动删除。

### 3. 启动应用

开发模式：

```bash
npm run dev
```

默认访问地址为 <http://localhost:3101>。首次启动时，应用会自动创建所需的数据表和管理员账号。

管理员登录信息：

- 用户名：`admin`
- 密码：`.env` 中的 `ADMIN_PASSWORD`

请勿在生产环境使用默认密码 `admin123`。

### 4. 运行测试

```bash
npm test
```

测试会读取当前环境或 `.env` 中的 PostgreSQL 连接配置，并在同一个数据库实例里创建独立的临时 schema。测试数据只写入该临时 schema，结束后会自动删除。

建议使用本地或测试数据库运行测试，不要使用生产数据库账号。

## 生产运行

构建并以前台进程启动：

```bash
npm run build
npm start
```

项目也提供了后台进程管理脚本：

```bash
npm run app:start
npm run app:status
npm run app:restart
npm run app:stop
```

后台运行日志写入 `logs/app.log`。

## Docker 部署

构建镜像：

```bash
docker build -t solochat .
```

使用 `.env` 启动：

```bash
docker run --rm --env-file .env \
  -e HOST=0.0.0.0 -e PORT=3000 \
  -p 3000:3000 solochat
```

如果 `.env` 中的 PostgreSQL 地址是 `127.0.0.1`，它在容器内指向容器自身。请改用容器可访问的数据库主机名，或在 Linux 上使用 host 网络：

```bash
docker run --rm --network host --env-file .env \
  -e HOST=0.0.0.0 -e PORT=3000 solochat
```

Coolify 部署说明见 [DEPLOY.md](./DEPLOY.md)。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动开发服务 |
| `npm test` | 运行后端核心回归测试 |
| `npm run build` | 构建生产版本 |
| `npm start` | 启动生产服务 |
| `npm run server` | 直接启动自定义服务 |
| `npm run app:start` | 构建并在后台启动 |
| `npm run app:status` | 查看后台进程状态 |
| `npm run app:restart` | 重启后台进程 |
| `npm run app:stop` | 停止后台进程 |

## 项目结构

```text
app/                 Next.js App Router 入口
components/ui/       基础 UI 组件
server/              HTTP 服务、数据库与 API 路由
server/routes/       认证、联系人、消息、计划等接口
src/App.jsx            应用壳（会话、安全聊天状态机）
src/components/        UI 面板（Auth / Chat / Admin / Planner / Moments / Secure…）
src/api/client.js      前端 API 客户端
src/lib/               共享 UI 与媒体工具
src/secure-crypto.js   端到端加密
src/styles.css         全局样式
src/main.jsx           入口 re-export → App.jsx
scripts/             开发及进程管理脚本
test/                Node.js 测试用例
test-support/        测试数据库隔离与请求 helper
public/              静态资源
Dockerfile           生产镜像配置
DEPLOY.md            Coolify 与 Docker 部署补充说明
```

## 数据与安全

- 账号、会话、联系人、消息、表情和计划数据保存在 PostgreSQL 中。
- 头像和表情图片保存在 R2；启用 `USE_LOCAL` 时会额外保留本地副本。启用 `TEST_MODE` 时图片只保存在本地。
- `.env`、数据库文件、上传文件和日志不应提交到版本库。
- 生产部署前请设置高强度 `ADMIN_PASSWORD`，并妥善保护数据库与 R2 凭据。
