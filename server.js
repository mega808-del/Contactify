/* ============================================================
 * Contactify — Node.js Server (의존성 없음)
 * ------------------------------------------------------------
 * 정적 서빙 + REST API
 *   Auth    : POST /api/auth/signup, /api/auth/login, GET /api/me
 *   Cards   : GET/POST /api/cards, GET/PUT/DELETE /api/cards/:id
 *   Sync    : POST /api/sync  (일괄 동기화 — updatedAt 최신 우선 병합)
 *   Backup  : GET /api/export.json|export.csv|export.vcf
 *             POST /api/import (JSON/CSV/vCard 텍스트 일괄 등록)
 *   기타    : GET /api/ping, GET /api/cards/:id/vcf
 *
 * DB: SQLite(better-sqlite3) — 설치되어 있으면 사용, 없으면 JSON 파일 폴백.
 * 사용자별 소유(user_id 매핑)로 기기 변경 시에도 데이터 유지.
 *
 * 실행: npm start  → http://localhost:3000
 * ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

/* ---------- DB 선택: Turso(원격) → SQLite → JSON 폴백 ----------
 * TURSO_DATABASE_URL 이 있으면 원격 영속 DB (Render 등 휘발 디스크 환경용).
 * db 인터페이스는 원격 모드에서 async — handleApi 는 전부 await 하므로 호환. */
let db;
if (process.env.TURSO_DATABASE_URL) {
  db = require('./db/turso-store'); // @libsql/client 기반 원격 DB
  console.log('  💾 DB: Turso (libSQL 원격 — 영속)');
} else {
  try {
    db = require('./db'); // db/index.js — better-sqlite3 기반
    console.log('  💾 DB: SQLite (better-sqlite3)');
  } catch {
    db = require('./db/json-store'); // 의존성 없는 파일 DB
    console.log('  💾 DB: JSON 파일 (db/data/db.json)');
  }
}

/* ==================== 유틸 ==================== */
const nowIso = () => new Date().toISOString();
const uid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
const jerr = (res, status, msg) => sendJson(res, status, { ok: false, error: msg });

function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > limit) { reject(new Error('Payload too large')); req.destroy(); }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { throw new Error('Invalid JSON'); }
}

/* ---------- 비밀번호 해시 (scrypt + salt) ---------- */
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const test = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
  } catch { return false; }
}

/* ---------- 토큰 ---------- */
function issueToken(userId) {
  const payload = crypto.randomBytes(24).toString('hex');
  return db.createToken(userId, payload);
}
async function getUserFromReq(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  return db.getUserByToken(token);
}

/* ---------- 카드 정제/검증 ---------- */
function str(v, max = 500) {
  if (v === undefined || v === null) return '';
  return String(v).slice(0, max);
}
function sanitizeCard(body, { allowEmptyPhone = false } = {}) {
  const errors = [];
  const name = str(body.name, 60).trim();
  const phone = str(body.phone, 30).trim();
  if (!name) errors.push('이름은 필수입니다.');
  if (!phone && !allowEmptyPhone) errors.push('전화번호는 필수입니다.');
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) errors.push('이메일 형식이 올바르지 않습니다.');
  if (errors.length) return { errors };

  return {
    card: {
      id: body.id || null,
      name,
      title: str(body.title, 60),
      company: str(body.company, 80),
      email: str(body.email, 120),
      phone,
      address: str(body.address, 300),
      homepage: str(body.homepage, 300),
      bio: str(body.bio, 2000),
      youtube: str(body.youtube, 300),
      tags: Array.isArray(body.tags) ? body.tags.slice(0, 12).map((t) => ({
        id: t.id || uid('t'), tag: str(t.tag, 30),
      })) : [],
      careers: Array.isArray(body.careers) ? body.careers.slice(0, 10).map((x) => ({
        id: x.id || uid('t'), period: str(x.period, 40), desc: str(x.desc, 120),
      })) : [],
      links: Array.isArray(body.links) ? body.links.slice(0, 10).map((x) => ({
        id: x.id || uid('t'), title: str(x.title, 40), url: str(x.url, 300),
      })) : [],
      images: {
        photo: str(body.images?.photo, 4_000_000),
        logo: str(body.images?.logo, 2_000_000),
      },
      hidden: sanitizeHidden(body.hidden),
      ownerId: body.ownerId ?? null,
      createdAt: body.createdAt || nowIso(),
      updatedAt: body.updatedAt || nowIso(),
    },
  };
}

/* 명함에서 숨길 항목 플래그 — 이름(name)·전화번호(phone)는 항상 표시되므로 키에 없음 */
function sanitizeHidden(h) {
  const HIDDEN_KEYS = ['title', 'company', 'email', 'homepage', 'address', 'bio', 'tags', 'careers', 'links', 'youtube', 'photo', 'logo'];
  const out = {};
  if (h && typeof h === 'object') {
    for (const k of HIDDEN_KEYS) if (h[k]) out[k] = true;
  }
  return out;
}

/* ---------- CSV/vCard (서버 사이드 export/import) ---------- */
const CSV_HEADERS = ['id', 'ownerId', 'name', 'title', 'company', 'email', 'phone', 'address',
  'homepage', 'bio', 'tags', 'careers', 'links', 'youtube', 'createdAt', 'updatedAt'];

function cardsToCsv(cards) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [CSV_HEADERS.join(',')];
  for (const c of cards) {
    rows.push([
      c.id, c.ownerId || '', c.name, c.title, c.company, c.email, c.phone, c.address,
      c.homepage, c.bio,
      (c.tags || []).map((t) => t.tag).join('; '),
      (c.careers || []).map((x) => `${x.period} | ${x.desc}`).join(' ;; '),
      (c.links || []).map((x) => `${x.title} :: ${x.url}`).join(' ;; '),
      c.youtube || '', c.createdAt, c.updatedAt,
    ].map(cell).join(','));
  }
  return '\uFEFF' + rows.join('\r\n');
}

function csvToCards(text) {
  const rows = [];
  let row = [], cellv = '', inQ = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cellv += '"'; i++; } else inQ = false; }
      else cellv += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cellv); cellv = ''; }
    else if (ch === '\n') { row.push(cellv); rows.push(row); row = []; cellv = ''; }
    else if (ch !== '\r') cellv += ch;
  }
  if (cellv !== '' || row.length) { row.push(cellv); rows.push(row); }
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = Object.fromEntries(CSV_HEADERS.map((h) => [h, header.indexOf(h)]));
  if (idx.name === -1) return [];
  return rows.slice(1).map((cells) => {
    const g = (k) => (idx[k] >= 0 ? (cells[idx[k]] || '').trim() : '');
    const parts = (s, sep) => String(s || '').split(sep).map((x) => x.trim()).filter(Boolean);
    return {
      id: g('id') || null,
      name: g('name'), title: g('title'), company: g('company'),
      email: g('email'), phone: g('phone'), address: g('address'),
      homepage: g('homepage'), bio: g('bio'), youtube: g('youtube'),
      tags: parts(g('tags'), ';').map((t) => ({ tag: t })),
      careers: parts(g('careers'), ';;').map((x) => { const [a, ...r] = x.split('|'); return { period: a.trim(), desc: r.join('|').trim() }; }),
      links: parts(g('links'), ';;').map((x) => { const [a, ...r] = x.split('::'); return { title: a.trim(), url: r.join('::').trim() }; }),
      images: { photo: '', logo: '' },
      ownerId: g('ownerId') || null,
      createdAt: g('createdAt') || nowIso(),
      updatedAt: nowIso(),
    };
  }).filter((c) => c.name || c.phone);
}

function cardsToVcf(cards) {
  return cards.map((c) => {
    const L = ['BEGIN:VCARD', 'VERSION:3.0', `N:${c.name}`, `FN:${c.name}`];
    if (c.title) L.push(`TITLE:${c.title}`);
    if (c.company) L.push(`ORG:${c.company}`);
    if (c.phone) L.push(`TEL;TYPE=CELL:${c.phone}`);
    if (c.email) L.push(`EMAIL;TYPE=INTERNET:${c.email}`);
    if (c.homepage) L.push(`URL:${c.homepage}`);
    if (c.address) L.push(`ADR;TYPE=WORK:;;${String(c.address).replace(/[\r\n;]/g, ' ')}`);
    if (c.bio) L.push(`NOTE:${c.bio.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n')}`);
    if (c.tags?.length) L.push(`CATEGORIES:${c.tags.map((t) => t.tag).join(',')}`);
    if (c.links?.length) L.push(`X-CONTACTIFY-LINKS:${c.links.map((l) => `${l.title} :: ${l.url}`).join(' ;; ')}`);
    if (c.careers?.length) L.push(`X-CONTACTIFY-CAREERS:${c.careers.map((x) => `${x.period} | ${x.desc}`).join(' ;; ')}`);
    L.push('END:VCARD');
    return L.join('\r\n');
  }).join('\r\n');
}

function vcfToCards(text) {
  const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  return unfolded.split(/END:VCARD/i).filter((b) => /BEGIN:VCARD/i.test(b)).map((block) => {
    const props = {};
    for (const line of block.split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z-]+)(?:;([^:]*))?:(.*)$/);
      if (!m) continue;
      const key = m[1].toUpperCase();
      if (key === 'BEGIN') continue;
      (props[key] = props[key] || []).push(m[3].trim());
    }
    const first = (k) => (props[k] || [])[0] || '';
    const split2 = (s, sep) => String(s).split(sep).map((x) => x.trim()).filter(Boolean);
    return {
      id: null,
      name: first('FN') || first('N'),
      title: first('TITLE'),
      company: first('ORG').split(';')[0],
      phone: first('TEL'), email: first('EMAIL'),
      address: first('ADR').split(';').slice(2).join(' '),
      homepage: first('URL'),
      bio: first('NOTE').replace(/\\n/g, '\n'),
      youtube: '',
      tags: split2(first('CATEGORIES'), ',').map((t) => ({ tag: t })),
      careers: split2(first('X-CONTACTIFY-CAREERS'), ';;').map((x) => { const [a, ...r] = x.split('|'); return { period: a, desc: r.join('|') }; }),
      links: split2(first('X-CONTACTIFY-LINKS'), ';;').map((x) => { const [a, ...r] = x.split('::'); return { title: a, url: r.join('::') }; }),
      images: { photo: '', logo: '' },
      ownerId: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  }).filter((c) => c.name || c.phone || c.email);
}

function detectAndParse(text) {
  const t = (text || '').trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    const data = JSON.parse(t);
    const arr = Array.isArray(data) ? data : Array.isArray(data.cards) ? data.cards : null;
    if (!arr) throw new Error('JSON 구조를 인식할 수 없습니다');
    return arr;
  }
  if (/BEGIN:VCARD/i.test(t)) return vcfToCards(t);
  return csvToCards(t);
}

/* ==================== 라우팅 ==================== */
function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(ROOT, safePath === '/' ? 'index.html' : safePath);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('403 Forbidden'); }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(ROOT, 'index.html');
  const MIME = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.sql': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  };
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

function sendFile(res, filename, content, mime) {
  /* ASCII 폴백 + RFC 5987 (한글 파일명 대응) */
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename);
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
  });
  res.end(content);
}

async function handleApi(req, res) {
  const [pathname, query] = req.url.split('?');
  const parts = pathname.split('/').filter(Boolean); // ['api', ...]
  const [, resource, a, b] = parts;
  const method = req.method;
  const user = await getUserFromReq(req);

  /* ---------- ping ---------- */
  if (resource === 'ping') return sendJson(res, 200, { ok: true, ts: nowIso() });

  /* ---------- Google OAuth ---------- */
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
  const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

  if (resource === 'auth' && a === 'google') {
    /* GET /api/auth/google/start — 구글 로그인 시작 → 구글 동의 화면으로 리디렉션 */
    if (b === 'start' && method === 'GET') {
      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return jerr(res, 501, '구글 로그인이 설정되지 않았습니다 (GOOGLE_CLIENT_ID/SECRET 미설정)');
      const state = crypto.randomBytes(12).toString('hex');
      const redirect = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      redirect.searchParams.set('client_id', GOOGLE_CLIENT_ID);
      redirect.searchParams.set('redirect_uri', `${APP_URL}/api/auth/google/callback`);
      redirect.searchParams.set('response_type', 'code');
      redirect.searchParams.set('scope', 'openid email profile');
      redirect.searchParams.set('state', state);
      res.setHeader('Location', redirect.toString());
      res.writeHead(302);
      return res.end();
    }
    /* GET /api/auth/google/callback?code=... — 코드 교환 → 사용자 upsert → 해시 토큰으로 리디렉션 */
    if (b === 'callback' && method === 'GET') {
      const q = new URLSearchParams(query || '');
      const code = q.get('code');
      if (!code) { res.writeHead(302, { Location: `${APP_URL}/#google-error` }); res.end(); return; }
      try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            redirect_uri: `${APP_URL}/api/auth/google/callback`,
            grant_type: 'authorization_code',
          }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) throw new Error(tokenData.error_description || '토큰 교환 실패');
        const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const info = await infoRes.json();
        if (!info.sub) throw new Error('사용자 정보를 가져올 수 없습니다');
        const oauthUser = db.upsertOAuthUser({
          provider: 'google',
          providerId: info.sub,
          email: info.email,
          nickname: info.name || info.email?.split('@')[0],
        });
        const token = await issueToken(oauthUser.id);
        /* SPA 해시 콜백 — 해시는 서버로 전송되지 않으므로 토큰이 URL로 유출되지 않음 */
        res.writeHead(302, { Location: `${APP_URL}/#google-token=${token}` });
        return res.end();
      } catch (e) {
        console.error('Google OAuth callback error:', e.message);
        res.writeHead(302, { Location: `${APP_URL}/#google-error` });
        return res.end();
      }
    }
  }

  /* ---------- Auth ---------- */
  if (resource === 'auth' && a === 'signup' && method === 'POST') {
    const body = await readJson(req);
    const email = str(body.email, 120).trim().toLowerCase();
    const password = String(body.password || '');
    const nickname = str(body.nickname, 40).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jerr(res, 400, '올바른 이메일 주소를 입력해 주세요');
    if (password.length < 6) return jerr(res, 400, '비밀번호는 6자 이상이어야 합니다');
    if (await db.findUserByEmail(email)) return jerr(res, 409, '이미 가입된 이메일입니다');
    const newUser = db.insertUser({ email, passwordHash: hashPassword(password), nickname: nickname || email.split('@')[0] });
    const token = await issueToken(newUser.id);
    return sendJson(res, 201, { ok: true, user: { id: newUser.id, email: newUser.email, nickname: newUser.nickname }, token });
  }

  if (resource === 'auth' && a === 'login' && method === 'POST') {
    const body = await readJson(req);
    const email = str(body.email, 120).trim().toLowerCase();
    const u = await db.findUserByEmail(email);
    if (!u || !verifyPassword(body.password, u.password_hash)) return jerr(res, 401, '이메일 또는 비밀번호가 올바르지 않습니다');
    const token = await issueToken(u.id);
    return sendJson(res, 200, { ok: true, user: { id: u.id, email: u.email, nickname: u.nickname }, token });
  }

  if (resource === 'me' && method === 'GET') {
    if (!user) return jerr(res, 401, '로그인이 필요합니다');
    return sendJson(res, 200, { ok: true, user: { id: user.id, email: user.email, nickname: user.nickname }, token: null });
  }

  /* ---------- 이하: 인증 필요 ---------- */
  if (resource === 'cards' || resource === 'sync' || resource === 'import' || (resource || '').startsWith('export')) {
    if (!user) return jerr(res, 401, '로그인이 필요합니다');

    /* ---------- Sync (일괄 업로드) ---------- */
    if (resource === 'sync' && method === 'POST') {
      const body = await readJson(req);
      const incoming = Array.isArray(body.cards) ? body.cards : [];
      let saved = 0;
      for (const raw of incoming.slice(0, 200)) {
        const { card, errors } = sanitizeCard(raw);
        if (errors) continue;
        card.ownerId = user.id;
        const exist = await db.getCard(card.id, user.id);
        if (exist) {
          const it = Date.parse(card.updatedAt || 0), et = Date.parse(exist.updatedAt || exist.createdAt || 0);
          if (it >= et) { await db.updateCard(card, user.id); saved++; }
        } else {
          await db.insertCard(card, user.id); saved++;
        }
      }
      const total = (await db.listCards(user.id)).length;
      return sendJson(res, 200, { ok: true, saved, count: total });
    }

    /* ---------- Export (파일 다운로드) — /api/export[.json|.csv|.vcf] ---------- */
    if (method === 'GET' && (resource === 'export' || (resource || '').startsWith('export.'))) {
      const cards = await db.listCards(user.id);
      const ext = ((resource || 'export.json').split('.')[1] || 'json').toLowerCase();
      if (ext === 'csv') return sendFile(res, `contactify-${Date.now()}.csv`, cardsToCsv(cards), 'text/csv; charset=utf-8');
      if (ext === 'vcf') return sendFile(res, `contactify-${Date.now()}.vcf`, cardsToVcf(cards), 'text/vcard; charset=utf-8');
      return sendFile(res, `contactify-${Date.now()}.json`,
        JSON.stringify({ format: 'contactify-backup', version: 2, exportedAt: nowIso(), count: cards.length, cards }, null, 2),
        'application/json');
    }

    /* ---------- Import (JSON/CSV/vCard 텍스트 업로드) ---------- */
    if (resource === 'import' && method === 'POST') {
      const body = await readJson(req);
      let incoming;
      try { incoming = detectAndParse(String(body.text || '')); }
      catch (e) { return jerr(res, 400, e.message || '파일을 해석할 수 없습니다'); }
      if (!incoming.length) return jerr(res, 400, '가져올 명함 데이터가 없습니다');

      let added = 0, updated = 0;
      for (const raw of incoming.slice(0, 500)) {
        /* 가져오기는 전화번호 없는 연락처도 허용 */
        const { card, errors } = sanitizeCard(raw, { allowEmptyPhone: true });
        if (errors || !card || !card.name) continue;
        card.ownerId = user.id;
        const exist = card.id ? await db.getCard(card.id, user.id) : null;
        if (exist) {
          const it = Date.parse(card.updatedAt || 0), et = Date.parse(exist.updatedAt || exist.createdAt || 0);
          if (it >= et) { await db.updateCard(card, user.id); updated++; }
          else added++;
        } else {
          const created = await db.insertCard(card, user.id);
          if (created) added++;
        }
      }
      return sendJson(res, 200, { ok: true, added, updated, count: (await db.listCards(user.id)).length });
    }

    /* ---------- Cards ---------- */
    if (resource === 'cards') {
      /* 목록 */
      if (method === 'GET' && !a) {
        const cards = await db.listCards(user.id);
        return sendJson(res, 200, { ok: true, count: cards.length, cards });
      }
      /* 생성 */
      if (method === 'POST' && !a) {
        const body = await readJson(req);
        const { card, errors } = sanitizeCard(body);
        if (errors) return jerr(res, 400, errors.join(' '));
        card.ownerId = user.id;
        if (card.id && await db.getCard(card.id, user.id)) return jerr(res, 409, '이미 존재하는 명함 ID입니다');
        const created = await db.insertCard(card, user.id);
        return sendJson(res, 201, { ok: true, id: created.id, card: created });
      }
      /* 조회/수정/삭제 */
      if (a && method === 'GET') {
        if (b === 'vcf') {
          const card = await db.getCard(a, user.id);
          if (!card) return jerr(res, 404, '명함을 찾을 수 없습니다');
          return sendFile(res, `${(card.name || 'contact').replace(/[\r\n]/g, '')}.vcf`, cardsToVcf([card]), 'text/vcard; charset=utf-8');
        }
        const card = await db.getCard(a, user.id);
        return card ? sendJson(res, 200, { ok: true, card }) : jerr(res, 404, '명함을 찾을 수 없습니다');
      }
      if (a && method === 'PUT') {
        const body = await readJson(req);
        const { card, errors } = sanitizeCard(body);
        if (errors) return jerr(res, 400, errors.join(' '));
        if (!await db.getCard(a, user.id)) return jerr(res, 404, '명함을 찾을 수 없습니다');
        card.id = a;
        const updatedCard = await db.updateCard(card, user.id);
        return sendJson(res, 200, { ok: true, card: updatedCard });
      }
      if (a && method === 'DELETE') {
        return (await db.deleteCard(a, user.id))
          ? sendJson(res, 200, { ok: true })
          : jerr(res, 404, '명함을 찾을 수 없습니다');
      }
    }
  }

  return jerr(res, 404, 'Not found');
}

/* ---------- CORS (개발용) ---------- */
function withCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return true; }
  return false;
}

/* ---------- DB 초기화 (Turso 모드에서 원격 스키마 생성) ---------- */
if (typeof db.init === 'function') {
  Promise.resolve()
    .then(() => db.init())
    .then(() => console.log('  ✅ DB 초기화 완료'))
    .catch((e) => {
      console.error('  ⚠️ DB 초기화 실패:', e.message);
      process.exit(1);
    });
}

/* ---------- Server ---------- */
const server = http.createServer(async (req, res) => {
  try {
    if (withCors(req, res)) return;
    if (req.url.startsWith('/api/')) await handleApi(req, res);
    else serveStatic(req, res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) jerr(res, 500, e.message || 'Server error');
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('  📇 Contactify server');
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  → API: /api/auth/*  /api/cards  /api/sync  /api/export.*  /api/import`);
  console.log('');
});
