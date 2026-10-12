# 江湖晚报

江湖晚报（jianghu-wanbao）用卡片记录事件：微信小程序给读者看已发布内容，管理端维护卡片，后端提供 API。

## 技术栈

- `backend/`：Express + TypeScript + MySQL（mysql2）。`npm test` 用内存仓库，不连数据库；`migrate`、`test:mysql` 和 `dev` 需要 MySQL 8。
- `admin/`：Vite + React + TypeScript 管理端占位。
- `miniprogram/`：微信原生小程序 + TypeScript，不使用 Taro。CI 不编译小程序。

## 环境变量

不要把真实密钥写进仓库。生产口令只放在运行环境里。本地示例见 [backend/.env.example](backend/.env.example) 和 [backend/README.md](backend/README.md)。

- `DATABASE_URL`：MySQL 连接串。本地和 CI job `backend-mysql` 使用同一条占位地址：`mysql://jianghu:jianghu@127.0.0.1:3306/jianghu_wanbao`。用户、口令、库名是 `jianghu` / `jianghu` / `jianghu_wanbao`，与 MySQL 服务的 `MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE` 一致。CI 把容器 `3306` 映射到宿主机，所以主机名是 `127.0.0.1`，不是服务名 `mysql`（服务名只在 job 自己也跑在容器里时才能解析）。
- `ADMIN_TOKEN`：管理端令牌，请求头 `X-Admin-Token` 必须与它一致。本地自行填写，不要提交。CI 的 `backend-mysql` 使用占位值 `ci-admin-token`。
- `COOKIE_ENCRYPTION_KEY`：写入并保存加密贴吧 Cookie 时必填。本地和开发环境必须自己设置，不要把真实密钥提交进仓库。CI 的 `backend` 与 `backend-mysql` 使用占位值 `ci-cookie-encryption-key-not-for-prod`，只给测试用，不是生产密钥，也不写入 GitHub Actions secrets。
- `TIEBA_COOKIE_STORE`：可选，加密 Cookie 文件的路径。不设置时走后端默认路径。仓库忽略 `*.enc`、`data/tieba-cookie*` 和 `backend/data/tieba-cookie*`，不要把 Cookie 文件提交进来。

`backend` job 不设置 `DATABASE_URL` 和 `ADMIN_TOKEN`。内存单测必须在没有 MySQL 的情况下通过。该 job 只带测试用的 `COOKIE_ENCRYPTION_KEY` 占位，不访问贴吧。

## 本地运行

### 后端

内存单测，对应 CI 的 `backend` job：

```bash
cd backend
npm ci
npm run lint
npm run test
npm run build
```

没有 `DATABASE_URL` 时，`npm test` 会跳过 MySQL 集成测。

连库步骤对应 CI 的 `backend-mysql` job。先按 [backend/README.md](backend/README.md) 准备 MySQL 8 和 `.env`，再执行：

```bash
npm run migrate
npm run test:mysql
npm run dev
```

`npm run test:mysql` 就是集成测入口。脚本名以 `backend/package.json` 为准。

### 管理端

对应 CI 的 `admin` job（`dev` 只在本机开服务）：

```bash
cd admin
npm ci
npm run lint
npm run build
npm run dev
```

## CI

工作流：`.github/workflows/ci.yml`。Node.js 22。

触发：

- 任意 Pull Request
- 推送到分支 `feat/mvp`

Jobs：

| Job | 目录 | 步骤 |
| --- | --- | --- |
| `backend` | `backend/` | `npm ci` → `npm run lint` → `npm run test` → `npm run build`（内存单测，无 MySQL；环境变量含测试用 `COOKIE_ENCRYPTION_KEY` 占位） |
| `admin` | `admin/` | `npm ci` → `npm run lint` → `npm run build` |
| `backend-mysql` | `backend/` | 启动 `mysql:8`，设置 `DATABASE_URL`、`ADMIN_TOKEN` 与测试用 `COOKIE_ENCRYPTION_KEY`，然后 `npm ci` → `npm run migrate` → `npm run test:mysql` |

`miniprogram/` 使用微信开发者工具本地编译，不进入 CI，也不部署。

本地对应命令见上一节。不要删掉 `backend-mysql`，也不要把它改回不连库的 `npm test`。

## 文档

- 接口契约：[docs/API.md](docs/API.md)
- 验收清单：[tests/ACCEPTANCE.md](tests/ACCEPTANCE.md)

## 分支

骨架在分支 `feat/mvp`。变更通过 Pull Request 进入 `main`。只开 PR，不合并到 `main`。
