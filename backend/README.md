# 江湖晚报 · Backend

微信小程序「江湖晚报」后端草案（本地 draft）。Express 5 + TypeScript (ESM / NodeNext) + mysql2。

## 环境要求

- Node.js >= 20
- MySQL 8+（仅本地跑服务 / 迁移 / 种子需要；**单测用内存 fake store，不依赖 MySQL**）

## 快速开始

```bash
cd backend
cp .env.example .env
# 编辑 .env：ADMIN_TOKEN、DATABASE_URL

# 建库（示例）
mysql -e "CREATE DATABASE IF NOT EXISTS jianghu_wanbao DEFAULT CHARSET utf8mb4;"

npm ci --legacy-peer-deps   # 本机 npm 9 若 peer 解析报错可加此 flag
npm run migrate   # 执行 sql/001_cards.sql
npm run seed      # 可选：插入一条 published 示例卡
npm run dev       # http://localhost:3000
```

### `.env` 示例

```env
PORT=3000
ADMIN_TOKEN=change-me-to-a-long-secret
DATABASE_URL=mysql://jianghu:jianghu@127.0.0.1:3306/jianghu_wanbao
```

> 使用 **`DATABASE_URL`**（`mysql://user:pass@host:port/dbname`），不再拆成 MYSQL_HOST 等五段。

## 脚本

| 脚本 | 说明 |
|------|------|
| `npm run dev` | tsx watch 开发 |
| `npm start` | 跑 `dist/server.js`（需先 build） |
| `npm run build` | `tsc -p tsconfig.build.json` |
| `npm run lint` | eslint + tsc --noEmit |
| `npm test` | vitest（**无 MySQL**，注入 MemoryStore） |
| `npm run migrate` | 应用 `sql/001_cards.sql` |
| `npm run seed` | 插入一条 published 示例 |

也可直接执行：

```bash
mysql "$DATABASE_URL 解码后的库" < sql/001_cards.sql
```

## API 摘要

错误一律：`{ error: { code, message } }`，`code` ∈ `INVALID_BODY` \| `UNAUTHORIZED` \| `NOT_FOUND` \| `INTERNAL`。

### C 端

- `GET /api/cards?scope=today|week` — 仅 `status=published`，按 `updated_at DESC`
  - **today**：`updated_at` 落在 **Asia/Shanghai** 当天
  - **week**：含今天往前共 **7** 个自然日（Shanghai）
- `GET /api/cards/:id` — 非 published → 404

`CardPublic`：`id, title, summary, timeline, source_platform, source_type, clarified, status, updated_at`

### 管理端（请求头 `X-Admin-Token` = `ADMIN_TOKEN`）

- `GET /api/admin/cards?status=&limit=&offset=`
  - `status`：**逗号分隔多值**，如 `draft,pending`
  - `limit` 默认 50、最大 100；`offset` 默认 0
- `POST /api/admin/cards` — 建 draft；`title`/`summary` 可 `""`，`timeline` 可 `[]`
- `PATCH /api/admin/cards/:id` — 部分更新；`status` 仅 `draft|pending|archived`；设 `published` 会 `INVALID_BODY`（请用 publish）
- `POST /api/admin/cards/:id/publish` — 校验后 `published` 并刷新 `updated_at`
  - title/summary trim 非空；timeline ≥1 且每项 `text` 非空且 ≤500；`source_*` 非空
- `POST /api/admin/cards/:id/unpublish` — `archived`；再上架仍走 publish

## 约定（待技术负责人确认，已写进代码注释）

- `timeline`: `[{ at: string, text: string }]`
- `source_platform` / `source_type`: 自由字符串（varchar 64）
- 时区：Asia/Shanghai
- unpublish → archived
- MySQL：`DATABASE_URL`

## 测试

```bash
npm test
```

通过 `createApp({ store: createMemoryStore(), ... })` 注入内存仓库，默认 CI / 本机无 MySQL 也能绿。连真实库的集成测为可选，不进默认 `npm test`。
