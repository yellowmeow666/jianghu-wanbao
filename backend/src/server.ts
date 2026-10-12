import { createApp } from './app.js';
import { createPoolFromEnv } from './db.js';
import { createMysqlStore } from './cards/mysqlStore.js';

const port = Number(process.env.PORT ?? 3000);
const adminToken = process.env.ADMIN_TOKEN;
if (!adminToken) {
  console.error('ADMIN_TOKEN is required');
  process.exit(1);
}

const pool = createPoolFromEnv();
const store = createMysqlStore(pool);
const app = createApp({ store, adminToken });

app.listen(port, () => {
  console.log(`jianghu-wanbao backend listening on http://localhost:${port}`);
});
