# Cookie 迭代 API 用例（夹具优先）

Base：`http://localhost:3000`。管理头：`X-Admin-Token: $ADMIN_TOKEN`。

| 接口 | 说明 |
|------|------|
| `PUT /api/admin/ingest/tieba/cookie` | body `{ "format": "netscape"\|"json", "content": "string" }` → **204**；解析失败 **400 `INVALID_BODY`**；缺 `COOKIE_ENCRYPTION_KEY` → **500 `INTERNAL`** |
| `GET /api/admin/ingest/tieba/cookie` | **200** `{ status: "missing"\|"valid"\|"expired", updated_at }`；**永不**回明文/片段 |
| `DELETE /api/admin/ingest/tieba/cookie` | **204**；之后 GET=`missing` |
| `POST /api/admin/ingest/tieba/by-url` 等 | 采集；已配 Cookie 时请求应带 Cookie 头 |

草稿「字段齐」同 collect-cases。契约以大Y哥拍板为准；`docs/API.md` 有出入先对齐本表再改文档。

## E1：未配 Cookie — 与现网一致

| id | 前置 | 操作 | 期望 |
|----|------|------|------|
| E1-0 | 无 Cookie 文件 / 未 PUT；或 DELETE 后 | `GET .../cookie` | 200；`status=missing`；`updated_at=null`（或约定）；JSON **无** `content`/`cookie`/`BDUSS` 等 |
| E1-1 | 同上；夹具 post-ok | `POST .../by-url` 合法 URL | 201 draft；字段齐 |
| E1-2 | 同上；夹具 captcha | `POST .../by-url` | 403 `CAPTCHA`；**无半截卡**；再 GET 仍 `missing` |
| E1-3 | 同上；夹具 list-ok | `POST .../scan` | 200；`candidates`；不落库 |
| E1-4 | 无 Token | `PUT` / `GET` / `DELETE .../cookie` | 401 `UNAUTHORIZED` |

## E2：有效 Cookie — 夹具「带 Cookie 可取」→ 草稿

| id | 前置 | 操作 | 期望 |
|----|------|------|------|
| E2-1 | 已配 `COOKIE_ENCRYPTION_KEY`；`PUT` 合法假 Cookie（netscape 或 json） | 响应 | **204** |
| E2-2 | E2-1 后 | `GET .../cookie` | 200；`status=valid`；有 `updated_at`；**无明文** |
| E2-3 | E2-1 后；fetch mock：断言请求带 Cookie 头，返回可解析 HTML（post-ok） | `POST .../by-url` | **201** draft；字段齐；有 `source_url` |
| E2-4 | E2-3 新卡 id | `GET /api/cards?scope=today\|week`；`GET /api/cards/:id` | 列表不含；详情 404 `NOT_FOUND` |
| E2-5 | （可选真网）有效 Cookie + 公开帖 | by-url 一次 | 成功记过；遇墙记风险，**不挡合入** |

## E3：无效/过期 + 脱敏

| id | 前置 | 操作 | 期望 |
|----|------|------|------|
| E3-1 | 已 PUT；mock 返回验证码页 | `POST .../by-url` | 403 `CAPTCHA`；**无半截卡** |
| E3-2 | E3-1 后 | `GET .../cookie` | `status=expired`（服务端将已配 Cookie 标为过期） |
| E3-3 | 任意已配置态 | `GET .../cookie` 响应 JSON | 断言无 `content` / `cookie` / `BDUSS` / 其它明文片段字段 |
| E3-4 | E3-2 后 | 再 `PUT` 合法 Cookie | 204；GET → `valid`；随后 E2-3 可再通过 |
| E3-5 | `PUT` 非法/空 content 或非法 format | PUT | 400 `INVALID_BODY`；状态不误升为 valid |

## E4：C 端回归

| id | 前置 | 操作 | 期望 |
|----|------|------|------|
| E4-1 | E2-3 草稿 | `GET /api/cards?scope=today` | 不含该 id |
| E4-2 | 同上 | `GET /api/cards?scope=week` | 不含该 id |
| E4-3 | 同上 | `GET /api/cards/:id` | 404 `NOT_FOUND` |
| E4-4 | Admin 带 Token | `GET /api/admin/cards` | 可见该 draft |

## 清除

| id | 前置 | 操作 | 期望 |
|----|------|------|------|
| X1 | 已 valid/expired | `DELETE .../cookie` | 204；GET=`missing` |

## 实现备注

- 夹具优先；真网抽测不进 CI、不挡合入
- Cookie 明文只允许出现在 PUT 请求体；测试日志脱敏
- 缺加密密钥写路径 → 500 `INTERNAL`（可单独记一条冒烟）
