# 江湖晚报 API 契约

本文是 C 端、管理端与后端的接口约定。路径、字段名与行为以本文为准。当前 `backend/` 已实现本文接口（含贴吧采集）。

## 通用

- 数据库连接：环境变量 `DATABASE_URL`，格式 `mysql://user:password@host:port/database`。
- 管理端鉴权：请求头 `X-Admin-Token` 必须等于环境变量 `ADMIN_TOKEN`。
- 贴吧 Cookie 加密：环境变量 `COOKIE_ENCRYPTION_KEY` 为 32 字节密钥，用 64 位 hex 或 base64 表示。未配置或格式不对时，Cookie 写入接口返回 `500` `INTERNAL`（服务端打明确日志，日志不含 Cookie 明文）；`GET` 状态按 `missing` 处理。密文默认落在 backend 的 `data/tieba-cookie.enc`，可用 `TIEBA_COOKIE_STORE` 改路径。
- C 端接口不鉴权。
- 时间字段使用 ISO 8601 字符串。C 端「今日 / 本周」按 `Asia/Shanghai` 的自然日解释 `updated_at`。
- JSON 字段名使用 snake_case，与下表一致。

### 错误

失败时 HTTP 体为：

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "card not found"
  }
}
```

| code | HTTP | 含义 |
| --- | --- | --- |
| `INVALID_BODY` | 400 | 请求体或查询参数不合法（缺字段、JSON 坏掉、类型不对等） |
| `INVALID_URL` | 400 | 非法或非贴吧帖链接（仅采集取帖/入库）。**不要**用 `INVALID_BODY` 代替 |
| `UNAUTHORIZED` | 401 | 缺少 `X-Admin-Token`，或与 `ADMIN_TOKEN` 不一致 |
| `CAPTCHA` | 403 | 抓取遇到验证码/登录墙 |
| `NOT_FOUND` | 404 | 资源不存在，或 C 端访问非 `published` 卡片，或贴吧删帖/404 |
| `ALREADY_EXISTS` | 409 | 同一 `source_url` 已入库；响应另含 `card_id` |
| `RATE_LIMITED` | 429 | 同 token 采集超过 `INGEST_RATE_LIMIT`（默认 10/分钟） |
| `FETCH_FAILED` | 502 | 抓取超时或非预期 HTTP 状态 |
| `INTERNAL` | 500 | 未预期的服务端错误。Cookie 写入时若 `COOKIE_ENCRYPTION_KEY` 缺失或不是 32 字节 hex/base64，也用此码 |

## Card

```json
{
  "id": "string",
  "title": "string",
  "summary": "string",
  "timeline": [{ "at": "2026-10-12T08:00:00+08:00", "text": "string" }],
  "source_platform": "string",
  "source_type": "string",
  "clarified": false,
  "status": "draft",
  "created_at": "2026-10-12T00:00:00+08:00",
  "updated_at": "2026-10-12T00:00:00+08:00"
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 服务端生成 |
| `title` | string | 标题。草稿可为空串 |
| `summary` | string | 摘要。草稿可为空串 |
| `timeline` | `{ at: string, text: string }[]` | 时间线。草稿可为 `[]`。`at` 为时间点 |
| `source_platform` | string | 来源平台 |
| `source_type` | string | 来源类型 |
| `clarified` | boolean | 是否已澄清 |
| `status` | `draft` \| `pending` \| `published` \| `archived` | 见状态说明 |
| `created_at` | string | 创建时间，ISO 8601 |
| `updated_at` | string | 更新时间，ISO 8601。C 端今日/本周按此字段过滤 |

`id`、`created_at`、`updated_at` 由服务端维护，客户端不能指定。

### 状态

- `POST /api/admin/cards` 创建出来的卡片状态固定为 `draft`。
- `pending` 通过 `PATCH /api/admin/cards/:id` 写入 `status` 进入（也可以先创建，再 PATCH）。
- `POST /api/admin/cards/:id/publish` 成功后为 `published`。
- `POST /api/admin/cards/:id/unpublish` 成功后为 `archived`。
- C 端永远看不到 `draft`、`pending`、`archived`。列表与详情都只暴露 `published`。

## C 端（无鉴权）

### `GET /api/cards?scope=today|week`

只返回 `published`。响应：

```json
{ "items": [] }
```

`items` 的元素为 Card。排序：`updated_at DESC`。

时区：`Asia/Shanghai`。用 `updated_at` 换算到该时区后的日历日做比较。

- `scope=today`：`updated_at` 落在上海时区的今天（一个自然日）。
- `scope=week`：今天，加上今天之前的 6 个自然日，共 7 个自然日（含今天）。
- `scope` 不是 `today` 或 `week`：`400`，`INVALID_BODY`。

### `GET /api/cards/:id`

- 卡片存在且 `status` 为 `published`：返回该 Card。
- 卡片不存在，或状态不是 `published`（`draft` / `pending` / `archived`）：`404`，`error.code` 为 `NOT_FOUND`。

## 管理端

每个管理端请求都要带请求头 `X-Admin-Token`，值等于环境变量 `ADMIN_TOKEN`。缺失或不匹配：`401`，`UNAUTHORIZED`。不要在错误信息里回显 token。

### `GET /api/admin/cards?status=&limit=50&offset=0`

查询参数：

- `status`：可选。逗号分隔的多值，例如 `status=draft,pending`。省略或空字符串表示不按状态过滤。取值只能是 `draft`、`pending`、`published`、`archived`，否则 `400`，`INVALID_BODY`。
- `limit`：默认 `50`。
- `offset`：默认 `0`。

响应：`{ "items": Card[] }`。管理端可以看到全部状态，不受 C 端「只返回 published」的限制。

### `POST /api/admin/cards`

创建草稿，`status` 为 `draft`。

- `title` 可以是 `""`。
- `summary` 可以是 `""`。
- `timeline` 可以是 `[]`。

不能通过本接口直接创建 `pending`。要进入 `pending`，先创建再 `PATCH` 修改 `status`。

成功时返回创建后的 Card。请求体无法解析或字段类型不对：`400`，`INVALID_BODY`。

### `PATCH /api/admin/cards/:id`

部分更新已有卡片。可写字段：`title`、`summary`、`timeline`、`source_platform`、`source_type`、`clarified`、`status`。

`pending` 由此进入：把 `status` 设为 `pending`（或创建草稿后再这样 PATCH）。

卡片不存在：`404`，`NOT_FOUND`。成功时返回更新后的 Card。

### `POST /api/admin/cards/:id/publish`

发布。以下字段必须全部满足，否则 `400`，`INVALID_BODY`，且不改变状态：

- `title` 非空
- `summary` 非空
- `timeline` 长度 ≥ 1
- `source_platform` 非空
- `source_type` 非空

成功后 `status` 为 `published`，返回该 Card。卡片不存在：`404`，`NOT_FOUND`。

### `POST /api/admin/cards/:id/unpublish`

下架。成功后 `status` 为 `archived`，返回该 Card。卡片不存在：`404`，`NOT_FOUND`。

下架后的卡片不再出现在 C 端列表，按 id 访问也返回 `404` `NOT_FOUND`。


## 贴吧采集（管理端，需 `X-Admin-Token`）

限流：同 token 默认 10 次/分钟，环境变量 `INGEST_RATE_LIMIT` 可改。每次调用写 `ingest_logs`。结果卡一律 `draft`，永不自动 publish。解析/抓取失败不写半截卡。

### `POST /api/admin/ingest/tieba/by-url`

请求：

```json
{ "url": "https://tieba.baidu.com/p/123456" }
```

- 成功 `201`：返回新建草稿 Card（含 `source_url`，`source_platform` 为 `tieba`）。
- 非法/非贴吧帖 URL：`400`，`error.code` 为 **`INVALID_URL`**（不是 `INVALID_BODY`）。
- 同 `source_url` 已存在：`409`，`ALREADY_EXISTS`，且顶层带 `card_id`。
- 删帖/404：`404` `NOT_FOUND`；验证码墙：`403` `CAPTCHA`；超时/非 200：`502` `FETCH_FAILED`；超限：`429` `RATE_LIMITED`。

### `POST /api/admin/ingest/tieba/import`

请求体与响应同 `by-url`（点选候选后入库）。

### `POST /api/admin/ingest/tieba/scan`

请求：

```json
{
  "bar": "剑网3",
  "since": "2026-10-01T00:00:00+08:00",
  "until": "2026-10-12T23:59:59+08:00",
  "limit": 50
}
```

- `bar` 默认 `剑网3`；`limit` 默认 `50`。
- 成功 `200`：`{ "candidates": [{ "title", "posted_at", "url", "score", "reasons": [] }] }`。
- **不写 cards**。缺字段/坏时间窗仍用 `INVALID_BODY`。

`by-url` / `import` / `scan` 每次写 `ingest_logs`。`meta` 含 `used_cookie`（boolean）：这次抓取是否附带了处于 `valid` 的 Cookie。去重短路（`ALREADY_EXISTS`，尚未抓取）为 `false`。`meta` 与响应都不得出现 Cookie 明文或片段。

未配置 Cookie（`missing`）时，这三条的请求头、状态码和落库行为与未接 Cookie 时相同（验收 E1）。

### `PUT /api/admin/ingest/tieba/cookie`

管理员粘贴 Cookie。需要 `X-Admin-Token`。**不计入** `INGEST_RATE_LIMIT`。

请求：

```json
{ "format": "netscape", "content": "# Netscape HTTP Cookie File\n..." }
```

- `format`：`netscape`（cookies.txt，制表符分隔；`#HttpOnly_` 前缀保留）或 `json`（`[{ "name", "value", "domain?", "path?" }]`）。
- 只保存对 `tieba.baidu.com` / `.baidu.com`（父域 `baidu.com`）有用的条目。没有可用条目、格式不对或内容无法解析：`400`，`INVALID_BODY`。
- 成功 `204`，响应体为空，不回显明文。
- 明文经 AES-256-GCM 加密后落盘。`COOKIE_ENCRYPTION_KEY` 缺失或非法：`500`，`INTERNAL`，服务端日志说明密钥未配置，且不写文件。

### `GET /api/admin/ingest/tieba/cookie`

响应**只有**这两个字段：

```json
{ "status": "missing", "updated_at": null }
```

| status | 含义 |
| --- | --- |
| `missing` | 未配置，或没有可用密钥（即使磁盘上有旧文件） |
| `valid` | 已加密保存，且尚未标为失效 |
| `expired` | 使用后仍撞上验证码/登录墙，已标失效（或等价的显式失效） |

`updated_at` 为上次成功 `PUT` 的 ISO 8601 时间；`missing` 时为 `null`。标成 `expired` 不改这个时间。响应不得含 Cookie 明文、片段或其它字段（验收 E3）。

### `DELETE /api/admin/ingest/tieba/cookie`

清空密文存储。成功 `204`，随后 `GET` 为 `missing`。无密钥时与 `PUT` 一样返回 `500` `INTERNAL`，不清文件。

### 抓取时如何使用 Cookie

- 状态为 `valid` 时，`by-url` / `import` / `scan` 的贴吧 HTTP 请求附带 `Cookie` 头。
- 仍然遇到验证码/登录墙：`403` `CAPTCHA`，并把状态标为 `expired`。成功标失效时，响应在 `error` 同级多一个 `cookie_status: "expired"`（没有明文）。之后的请求不再附带，直到重新 `PUT`。
- `expired` 与 `missing` 都不附带 Cookie。
- 失败不写半截卡；采集结果仍是 `draft`，永不自动 publish。
