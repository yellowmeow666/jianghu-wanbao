# 江湖晚报 API 契约

本文是 C 端、管理端与后端的接口约定。路径、字段名与行为以本文为准。当前 `backend/` 只是占位，尚未实现这些接口。

## 通用

- 数据库连接：环境变量 `DATABASE_URL`，格式 `mysql://user:password@host:port/database`。
- 管理端鉴权：请求头 `X-Admin-Token` 必须等于环境变量 `ADMIN_TOKEN`。
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
| `INVALID_BODY` | 400 | 请求体或查询参数不合法 |
| `UNAUTHORIZED` | 401 | 缺少 `X-Admin-Token`，或与 `ADMIN_TOKEN` 不一致 |
| `NOT_FOUND` | 404 | 资源不存在，或 C 端访问非 `published` 卡片 |
| `INTERNAL` | 500 | 未预期的服务端错误 |

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
