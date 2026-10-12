# 江湖晚报 · P0 验收清单

对照 [docs/API.md](../docs/API.md) 与产品验收 1～6。优先 API；小程序可跑后再补端到端。

## 范围

- 分支 `feat/mvp`；C 端仅 `published`；管理端 `X-Admin-Token`
- 状态：`draft` | `pending` | `published` | `archived`
- 本版不做：分享脱敏、回味归档、投稿、公开评论

## 产品验收（小天 1～6）

- [ ] 1. 未登录可访问 C 端今日列表（可空态）；小程序可跑后再验「10 秒内首屏」
- [ ] 2. 管理端录入完整卡并 `publish` 后，C 端列表/详情能读到同一条
- [ ] 3. 已发布卡必有：`title`、`summary`、`timeline`（length≥1）、`source_platform`、`source_type`、`status=published`、`updated_at`（及 `clarified`、`created_at`）
- [ ] 4. `draft` / `pending` / `archived` 不对 C 端列表可见；详情 `404` + `NOT_FOUND`
- [ ] 5. 小程序首页有非官方免责入口（端到端）
- [ ] 6. C 端可见文案无「官方」冒充表述（文案走查 / 端到端）

## API 清单（契约）

- [ ] C 端「今日」：`GET /api/cards?scope=today` 只返回 `published`；`Asia/Shanghai` 自然日匹配 `updated_at`；`updated_at DESC`
- [ ] C 端「本周」：`GET /api/cards?scope=week` 覆盖今天及此前 6 个自然日（共 7 天），只 `published`，`updated_at DESC`
- [ ] C 端详情：已发布返回完整 Card；`draft`/`pending`/`archived`/不存在 → `404` `NOT_FOUND`；C 端响应永不带这三态
- [ ] 管理鉴权：`X-Admin-Token` = `ADMIN_TOKEN`；缺失或不匹配 → `UNAUTHORIZED`
- [ ] 草稿与待审：`POST /api/admin/cards` 建 `draft`（title/summary 可空，timeline 可 `[]`）；`pending` 经 `PATCH status` 进入
- [ ] 发布与下架：`publish` 要求 title/summary/source_platform/source_type 非空且 timeline≥1，否则 `INVALID_BODY`；`unpublish` → `archived`，随后 C 端列表无、详情 404

更细的请求级用例见 [api/p0-cases.md](./api/p0-cases.md)（状态泄漏 L1～L7 优先）。

## 结果记录

（功能就绪后填写：通过 / 阻塞；附提交 sha）

## 缺陷

（私聊大Y哥；群里只报通过/阻塞）

## 未覆盖风险

- 小程序 10 秒首屏、免责入口依赖端到端
- 「官方」冒充目前无 API 校验时仅能走查
- P1 分享脱敏等不在本清单
