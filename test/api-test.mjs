/* Contactify API 통합 테스트 — node test/api-test.mjs (서버 실행 중이어야 함) */
'use strict';

const BASE = 'http://localhost:3000';
let pass = 0, fail = 0;
const ok = (cond, name) => {
  if (cond) { pass++; console.log(`  \u2705 ${name}`); }
  else { fail++; console.log(`  \u274c ${name}`); }
};

const email = `t${Date.now()}@example.com`;
let token = '';

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* 파일 응답 등 */ }
  return { status: res.status, data, headers: res.headers };
}

/* ---------- Auth ---------- */
{
  const r = await api('/api/ping');
  ok(r.status === 200, 'GET /api/ping');

  const su = await api('/api/auth/signup', { method: 'POST', auth: false, body: { email, password: '123456', nickname: '길동' } });
  ok(su.status === 201 && su.data.ok, 'POST /api/auth/signup (201, token 발급)');
  token = su.data.token;
  ok(su.data.user?.nickname === '길동', '한글 닉네임 무손상');
  ok((su.data.user?.id || '').startsWith('u_'), 'user.id 발급 (u_*)');

  const dup = await api('/api/auth/signup', { method: 'POST', auth: false, body: { email, password: '123456' } });
  ok(dup.status === 409, '중복 이메일 회원가입 → 409');

  const bad = await api('/api/auth/signup', { method: 'POST', auth: false, body: { email: 'bad', password: '1' } });
  ok(bad.status === 400, '잘못된 가입 입력 → 400');

  const li = await api('/api/auth/login', { method: 'POST', auth: false, body: { email, password: '123456' } });
  ok(li.status === 200 && li.data.token, '로그인 성공 (token 재발급)');

  const wrong = await api('/api/auth/login', { method: 'POST', auth: false, body: { email, password: 'wrong' } });
  ok(wrong.status === 401, '잘못된 비밀번호 → 401');

  const me = await api('/api/me');
  ok(me.status === 200 && me.data.user?.email === email, 'GET /api/me (토큰 검증)');

  const noAuth = await api('/api/me', { auth: false });
  ok(noAuth.status === 401, '토큰 없이 /api/me → 401');
}

/* ---------- Cards CRUD ---------- */
let cardId = '';
{
  const noAuth = await api('/api/cards', { auth: false });
  ok(noAuth.status === 401, '토큰 없이 /api/cards → 401');

  const c = await api('/api/cards', {
    method: 'POST',
    body: {
      name: '홍길동', phone: '010-1234-5678', address: '서울시 강남구 테헤란로 123',
      title: '디자이너', company: 'Contactify', email: 'hong@ex.com',
      tags: [{ tag: 'UX' }, { tag: '브랜딩' }],
      careers: [{ period: '2021~현재', desc: 'ABC 컴퍼니' }],
      links: [{ title: '포트폴리오', url: 'https://ex.com' }],
    },
  });
  ok(c.status === 201 && c.data.ok, '명함 생성 (201)');
  cardId = c.data.id;
  ok(c.data.card?.address === '서울시 강남구 테헤란로 123', '주소 저장 무손상');
  ok(c.data.card?.tags?.length === 2 && c.data.card?.tags[0].tag === 'UX', '태그 저장');
  ok(c.data.card?.links?.[0]?.url === 'https://ex.com', '링크 저장');

  const inv = await api('/api/cards', { method: 'POST', body: { name: '', phone: '' } });
  ok(inv.status === 400, '필수값 누락 → 400');

  const one = await api(`/api/cards/${cardId}`);
  ok(one.status === 200 && one.data.card.name === '홍길동', '명함 단건 조회');

  const up = await api(`/api/cards/${cardId}`, { method: 'PUT', body: { name: '홍길순', phone: '010-9999-8888', address: '부산시 해운대구' } });
  ok(up.status === 200 && up.data.card.name === '홍길순' && up.data.card.address === '부산시 해운대구', '명함 수정 (PUT)');

  const vcf = await fetch(`${BASE}/api/cards/${cardId}/vcf`, { headers: { Authorization: `Bearer ${token}` } });
  const vcfText = await vcf.text();
  ok(vcf.status === 200 && vcfText.includes('BEGIN:VCARD') && vcfText.includes('홍길순'), '단건 vCard 다운로드');
}

/* ---------- Sync ---------- */
{
  const s = await api('/api/sync', {
    method: 'POST',
    body: {
      cards: [
        { id: 'c_sync_a', name: '김철수', phone: '010-1111-2222', updatedAt: new Date().toISOString() },
        { id: cardId, name: '구버전이름', phone: '010-0000-0000', updatedAt: '2020-01-01T00:00:00Z' },
      ],
    },
  });
  ok(s.status === 200 && s.data.ok && s.data.saved === 1, 'sync 일괄 업로드 (신규만 반영, 구버전 무시)');

  const list = await api('/api/cards');
  ok(list.status === 200 && list.data.count === 2, 'sync 후 목록 count=2');
  const kept = list.data.cards.find((c) => c.id === cardId);
  ok(kept?.name === '홍길순', 'updatedAt 최신 우선 병합 (구버전으로 덮어쓰기 안 됨)');
}

/* ---------- Export ---------- */
{
  const j = await fetch(`${BASE}/api/export.json`, { headers: { Authorization: `Bearer ${token}` } });
  const jText = await j.text();
  ok(j.status === 200 && jText.includes('contactify-backup') && jText.includes('홍길순'), 'GET /api/export.json');

  const csv = await fetch(`${BASE}/api/export.csv`, { headers: { Authorization: `Bearer ${token}` } });
  const csvText = await csv.text();
  ok(csv.status === 200 && csvText.includes('name,title,company') && csvText.includes('홍길순'), 'GET /api/export.csv (헤더+데이터)');

  const vcf = await fetch(`${BASE}/api/export.vcf`, { headers: { Authorization: `Bearer ${token}` } });
  const vcfText = await vcf.text();
  ok(vcf.status === 200 && vcfText.split('BEGIN:VCARD').length - 1 === 2, 'GET /api/export.vcf (2장)');

  const noExp = await api('/api/export.json', { auth: false });
  ok(noExp.status === 401, '토큰 없이 export → 401');
}

/* ---------- Import ---------- */
{
  const csvText = 'id,ownerId,name,title,company,email,phone,address,homepage,bio,tags,careers,links,youtube,createdAt,updatedAt\n,,이유리,매니저,XYZ,,010-2222-3333,서울시 종로구,,,,,,,\n';
  const imp = await api('/api/import', { method: 'POST', body: { text: csvText, format: 'csv' } });
  ok(imp.status === 200 && imp.data.added === 1, 'CSV import (1장 추가)');

  const vcfText = ['BEGIN:VCARD', 'VERSION:3.0', 'N:박민수', 'FN:박민수', 'TEL;TYPE=CELL:010-5555-6666', 'ADR;TYPE=WORK:;;대전시 둔산로 50', 'END:VCARD', ''].join('\r\n');
  const imp2 = await api('/api/import', { method: 'POST', body: { text: vcfText } });
  ok(imp2.status === 200 && imp2.data.added === 1, 'vCard import (1장 추가)');

  const list = await api('/api/cards');
  ok(list.status === 200 && list.data.count === 4, 'import 후 총 4장');
  const yuri = list.data.cards.find((c) => c.name === '이유리');
  ok(yuri?.address === '서울시 종로구', 'CSV 주소 열 정상 반영');

  const bad = await api('/api/import', { method: 'POST', body: { text: 'not-a-backup' } });
  ok(bad.status === 400, '형식 불명 import → 400');
}

/* ---------- 사용자 격리 & 삭제 ---------- */
{
  const su2 = await api('/api/auth/signup', { method: 'POST', auth: false, body: { email: `u2${Date.now()}@ex.com`, password: '123456' } });
  const token2 = su2.data.token;
  const res = await fetch(`${BASE}/api/cards`, { headers: { Authorization: `Bearer ${token2}` } });
  const other = await res.json();
  ok(other.count === 0, '다른 사용자는 내 명함을 볼 수 없음 (user_id 격리)');

  const del = await api(`/api/cards/${cardId}`, { method: 'DELETE' });
  ok(del.status === 200 && del.data.ok, '명함 삭제');

  const gone = await api(`/api/cards/${cardId}`);
  ok(gone.status === 404, '삭제 후 조회 → 404');
}

console.log(`\n  결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
