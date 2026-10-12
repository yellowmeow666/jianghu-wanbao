# backend

江湖晚报 API 占位包：Express + TypeScript + MySQL（`mysql2`）。

完整接口尚未实现，由后续提交接入。契约见 [docs/API.md](../docs/API.md)。

## 环境变量

- `DATABASE_URL`：MySQL 连接串，形如 `mysql://user:password@host:3306/jianghu`
- `ADMIN_TOKEN`：管理端请求头 `X-Admin-Token` 必须与该值一致

## 脚本

`dev` / `build` / `test` / `lint` 目前是占位脚本，退出码为 0，方便 CI 跑通。接入实现后再替换为真实命令。
