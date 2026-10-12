# admin

江湖晚报整理台：Vite + React + TypeScript。

```bash
cd admin
npm ci
npm run dev
```

浏览器打开 Vite 提示的本地地址（默认 `http://localhost:5173`）。

API 根地址默认 `http://localhost:3000`，请求头 `X-Admin-Token` 默认 `dev-admin-token`。两者可用环境变量覆盖：

```bash
cp .env.example .env
```

`.env` 不要提交生产令牌。页面上的「保存连接」只写本机 `localStorage`。

后端未启动时列表和贴吧取帖都显示错误，可以重试，不会用样例条目冒充已发布内容。状态流转：保存草稿 → 提交待审（`PATCH status=pending`）→ 发布（`POST .../publish`）→ 下架（`POST .../unpublish`）。

「贴吧取帖」调用 `POST /api/admin/ingest/tieba/by-url`、`/scan`、`/import`。扫描字段是 `bar`。扫描只展示候选；入库成功或 `ALREADY_EXISTS` 后进入草稿编辑。

贴吧 Cookie 走 `GET` / `PUT` / `DELETE /api/admin/ingest/tieba/cookie`。状态条只显示未配置、有效或已过期，以及更新时间。粘贴内容不写入 `localStorage`，失败提示也不回显正文。

从 Vite 页面直接请求 `http://localhost:3000` 是跨源请求，后端需要允许页面来源，并允许请求头 `X-Admin-Token`。
