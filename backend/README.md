# 江湖晚报 · Backend

微信小程序「江湖晚报」后端草案（本地 draft）。Express 5 + TypeScript (ESM / NodeNext) + mysql2 + cheerio（贴吧采集）。

## 环境要求

- Node.js >= 20
- MySQL 8+（仅本地跑服务 / 迁移 / 种子需要；**单测用内存 fake store，不依赖 MySQL**）

## 快速开始

```bash
cd backend
cp .env.example .env
# 编辑 .env：ADMIN_TOKEN、DATABASE_URL、INGEST_RATE_LIMIT、COOKIE_ENCRYPTION_KEY

# 建库（示例）
mysql -e "CREATE DATABASE IF NOT EXISTS jianghu_wanbao DEFAULT CHARSET utf8mb4;"

npm ci --legacy-peer-deps   # 本机 npm 9 若 peer 解析报错可加此 flag
npm run migrate   # 按序执行 sql/*.sql（001_cards → 002_ingest）
npm run seed      # 可选：插入一条 published 示例卡
npm run dev       # http://localhost:3000
```

### `.env` 示例

```env
PORT=3000
ADMIN_TOKEN=change-me-to-a-long-secret
DATABASE_URL=mysql://jianghu:jianghu@127.0.0.1:3306/jianghu_wanbao
INGEST_RATE_LIMIT=10
# 写入、保存加密贴吧 Cookie 时必填。换成自己的值，不要提交真实密钥。
COOKIE_ENCRYPTION_KEY=change-me-to-a-long-secret
# 可选：加密 Cookie 文件路径。不设则用默认路径。
# TIEBA_COOKIE_STORE=data/tieba-cookie.enc
```

> 使用 **`DATABASE_URL`**（`mysql://user:pass@host:port/dbname`），不再拆成 MYSQL_HOST 等五段。

写入并保存加密贴吧 Cookie 必须设置 `COOKIE_ENCRYPTION_KEY`。本地和开发环境自己填写，不要把真实密钥写进仓库或提交 `.env`。`TIEBA_COOKIE_STORE` 可选，用来指定加密 Cookie 文件路径；不设则用默认路径。这些文件匹配 `*.enc`、`data/tieba-cookie*`、`backend/data/tieba-cookie*`，已被 gitignore。CI 不使用真实密钥：`backend` 与 `backend-mysql` 只注入占位 `ci-cookie-encryption-key-not-for-prod`。

## 脚本

| 脚本 | 说明 |
|------|------|
| `npm run dev` | tsx watch 开发 |
| `npm start` | 跑 `dist/server.js`（需先 build） |
| `npm run build` | `tsc -p tsconfig.build.json` |
| `npm run lint` | eslint + tsc --noEmit |
| `npm test` | vitest（**无 MySQL / 无真网贴吧请求**，注入 MemoryStore + fake fetcher） |
| `npm run migrate` | 按文件名排序应用 `sql/*.sql`（幂等：重复列/索引可忽略） |
| `npm run seed` | 插入一条 published 示例 |

## API 摘要

错误一律：`{ error: { code, message } }`。

`code` ∈ `INVALID_BODY` \| `UNAUTHORIZED` \| `NOT_FOUND` \| `ALREADY_EXISTS` \| `RATE_LIMITED` \| `FETCH_FAILED` \| `CAPTCHA` \| `INTERNAL`。

`ALREADY_EXISTS`（贴吧去重）额外带顶层 `card_id`：`{ error: { code, message }, card_id }`。

### C 端

- `GET /api/cards?scope=today|week` — 仅 `status=published`，按 `updated_at DESC`
  - **today**：`updated_at` 落在 **Asia/Shanghai** 当天
  - **week**：含今天往前共 **7** 个自然日（Shanghai）
- `GET /api/cards/:id` — 非 published → 404

`CardPublic`：`id, title, summary, timeline, source_platform, source_type, clarified, status, created_at, updated_at`（**不**暴露 `source_url`）

### 管理端（请求头 `X-Admin-Token` = `ADMIN_TOKEN`）

- `GET /api/admin/cards?status=&limit=&offset=`
  - `status`：**逗号分隔多值**，如 `draft,pending`
  - `limit` 默认 50、最大 100；`offset` 默认 0
- `POST /api/admin/cards` — 建 draft；`title`/`summary` 可 `""`，`timeline` 可 `[]`
- `PATCH /api/admin/cards/:id` — 部分更新；`status` 仅 `draft|pending|archived`；设 `published` 会 `INVALID_BODY`（请用 publish）
- `POST /api/admin/cards/:id/publish` — 校验后 `published` 并刷新 `updated_at`
  - title/summary trim 非空；timeline ≥1 且每项 `text` 非空且 ≤500；`source_*` 非空
- `POST /api/admin/cards/:id/unpublish` — `archived`；再上架仍走 publish

### 贴吧采集（管理端，同样需要 `X-Admin-Token`）

限流：同一 token 默认 **10 次/分钟**（`INGEST_RATE_LIMIT`），超限 `429 RATE_LIMITED`。每次调用写 `ingest_logs`。

| 方法 | 路径 | Body | 说明 |
|------|------|------|------|
| POST | `/api/admin/ingest/tieba/by-url` | `{ url }` | 抓公开帖页 → 建 **draft** 卡（`source_platform=tieba`，`source_url` 规范化唯一） |
| POST | `/api/admin/ingest/tieba/import` | `{ url }` | 与 by-url 相同 |
| POST | `/api/admin/ingest/tieba/scan` | `{ bar?, since, until, limit? }` | 扫吧列表按时间窗 + 818 词表打分，返回 `candidates`；**不写 cards** |

- URL 须为 `tieba.baidu.com/p/{id}`；规范化：去 query、统一 https。
- 去重：`source_url` 已存在 → `409 ALREADY_EXISTS` + `card_id`。
- 抓取错误：`FETCH_FAILED`（超时/非 200）、`CAPTCHA`（验证码/登录墙）、`NOT_FOUND`（删帖/404）。
- **解析失败不写 cards**（禁止半截成功）。

#### 本地手动冒烟（需能访问贴吧公网）

```bash
# 终端 A
export ADMIN_TOKEN=dev-token DATABASE_URL=mysql://... INGEST_RATE_LIMIT=10 COOKIE_ENCRYPTION_KEY=dev-cookie-key
npm run migrate && npm run dev

# 终端 B
curl -s -X POST http://localhost:3000/api/admin/ingest/tieba/by-url \
  -H "Content-Type: application/json" -H "X-Admin-Token: $ADMIN_TOKEN" \
  -d '{"url":"https://tieba.baidu.com/p/某帖ID"}' | jq .

curl -s -X POST http://localhost:3000/api/admin/ingest/tieba/scan \
  -H "Content-Type: application/json" -H "X-Admin-Token: $ADMIN_TOKEN" \
  -d '{"bar":"剑网3","since":"2026-10-01 00:00:00","until":"2026-10-12 23:59:59","limit":20}' | jq .
```

## 约定

- `timeline`: `[{ at: string, text: string }]`
- `source_platform` / `source_type`: 自由字符串（varchar 64）；采集写入 `tieba` + 词表粗分（`gossip`/`evidence`/…/`other`）
- `source_url`: 可选唯一键（管理端可见；C 端 `toPublic` 不返回）
- 时区：Asia/Shanghai
- unpublish → archived
- MySQL：`DATABASE_URL`
- 贴吧 Cookie：写入加密存储需要 `COOKIE_ENCRYPTION_KEY`；文件路径可选 `TIEBA_COOKIE_STORE`
- 真网贴吧请求 **不进 CI**；单测用 `test/fixtures/tieba/*.html` + 注入 fetcher

## 测试

```bash
npm test
npm run lint && npm run build
```

通过 `createApp({ store: createMemoryStore(), fetchPage, ... })` 注入，默认 CI / 本机无 MySQL、无外网也能绿。连真实库的集成测为可选，不进默认 `npm test`。
