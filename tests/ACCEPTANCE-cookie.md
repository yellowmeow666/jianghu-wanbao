# 江湖晚报 · Cookie 迭代验收清单

对照产品验收 E1～E4（大Y哥 2026-10-12 定稿 + 契约拍板）。夹具/mock 优先；真网抽测记风险，不挡合入。

## 范围

- 仓库 https://github.com/yellowmeow666/jianghu-wanbao ，分支 `feat/mvp`（PR #1）
- 管理端（`X-Admin-Token`）：
  - `PUT /api/admin/ingest/tieba/cookie` — body `{ "format": "netscape"|"json", "content": "string" }` → 成功 **204**；解析失败 **400 `INVALID_BODY`**；缺 `COOKIE_ENCRYPTION_KEY` 写入时 **500 `INTERNAL`**
  - `GET /api/admin/ingest/tieba/cookie` — **200** `{ "status": "missing"|"valid"|"expired", "updated_at": string|null }`；**永不**回 Cookie 明文/片段
  - `DELETE /api/admin/ingest/tieba/cookie` — **204**，之后 GET=`missing`
  - 既有：`POST .../by-url|scan|import`（带 Cookie 请求；遇墙仍 `403 CAPTCHA` 等）
- 禁止放宽：失败不写半截卡、不直发；未 published 卡 C 端不可见
- `status=expired` 是 GET 独立字段，与 ingest 错误并存：取帖遇墙仍回 CAPTCHA；若当时已配 Cookie，服务端可将存储标为 expired

## 产品验收

- [ ] **E1** 未配 Cookie：by-url / scan 与现网一致；夹具 CAPTCHA / 成功路径不回归；遇墙时 GET 仍为 `missing`
- [ ] **E2** 导入有效 Cookie 后：夹具模拟「带 Cookie 可取」（mock 断言请求带 Cookie 头 → 可解析 HTML）→ **201** 草稿；真网抽测可选，记风险不挡合入
- [ ] **E3** Cookie 无效/过期：mock 验证码页 → `403 CAPTCHA`，随后 GET `status=expired`；可重新 PUT；GET **永不含明文**
- [ ] **E4** C 端仍看不到未发布卡（today/week 不含 draft；`GET /api/cards/:id` → 404）

## 补充

- [ ] 失败路径无半截卡
- [ ] DELETE 后 GET=`missing`；再 PUT 有效后可走通 E2
- [ ] PUT 非法 content → `INVALID_BODY`；无 Token → `UNAUTHORIZED`

更细请求级用例见 [api/cookie-cases.md](./api/cookie-cases.md)。

## 结果记录

（功能就绪后填写：通过 / 阻塞；附提交 sha）

## 缺陷

（私聊大Y哥；群里只报通过/阻塞）

## 未覆盖风险

- 真网 Cookie 有效期、封号与平台策略
- 多实例并发改 Cookie
- 加密密钥轮换 / 运维备份（若本迭代未要求则不测）
