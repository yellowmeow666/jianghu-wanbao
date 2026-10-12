# 江湖晚报 · 产品验收清单

对照 [docs/API.md](../docs/API.md)。下列各项全部勾选后，本迭代的读者端与管理端行为才算通过。

- [ ] 1. C 端「今日」：`GET /api/cards?scope=today` 只返回 `published`。以 `Asia/Shanghai` 的自然日匹配 `updated_at`，按 `updated_at` 降序。
- [ ] 2. C 端「本周」：`GET /api/cards?scope=week` 覆盖今天以及此前 6 个自然日（共 7 天），只返回 `published`，按 `updated_at` 降序。
- [ ] 3. C 端详情：已发布卡片返回完整 Card。`draft` / `pending` / `archived` 或不存在时返回 `404`，错误码 `NOT_FOUND`。C 端任何接口都不返回这三种状态。
- [ ] 4. 管理端鉴权：请求头 `X-Admin-Token` 必须等于环境变量 `ADMIN_TOKEN`。缺失或不匹配时返回 `UNAUTHORIZED`。
- [ ] 5. 草稿与待审：`POST /api/admin/cards` 创建 `draft`，允许 `title` / `summary` 为空串、`timeline` 为 `[]`。`pending` 通过 `PATCH` 修改 `status` 进入（或先创建再 PATCH）。
- [ ] 6. 发布与下架：`publish` 要求 `title`、`summary`、`source_platform`、`source_type` 非空，且 `timeline` 至少 1 条，否则 `INVALID_BODY`。`unpublish` 后状态为 `archived`。
