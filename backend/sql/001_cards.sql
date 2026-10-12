-- cards table for 江湖晚报
-- Defaults (tech-lead pending): timeline [{at,text}]; source_* free strings;
-- today/week Asia/Shanghai; unpublish → archived; DATABASE_URL for MySQL.

CREATE TABLE IF NOT EXISTS cards (
  id               BIGINT       NOT NULL AUTO_INCREMENT,
  title            VARCHAR(200) NOT NULL DEFAULT '',
  summary          VARCHAR(500) NOT NULL DEFAULT '',
  timeline         JSON         NOT NULL,
  source_platform  VARCHAR(64)  NOT NULL DEFAULT '',
  source_type      VARCHAR(64)  NOT NULL DEFAULT '',
  clarified        TINYINT(1)   NOT NULL DEFAULT 0,
  status           ENUM('draft','pending','published','archived') NOT NULL DEFAULT 'draft',
  created_at       DATETIME(3)  NOT NULL,
  updated_at       DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_cards_status_updated (status, updated_at)
);

-- Seed helper (optional; or use npm run seed):
-- INSERT INTO cards (title, summary, timeline, source_platform, source_type, clarified, status, created_at, updated_at)
-- VALUES (
--   '示例：江湖晚报开张',
--   '这是一条已发布的示例卡',
--   JSON_ARRAY(JSON_OBJECT('at', '2026-10-12T10:00:00+08:00', 'text', '开张大吉')),
--   'weibo',
--   'rumor',
--   0,
--   'published',
--   CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'),
--   CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
-- );
