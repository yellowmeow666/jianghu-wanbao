import { createPoolFromEnv } from './db.js';

/**
 * Insert one published sample card (Asia/Shanghai "now" for updated_at).
 */
async function main(): Promise<void> {
  const pool = createPoolFromEnv();
  const now = new Date();
  const iso = now.toISOString();
  const dt = iso.slice(0, 23).replace('T', ' ');
  const timeline = JSON.stringify([
    { at: '2026-10-12T10:00:00+08:00', text: '江湖晚报开张大吉' },
  ]);
  try {
    const [result] = await pool.execute(
      `INSERT INTO cards
        (title, summary, timeline, source_platform, source_type, clarified, status, created_at, updated_at)
       VALUES (?, ?, CAST(? AS JSON), ?, ?, 0, 'published', ?, ?)`,
      [
        '示例：江湖晚报开张',
        '这是一条已发布的示例卡，可在 C 端 today/week 列表中看到',
        timeline,
        'weibo',
        'rumor',
        dt,
        dt,
      ],
    );
    const id = (result as { insertId: number }).insertId;
    console.log(`Seeded published card id=${id}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
