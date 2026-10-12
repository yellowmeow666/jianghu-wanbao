# P0 API 用例（对齐契约）

Base：服务根路径待定。管理请求头：`X-Admin-Token: $ADMIN_TOKEN`。

Card 字段：`id, title, summary, timeline[{at,text}], source_platform, source_type, clarified, status, created_at, updated_at`  
status：`draft | pending | published | archived`

## 状态泄漏（最高优先）

| id | 前置 | 操作 | 期望 |
|----|------|------|------|
| L1 | Admin 建卡保持 draft | `GET /api/cards?scope=today` 无 Token | `items` 不含该 id |
| L2 | 卡 status=pending | 同上 `scope=today` 与 `scope=week` | 均不含该 id |
| L3 | 卡 published 后 `POST .../unpublish` → archived | `GET /api/cards?scope=today` | 不含该 id |
| L4 | 已知 draft id | `GET /api/cards/:id` | 404，`error.code=NOT_FOUND` |
| L5 | 已知 pending id | `GET /api/cards/:id` | 404 NOT_FOUND |
| L6 | 已知 archived id | `GET /api/cards/:id` | 404 NOT_FOUND |
| L7 | 库中仅有未发布卡 | `GET /api/cards?scope=today` | 200，`items=[]` |

## 发布贯通与校验

| id | 前置 | 操作 | 期望 |
|----|------|------|------|
| P1 | 有 Admin Token | `POST /api/admin/cards` 建草稿 | 200/201，status=draft；无 Token → UNAUTHORIZED |
| P2 | 草稿；title/summary/source_* /clarified 已齐，timeline=[] | `POST .../publish` | INVALID_BODY，仍为 draft |
| P3 | 草稿；timeline 至少 1 节点且其它必填齐 | `POST .../publish` | status=published，updated_at 刷新 |
| P4 | P3 之后 | `GET /api/cards?scope=today` | items 含该卡；按 updated_at DESC |
| P5 | P3 之后 | `GET /api/cards/:id` | 全字段齐全；timeline.length≥1 |
| P6 | published 卡 | `POST .../unpublish` | status=archived；随后 C 端列表无、详情 404 |

## 列表范围

| id | 前置 | 操作 | 期望 |
|----|------|------|------|
| S1 | 无 Token | `GET /api/cards?scope=today` | 200（非 401） |
| S2 | 多条 published，updated_at 跨「今日 / 近7日 / 更早」 | `scope=today` / `week` | 仅落在上海时区窗口内的 published；DESC |
| S3 | Admin `GET /api/admin/cards?status=draft` | 有 Token | 可见 draft；C 端仍不可见 |

## 免责与文案

| id | 说明 |
|----|------|
| D1 | 免责入口：小程序可跑后手工/e2e |
| D2 | 「官方」冒充：文案走查；产品若定校验规则再加 API |

## 实现备注

- 自动化跟 backend 同仓（Vitest/Jest 听大Y哥）
- seed：直接插库或走 Admin API 造 draft/pending/published/archived
- `pending` 进入方式契约未写死：测试用 PATCH 或 seed 写入后再断言 C 端不可见
