/* ============================================================
 * Contactify — JSON File Store (의존성 없는 폴백 DB)
 * users[] / tokens{token→userId} / cards[]
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function init() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], tokens: {}, cards: [] }, null, 2), 'utf8');
  }
}

function load() {
  init();
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return {
      users: Array.isArray(raw.users) ? raw.users : [],
      tokens: raw.tokens && typeof raw.tokens === 'object' ? raw.tokens : {},
      cards: Array.isArray(raw.cards) ? raw.cards : [],
    };
  } catch {
    return { users: [], tokens: {}, cards: [] };
  }
}

function save(data) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

/* ------------------ Users ------------------ */
function insertUser({ email, passwordHash, nickname, provider, providerId, passwordHashLiteral }) {
  const data = load();
  const user = { id: `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, email, password_hash: passwordHashLiteral || passwordHash || '', nickname, provider: provider || null, provider_id: providerId || null, created_at: new Date().toISOString() };
  data.users.push(user);
  save(data);
  const { password_hash, ...safe } = user;
  return safe;
}

/* OAuth 사용자 조회/생성 — (provider, providerId)로 식별 */
function findUserByOAuth(provider, providerId) {
  const data = load();
  return data.users.find((u) => u.provider === provider && u.provider_id === String(providerId)) || null;
}
function upsertOAuthUser({ provider, providerId, email, nickname }) {
  const exist = findUserByOAuth(provider, providerId);
  if (exist) {
    /* 프로필 정보 최신값으로 갱신 */
    const data = load();
    const u = data.users.find((x) => x.id === exist.id);
    u.nickname = nickname || u.nickname;
    if (email) u.email = String(email).toLowerCase();
    save(data);
    const { password_hash, ...safe } = u;
    return safe;
  }
  return insertUser({
    email: (email || `${provider}-${String(providerId)}@oauth.local`).toLowerCase(),
    nickname,
    provider,
    providerId: String(providerId),
    passwordHashLiteral: 'oauth-no-password',
  });
}

function findUserByEmail(email) {
  const data = load();
  return data.users.find((u) => u.email === String(email).toLowerCase()) || null;
}

/* ------------------ Tokens ------------------ */
function createToken(userId, payload) {
  const data = load();
  data.tokens[payload] = { userId, createdAt: new Date().toISOString() };
  save(data);
  return payload;
}
function getUserByToken(token) {
  const data = load();
  const t = data.tokens[token];
  if (!t) return null;
  return data.users.find((u) => u.id === t.userId) || null;
}

/* ------------------ Cards ------------------ */
function listCards(userId) {
  return load().cards.filter((c) => c.ownerId === userId);
}
function getCard(id, userId) {
  return load().cards.find((c) => c.id === id && c.ownerId === userId) || null;
}
function insertCard(card, userId) {
  const data = load();
  const full = { ...card, id: card.id || `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, ownerId: userId };
  data.cards.push(full);
  save(data);
  return full;
}
function updateCard(card, userId) {
  const data = load();
  const i = data.cards.findIndex((c) => c.id === card.id && c.ownerId === userId);
  if (i === -1) return null;
  data.cards[i] = { ...data.cards[i], ...card, ownerId: userId };
  save(data);
  return data.cards[i];
}
function deleteCard(id, userId) {
  const data = load();
  const before = data.cards.length;
  data.cards = data.cards.filter((c) => !(c.id === id && c.ownerId === userId));
  save(data);
  return data.cards.length < before;
}

module.exports = {
  init, insertUser, findUserByEmail, findUserByOAuth, upsertOAuthUser, createToken, getUserByToken,
  listCards, getCard, insertCard, updateCard, deleteCard,
};
