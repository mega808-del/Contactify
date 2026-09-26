/* ============================================================
 * Contactify — Turso (libSQL) Store — 원격 영속 DB
 * ------------------------------------------------------------
 * server.js 에서 TURSO_DATABASE_URL 이 설정되어 있으면 이 모듈을 사용합니다.
 * 클라이언트는 @libsql/client (HTTP/WebSocket 기반) — 서버에 SQLite
 * 파일 시스템이 없어도 동작하므로 Render 무료 플랜(휘발 디스크)에서
 * 데이터가 유지됩니다.
 *
 * 환경변수:
 *   TURSO_DATABASE_URL   libsql://... (필수)
 *   TURSO_AUTH_TOKEN     Turso 콘솔에서 발급한 토큰 (필수)
 * ============================================================ */
'use strict';

const { createClient } = require('@libsql/client');

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const nowIso = () => new Date().toISOString();
const uid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/* ------------------ 스키마 ------------------ */
const SCHEMA = `
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
  hidden     TEXT NOT NULL DEFAULT '{}',
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cards_owner ON cards (owner_id);
`;

async function init() {
  await client.batch(SCHEMA.split(';').map((s) => s.trim()).filter(Boolean).map((sql) => ({ sql, args: [] })), 'write');
}

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
async function insertUser({ email, passwordHash, nickname }) {
  const user = { id: uid('u'), email, password_hash: passwordHash, nickname, created_at: nowIso() };
  await client.execute({
    sql: 'INSERT INTO users (id, email, password_hash, nickname, created_at) VALUES (?, ?, ?, ?, ?)',
    args: [user.id, user.email, user.password_hash, user.nickname, user.created_at],
  });
  const { password_hash, ...safe } = user;
  return safe;
}

async function findUserByEmail(email) {
  const rs = await client.execute({
    sql: 'SELECT * FROM users WHERE email = ?',
    args: [String(email).toLowerCase()],
  });
  return rs.rows[0] || null;
}

/* OAuth 사용자 조회/생성 — (provider, provider_id)로 식별 */
async function findUserByOAuth(provider, providerId) {
  const rs = await client.execute({
    sql: 'SELECT * FROM users WHERE provider = ? AND provider_id = ?',
    args: [provider, String(providerId)],
  });
  return rs.rows[0] || null;
}
async function upsertOAuthUser({ provider, providerId, email, nickname }) {
  const exist = await findUserByOAuth(provider, providerId);
  if (exist) {
    const u = await client.execute({
      sql: 'UPDATE users SET nickname = COALESCE(?, nickname), email = COALESCE(?, email) WHERE id = ? RETURNING *',
      args: [nickname || null, email ? String(email).toLowerCase() : null, exist.id],
    });
    return u.rows[0] || exist;
  }
  const user = { id: uid('u'), email: (email || `${provider}-${String(providerId)}@oauth.local`).toLowerCase(), password_hash: 'oauth-no-password', nickname, provider, provider_id: String(providerId), created_at: nowIso() };
  await client.execute({
    sql: 'INSERT INTO users (id, email, password_hash, nickname, provider, provider_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: [user.id, user.email, user.password_hash, user.nickname, user.provider, user.provider_id, user.created_at],
  });
  return user;
}

async function createToken(userId, payload) {
  await client.execute({
    sql: 'INSERT INTO tokens (token, user_id, created_at) VALUES (?, ?, ?)',
    args: [payload, userId, nowIso()],
  });
  return payload;
}

async function getUserByToken(token) {
  const rs = await client.execute({
    sql: 'SELECT u.* FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.token = ?',
    args: [token],
  });
  return rs.rows[0] || null;
}

/* ------------------ Cards ------------------ */
async function listCards(userId) {
  const rs = await client.execute({
    sql: 'SELECT * FROM cards WHERE owner_id = ? ORDER BY updated_at DESC',
    args: [userId],
  });
  return rs.rows.map(rowToCard);
}

async function getCard(id, userId) {
  const rs = await client.execute({
    sql: 'SELECT * FROM cards WHERE id = ? AND owner_id = ?',
    args: [id, userId],
  });
  return rowToCard(rs.rows[0]);
}

async function insertCard(card, userId) {
  const row = cardToRow({ ...card, id: card.id || uid('c') }, userId);
  await client.execute({
    sql: `INSERT INTO cards (id, owner_id, name, title, company, email, phone, address, homepage, bio, youtube, tags, careers, links, photo_data, logo_data, hidden, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [row.id, row.owner_id, row.name, row.title, row.company, row.email, row.phone, row.address,
      row.homepage, row.bio, row.youtube, row.tags, row.careers, row.links, row.photo_data, row.logo_data,
      row.hidden, row.created_at, row.updated_at],
  });
  return getCard(row.id, userId);
}

async function updateCard(card, userId) {
  const row = cardToRow(card, userId);
  await client.execute({
    sql: `UPDATE cards SET name=?, title=?, company=?, email=?, phone=?, address=?,
          homepage=?, bio=?, youtube=?, tags=?, careers=?, links=?,
          photo_data=?, logo_data=?, hidden=?, updated_at=?
          WHERE id=? AND owner_id=?`,
    args: [row.name, row.title, row.company, row.email, row.phone, row.address,
      row.homepage, row.bio, row.youtube, row.tags, row.careers, row.links,
      row.photo_data, row.logo_data, row.hidden, row.updated_at,
      row.id, row.owner_id],
  });
  return getCard(row.id, userId);
}

async function deleteCard(id, userId) {
  const rs = await client.execute({
    sql: 'DELETE FROM cards WHERE id = ? AND owner_id = ?',
    args: [id, userId],
  });
  return rs.rowsAffected > 0;
}

module.exports = {
  init, insertUser, findUserByEmail, findUserByOAuth, upsertOAuthUser, createToken, getUserByToken,
  listCards, getCard, insertCard, updateCard, deleteCard,
};
