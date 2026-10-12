# 江湖晚报 · 采集迭代验收清单

对照产品验收 A～D（大Y哥 2026-10-12）与契约确认。夹具优先；真网手工补一条即可。

## 范围

- 分支 `feat/mvp`（PR #1）
- 管理端（`X-Admin-Token`）：
  - `POST /api/admin/ingest/tieba/by-url`
  - `POST /api/admin/ingest/tieba/scan`
  - `POST /api/admin/ingest/tieba/import`
- 错误码：`INVALID_URL` / `FETCH_FAILED` / `CAPTCHA` / `NOT_FOUND` / `ALREADY_EXISTS` / `RATE_LIMITED`（另保留 `UNAUTHORIZED` / `INTERNAL`）
- 「字段齐」= Card（见 docs/API.md）入库为草稿：`title`、`summary`、`timeline`（length≥1）、`source_platform`、`source_type`、`clarified`、`status=draft`（或流程先改 `pending`）、`source_url`、`created_at`、`updated_at`
- 扫描只返回 `candidates`，不落库；点选 `import` 才入库
- 自动写入 **不得** 进入 C 端今日/本周（非 `published`）

## 产品验收

- [ ] A. 合法链接 by-url → 草稿字段齐，可 PATCH 编辑，可 `publish`（仍过发布校验）
- [ ] B. scan 只出 candidates；未 import 前库中无对应卡
- [ ] C. by-url/import 写入后 `GET /api/cards?scope=today|week` 不含该卡；`GET /api/cards/:id` → 404 `NOT_FOUND`
- [ ] D. 验证码等失败 → 明确 `error.code`（如 `CAPTCHA`）；库中无半截卡

## 补充

- [ ] 同 URL 二次 by-url → `ALREADY_EXISTS`，不新建第二张
- [ ] 夹具触发限流 → `RATE_LIMITED`
- [ ] 无 Token → `UNAUTHORIZED`

更细请求级用例见 [api/collect-cases.md](./api/collect-cases.md)。

## 结果记录

（功能就绪后填写：通过 / 阻塞；附提交 sha）

## 缺陷

（私聊大Y哥；群里只报通过/阻塞）

## 未覆盖风险

- 真网平台差异、验证码策略变更
- 跨平台同文去重（产品未要求则不测）
