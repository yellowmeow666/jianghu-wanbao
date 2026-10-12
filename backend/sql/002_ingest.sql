-- Ingest iteration: source_url on cards + ingest_logs
-- Idempotent: migrate.ts ignores duplicate-column / duplicate-key errors.

ALTER TABLE cards
  ADD COLUMN source_url VARCHAR(512) NULL;

-- Unique when set (MySQL allows multiple NULLs on UNIQUE)
ALTER TABLE cards
  ADD UNIQUE KEY uk_cards_source_url (source_url);

-- meta JSON may include used_cookie (boolean) for tieba fetches. Never store cookie plaintext.
CREATE TABLE IF NOT EXISTS ingest_logs (
  id         BIGINT       NOT NULL AUTO_INCREMENT,
  actor      VARCHAR(64)  NOT NULL,
  action     VARCHAR(64)  NOT NULL,
  target     VARCHAR(512) NOT NULL,
  meta       JSON         NULL,
  created_at DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_ingest_logs_created (created_at)
);
