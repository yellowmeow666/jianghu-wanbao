# miniprogram

江湖晚报的微信小程序，使用原生小程序 + TypeScript，不使用 Taro。CI 不编译本目录。

用微信开发者工具打开本目录。`appid` 目前是 `touristappid`，接入真实账号时再替换。上传密钥（`private.*.key`）不要提交。

## 本地检查

```bash
cd miniprogram
npm install
npm run typecheck
```

开发者工具里确认已启用 TypeScript 编译插件。`project.config.json` 关闭了合法域名校验，方便请求 `http://localhost:3000`。上传前要改回真实域名校验。

阅读须知页可以把 API 根地址写到本地存储 `apiBaseUrl`，不写则用 `http://localhost:3000`。

## 行为

- 今日 / 本周：`GET /api/cards?scope=today|week`，只渲染 `items` 里的 `published`
- 详情：`GET /api/cards/:id`，展示标题、摘要、时间线、来源平台、来源类型、是否澄清、更新时间
- 首页和详情底部有固定阅读须知入口
- 没有假数据。后端未启动时显示错误，`items` 为空时显示空态
