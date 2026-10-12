# 采集迭代 API 用例（夹具优先）

Base：`http://localhost:3000`。管理头：`X-Admin-Token: $ADMIN_TOKEN`。

| 接口 | 说明 |
|------|------|
| `POST /api/admin/ingest/tieba/by-url` | 按 URL 抓取并入库草稿 |
| `POST /api/admin/ingest/tieba/scan` | 扫描候选，不落库 |
| `POST /api/admin/ingest/tieba/import` | 点选候选入库草稿 |

错误码：`INVALID_URL` / `FETCH_FAILED` / `CAPTCHA` / `NOT_FOUND` / `ALREADY_EXISTS` / `RATE_LIMITED` / `UNAUTHORIZED` / `INTERNAL`。

草稿「字段齐」：`title`、`summary`、`timeline.length≥1`、`source_platform`、`source_type`、`clarified`、`status=draft`（或 pending）、`source_url`、`created_at`、`updated_at`。

## C：自动写入不进 C 端（最高优先）

| id | 前置 | 操作 | 期望 |
|----|------|------|------|
| C1 | 夹具：合法 URL，by-url 成功 | `GET /api/cards?scope=today` 无 Token | items 不含新卡 id |
| C2 | 同上 | `GET /api/cards?scope=week` | 不含该 id |
| C3 | 记下新卡 id | `GET /api/cards/:id` | 404，`error.code=NOT_FOUND` |
| C4 | Admin `GET /api/admin/cards` 或按 id | status 为 draft/pending，**不是** published | 通过 |
| C5 | import 入库成功 | 同 C1～C3 | C 端仍不可见 |

## A：合法链接 → 草稿可编可发

| id | 前置 | 操作 | 期望 |
|----|------|------|------|
| A1 | 合法 URL + 夹具成功 | `POST .../by-url` | 2xx；卡字段齐；status=draft（或约定 pending） |
| A2 | A1 草稿 | Admin `PATCH /api/admin/cards/:id` 改 title/summary | 200，字段更新 |
| A3 | 必填已齐 | `POST .../publish` | status=published；C 端 today 可见 |
| A0 | 无 Token | `POST .../by-url` | 401 `UNAUTHORIZED` |

## B：扫描只出候选

| id | 前置 | 操作 | 期望 |
|----|------|------|------|
| B1 | 夹具：scan 返回 ≥1 候选 | `POST .../scan` | 200；body 含 `candidates`（结构按契约）；**库中无新卡** |
| B2 | B1 后点选一条 | `POST .../import` | 新建草稿，字段齐 |
| B3 | scan 后不 import | Admin 列表 / 按 source_url 查 | 无扫描产生的卡 |

## D：失败明确、无半截卡

| id | 前置 | 操作 | 期望 |
|----|------|------|------|
| D1 | 夹具：验证码 | `POST .../by-url` | 非 2xx；`error.code=CAPTCHA`；库无该 URL 新卡 |
| D2 | 夹具：上游失败 | 同上 | `FETCH_FAILED`（或约定码）；无半截 draft |
| D3 | 非法 / 空 URL | 同上 | `INVALID_URL`；无入库 |
| D4 | 夹具：目标不存在 | 同上 | `NOT_FOUND`；无入库 |

## 去重与限流

| id | 前置 | 操作 | 期望 |
|----|------|------|------|
| U1 | 已有该 URL 对应卡 | 同 URL 再 `by-url` | `ALREADY_EXISTS`；不新建第二张 |
| R1 | 夹具/mock 触发限流 | by-url 或 scan | `RATE_LIMITED` |

## 实现备注

- 夹具优先；真网手工补 1 条合法链接走通 A+C
- 请求体字段名若小杨微调，以契约 / OpenAPI 为准同步本表
- 自动化跟 backend 同仓（听大Y哥）
