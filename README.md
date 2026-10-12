# 江湖晚报

江湖晚报（jianghu-wanbao）用卡片记录事件：微信小程序给读者看已发布内容，管理端维护卡片，后端提供 API。

## 技术栈

- `backend/`：Express + TypeScript + MySQL（mysql2）。当前是占位包，完整 API 尚未实现。
- `admin/`：Vite + React + TypeScript 管理端占位。
- `miniprogram/`：微信原生小程序 + TypeScript，不使用 Taro。CI 不编译小程序。

## 本地运行

### 后端

```bash
cd backend
npm ci
```

运行前准备环境变量（见 [backend/README.md](backend/README.md)）：

- `DATABASE_URL`：`mysql://user:password@host:3306/jianghu`
- `ADMIN_TOKEN`：管理端令牌

```bash
npm run dev
```

`dev` / `build` / `test` / `lint` 仍是占位脚本。接口行为以 [docs/API.md](docs/API.md) 为准。

### 管理端

```bash
cd admin
npm ci
npm run dev
```

## 文档

- 接口契约：[docs/API.md](docs/API.md)
- 验收清单：[tests/ACCEPTANCE.md](tests/ACCEPTANCE.md)

## 分支

骨架在分支 `feat/mvp`。变更通过 Pull Request 进入 `main`。只开 PR，不合并到 `main`。
