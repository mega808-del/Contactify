/* ============================================================
 * Contactify — SQLite Store (better-sqlite3 설치 시 자동 사용)
 * npm i better-sqlite3 → 서버 재시작하면 DB가 SQLite로 전환됩니다.
 * 스키마: db/schema.sql 참고
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'contactify.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nickname      TEXT,
  provider      TEXT,
  provider_id   TEXT,
  created_at    TEXT
);
CREATE TABLE IF NOT EXISTS tokens (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS cards (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  title      TEXT,
  company    TEXT,
  email      TEXT,
  phone      TEXT NOT NULL,
  address    TEXT,
  homepage   TEXT,
  bio        TEXT,
  youtube    TEXT,
  tags       TEXT,
  careers    TEXT,
  links      TEXT,
  photo_data TEXT,
  logo_data  TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cards_owner ON cards (owner_id);
`);

/* 마이그레이션: 기존 DB에 hidden 컬럼(숨김 항목 플래그 JSON) 추가 */
try {
  db.exec("ALTER TABLE cards ADD COLUMN hidden TEXT NOT NULL DEFAULT '{}'");
} catch { /* 이미 컬럼이 있으면 무시 */ }

/* 마이그레이션: OAuth 지원 컬럼 (provider / provider_id) */
try {
  db.exec('ALTER TABLE users ADD COLUMN provider TEXT');
} catch { /* 이미 컬럼이 있으면 무시 */ }
try {
  db.exec('ALTER TABLE users ADD COLUMN provider_id TEXT');
} catch { /* 이미 컬럼이 있으면 무시 */ }

const nowIso = () => new Date().toISOString();
const uid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const rowToCard = (r) => r && ({
  id: r.id, ownerId: r.owner_id, name: r.name, title: r.title, company: r.company,
  email: r.email, phone: r.phone, address: r.address, homepage: r.homepage,
  bio: r.bio, youtube: r.youtube,
  tags: JSON.parse(r.tags || '[]'),
  careers: JSON.parse(r.careers || '[]'),
  links: JSON.parse(r.links || '[]'),
  images: { photo: r.photo_data || '', logo: r.logo_data || '' },
  hidden: (() => { try { return JSON.parse(r.hidden || '{}'); } catch { return {}; } })(),
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const cardToRow = (c, userId) => ({
  id: c.id, owner_id: userId, name: c.name, title: c.title, company: c.company,
  email: c.email, phone: c.phone, address: c.address, homepage: c.homepage,
  bio: c.bio, youtube: c.youtube,
  tags: JSON.stringify(c.tags || []), careers: JSON.stringify(c.careers || []),
  links: JSON.stringify(c.links || []),
  photo_data: c.images?.photo || '', logo_data: c.images?.logo || '',
  hidden: JSON.stringify(c.hidden || {}),
  created_at: c.createdAt, updated_at: c.updatedAt,
});

/* ------------------ Users / Tokens ------------------ */
function insertUser({ email, passwordHash, nickname, provider, providerId, passwordHashLiteral }) {
  const user = { id: uid('u'), email, password_hash: passwordHashLiteral || passwordHash || '', nickname, provider: provider || null, provider_id: providerId || null, created_at: nowIso() };
  db.prepare('INSERT INTO users (id, email, password_hash, nickname, provider, provider_id, created_at) VALUES (@id, @email, @password_hash, @nickname, @provider, @provider_id, @created_at)').run(user);
  const { password_hash, ...safe } = user;
  return safe;
}

/* OAuth 사용자 조회/생성 — (provider, provider_id)로 식별 */
const findUserByOAuth = (provider, providerId) =>
  db.prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?').get(provider, String(providerId)) || null;

function upsertOAuthUser({ provider, providerId, email, nickname }) {
  const exist = findUserByOAuth(provider, providerId);
  if (exist) {
    db.prepare('UPDATE users SET nickname = COALESCE(?, nickname), email = COALESCE(?, email) WHERE id = ?').run(nickname || null, email ? String(email).toLowerCase() : null, exist.id);
    return findUserByOAuth(provider, providerId);
  }
  return insertUser({
    email: (email || `${provider}-${String(providerId)}@oauth.local`).toLowerCase(),
    nickname,
    provider,
    providerId: String(providerId),
    passwordHashLiteral: 'oauth-no-password',
  });
}
const findUserByEmail = (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase()) || null;

function createToken(userId, payload) {
  db.prepare('INSERT INTO tokens (token, user_id, created_at) VALUES (?, ?, ?)').run(payload, userId, nowIso());
  return payload;
}
const getUserByToken = (token) => {
  const row = db.prepare('SELECT u.* FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.token = ?').get(token);
  return row || null;
};

/* ------------------ Cards ------------------ */
const listCards = (userId) => db.prepare('SELECT * FROM cards WHERE owner_id = ? ORDER BY updated_at DESC').all(userId).map(rowToCard);

const getCard = (id, userId) => rowToCard(db.prepare('SELECT * FROM cards WHERE id = ? AND owner_id = ?').get(id, userId));

function insertCard(card, userId) {
  const row = cardToRow({ ...card, id: card.id || uid('c') }, userId);
  db.prepare(`INSERT INTO cards (id, owner_id, name, title, company, email, phone, address, homepage, bio, youtube, tags, careers, links, photo_data, logo_data, hidden, created_at, updated_at)
              VALUES (@id, @owner_id, @name, @title, @company, @email, @phone, @address, @homepage, @bio, @youtube, @tags, @careers, @links, @photo_data, @logo_data, @hidden, @created_at, @updated_at)`).run(row);
  return getCard(row.id, userId);
}

function updateCard(card, userId) {
  const row = cardToRow(card, userId);
  db.prepare(`UPDATE cards SET name=@name, title=@title, company=@company, email=@email, phone=@phone, address=@address,
              homepage=@homepage, bio=@bio, youtube=@youtube, tags=@tags, careers=@careers, links=@links,
              photo_data=@photo_data, logo_data=@logo_data, hidden=@hidden, updated_at=@updated_at
              WHERE id=@id AND owner_id=@owner_id`).run(row);
  return getCard(row.id, userId);
}

const deleteCard = (id, userId) => db.prepare('DELETE FROM cards WHERE id = ? AND owner_id = ?').run(id, userId).changes > 0;

module.exports = {
  insertUser, findUserByEmail, findUserByOAuth, upsertOAuthUser, createToken, getUserByToken,
  listCards, getCard, insertCard, updateCard, deleteCard,
};
