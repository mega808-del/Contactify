-- ============================================================
-- Contactify — MySQL 스키마 (기준 참조용)
-- SQLite/Postgres 에서도 동일 구조로 생성 가능
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            VARCHAR(40)  PRIMARY KEY,
  email         VARCHAR(120) NOT NULL UNIQUE,
  password_hash VARCHAR(200) NOT NULL,
  nickname      VARCHAR(40),
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tokens (
  token      CHAR(48)    PRIMARY KEY,
  user_id    VARCHAR(40) NOT NULL,
  created_at TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cards (
  id         VARCHAR(40)  PRIMARY KEY,
  owner_id   VARCHAR(40)  NOT NULL,
  name       VARCHAR(60)  NOT NULL,
  title      VARCHAR(60),
  company    VARCHAR(80),
  email      VARCHAR(120),
  phone      VARCHAR(30)  NOT NULL,
  address    VARCHAR(300),
  homepage   VARCHAR(300),
  bio        TEXT,
  youtube    VARCHAR(300),
  tags       JSON,
  careers    JSON,
  links      JSON,
  photo_data LONGTEXT,
  logo_data  TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_cards_owner         ON cards (owner_id);
CREATE INDEX idx_cards_owner_updated ON cards (owner_id, updated_at);
