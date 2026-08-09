# doolulu 全功能浏览器测试手册

本文档描述如何用 Playwright 对 doolulu 做**可复用的端到端全功能测试**：双用户业务流 + 管理员操作 + 注销清理。

最近一次全流程跑通：`e2e/full-app.spec.js`（约 20s，视 Argon2 参数可能更长）。

## 前置条件

1. 应用已启动；本地安全聊天需 HTTPS（`USE_HTTPS=true` + 自签证书）  
   - 推荐：`TEST_MODE=true` + `USE_HTTPS=true` + `npm run app:start`  
   - 默认地址：`https://localhost:3101`
   - 改前端后需 `npm run build` + `bash scripts/restart.sh`（生产模式不热更新）
2. 本机已安装 Playwright Chromium：  
   `npx playwright install chromium`
3. 管理员账号可登录（默认用户名 `admin`，密码为 `ADMIN_PASSWORD` 或 `admin123`）
4. 使用**测试库**（`TEST_MODE=true` / `TEST_DATABASE_URL`），避免污染生产数据

## 一键运行

```bash
export E2E_BASE_URL=https://127.0.0.1:3101
export E2E_ADMIN_PASSWORD=admin123

npm run test:e2e
```

有界面调试：

```bash
npm run test:e2e:headed
```

查看报告：

```bash
npm run test:e2e:report
```

相关文件：

| 路径 | 作用 |
|------|------|
| `playwright.config.js` | 超时 15min、HTTPS 自签、单 worker |
| `e2e/helpers.js` | 可复用页面操作（注册/登录/联系人/安全对话框等） |
| `e2e/full-app.spec.js` | 全功能串行用例 |
| `e2e-report/` | HTML 报告（运行后生成） |

## 标准测试剧本（本仓库默认实现）

每次运行会生成两个随机用户名（`alice_*` / `bob_*`），避免冲突。

### A. 普通用户双端

1. **注册登录**：Alice、Bob 分别注册并进入主界面  
2. **联系人**：双方互相添加  
3. **明文聊天**：互发文字，确认对端可见（`.message-stream .message-bubble`，按钮文案「发送」）  
4. **待办**：Alice「+ 添加计划」创建；Bob `reloadAndOpenContact` 后打开待办可见  
5. **回忆**：Alice「发布」回忆；Bob 刷新会话后可见  
6. **安全聊天**  
   - Alice：安全面板 →「邀请对方开启」→ 登录密码 → 出现「取消邀请」  
   - Bob：刷新会话 →「同意开启」→ 登录密码  
   - Alice：刷新会话 →「完成开启」→ 登录密码 → 出现「申请关闭」（确认后本端内存已解锁）  
   - Bob：刷新后若见「输入密码继续」则解锁，否则已解锁；Alice 发密文，Bob 可见  
   - Alice「申请关闭」→ Bob「同意关闭」（勾选确认 checkbox）
7. **改密码**：Alice 改密成功后会话失效，用新密码重新登录

### B. 管理员

8. 管理员登录后台  
9. 按用户名筛选到 Alice（验证搜索）  
10. **再筛选到 Bob**，在卡片「新密码」输入框填值 →「重置密码」（confirm 自动接受）  
11. Bob 用新密码重新登录并打开会话

### C. 收尾清理（必须做完，避免测试垃圾账号堆积）

12. Alice、Bob 各自点「注销」  
13. 管理员筛选「已注销」，对两人执行「清理数据」  
14. 确认后台列表中两人已消失

## 编写 / 扩展用例时的经验（踩坑清单）

### 选择器

- 优先 `getByRole` / `getByPlaceholder` / `getByLabel`  
- 打开安全面板必须用 `getByRole('button', { name: '安全', exact: true })`  
  - `/^安全/` 会误匹配横幅「安全聊天已解锁 · 打开安全面板」  
- 桌面+移动双挂载：状态文案常有一份 hidden；断言优先用**可见操作按钮**（如「取消邀请」「申请关闭」），不要死等可能 hidden 的 `<p>当前状态：…</p>`  
- 待办/回忆列表用 `.planner-drawer[aria-label=…] .planner-mini-task` / `.moments-drawer .moment-card`，断言 `count > 0`  
- 自定义密码框：`role=dialog` + label（见 `fillSecureDialog`）  
- 管理员重置：卡片内 `getByPlaceholder('新密码')`，不是全局 `input[type=password]`  
- `alert` / `confirm`：开头 `acceptDialogs(page)` 自动接受

### 同步与刷新

- 待办 / 回忆 / 安全状态**没有可靠推送**；对端变更后应用 `reloadAndOpenContact`（`goto('/')` + 再点联系人）  
- 打开待办/回忆按钮时会重新拉取（产品侧已加）；安全材料约每 3s 轮询一次  
- `complete` 邀请后发起方内存已解锁；刷新页面后需再「输入密码继续」

### 安全聊天 / Argon2

- 单步超时建议 ≥ 60–180s；整用例 `timeout` 建议 15min  
- 必须 HTTPS + `ignoreHTTPSErrors: true`  
- 关闭时 checkbox 文案：`我知道需要保留当时的登录密码才能查看历史加密消息`

### 并发与隔离

- 三套 browser context：Alice / Bob / Admin  
- `workers: 1` + `serial`  
- 用户名时间戳随机化；**每次跑完必须注销 + 管理员清理**  
- 管理员筛选有状态：操作 Bob 前务必把搜索框改成 Bob 的用户名

### 失败排查

1. 终端 `[E2E]` 日志停在哪一步  
2. `test-results/**/test-failed-*.png` 截图  
3. 确认 `TEST_MODE` 与库连接  
4. 管理员登录失败：核对 `E2E_ADMIN_PASSWORD`  
5. 改了 `src/` 前端却行为不变：忘记 `npm run build` + `bash scripts/restart.sh`（生产模式无热更新）
6. 前端已按域拆分（`src/components/*`、`src/App.jsx`、`src/api/client.js`）；改功能时优先打开对应文件，避免再翻巨型单文件

## 最小冒烟（手工快速版）

1. 两用户注册 + 互加好友 + 互发一条明文  
2. 安全聊天邀请→同意→确认→解锁→发一条密文  
3. 管理员能搜到用户  
4. 两用户注销 + 管理员清理  

完整回归仍以 `npm run test:e2e` 为准。

## 后续可增强项（未强制）

- 表情包上传 / 引用 / 撤回  
- 待办双方确认与完成状态  
- 改密后「解锁历史 + 自动迁移」  
- 视觉回归截图对比  
- CI：启动应用 → 跑 e2e → 停应用
