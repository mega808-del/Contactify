/* ============================================================
   Contactify — Sync · Auth · Cloud (js/sync.js)
   ------------------------------------------------------------
   - 사용자 계정(회원가입/로그인) + 사용자별 중앙 DB 동기화
   - 서버 미가동 시 "데모 모드"로 로컬만 동작 (기능 저하 없음)
   - 다중 명함 덱(deck) 로컬 저장소 + 공용 유틸(CT 네임스페이스)
   ============================================================ */
'use strict';

window.CT = window.CT || {};

(() => {
  const KEY_CARDS = 'contactify.cards.v2';   // 다중 명함 덱
  const KEY_SESSION = 'contactify.session.v2';
  CT.KEYS = { cards: KEY_CARDS, session: KEY_SESSION };

  /* ------------------ 공용 유틸 ------------------ */
  CT.$ = (sel) => document.querySelector(sel);

  CT.esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  CT.safeUrl = (raw) => {
    const s = (raw || '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    if (/^javascript:/i.test(s) || /[\s<>"]/.test(s)) return '';
    return 'https://' + s;
  };

  CT.telHref = (raw) => {
    const digits = (raw || '').replace(/[^\d+]/g, '');
    if (!digits) return '';
    return `tel:${digits.replace(/\+/g, '%2B')}`;
  };

  CT.ytEmbed = (url) => {
    const s = (url || '').trim();
    const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i);
    return m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : '';
  };

  CT.uid = () => `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  CT.download = (filename, content, mime) => {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  };

  CT.csvCell = (v) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  /* ------------------ 토스트 ------------------ */
  let toastTimer;
  CT.toast = (msg) => {
    const t = document.getElementById('toast');
    if (!t) return alert(msg);
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  };

  /* ------------------ 로컬 저장소 (덱 + 세션) ------------------ */
  CT.store = {
    getCards() {
      try {
        const arr = JSON.parse(localStorage.getItem(KEY_CARDS) || '[]');
        return Array.isArray(arr) ? arr : [];
      } catch { return []; }
    },
    setCards(cards) {
      try {
        localStorage.setItem(KEY_CARDS, JSON.stringify(cards));
        return true;
      } catch {
        CT.toast('⚠️ 저장 실패: 브라우저 용량 초과 (이미지를 줄여 주세요)');
        return false;
      }
    },
    getSession() {
      try { return JSON.parse(localStorage.getItem(KEY_SESSION) || 'null'); }
      catch { return null; }
    },
    setSession(s) {
      if (s) localStorage.setItem(KEY_SESSION, JSON.stringify(s));
      else localStorage.removeItem(KEY_SESSION);
    },
  };

  /* ============================================================
     Auth — 회원가입 / 로그인 (서버 or 데모 모드)
     ============================================================ */
  const auth = {
    user: null,    // { id, email, nickname }
    online: null,  // null=확인 전, true=서버 연동, false=데모(오프라인)

    token() { return CT.store.getSession()?.token || null; },

    headers() {
      const h = { 'Content-Type': 'application/json' };
      const t = this.token();
      if (t) h.Authorization = `Bearer ${t}`;
      return h;
    },

    /* 서버 생존 확인 + 세션 복원 */
    async init() {
      this.online = await pingServer();
      const saved = CT.store.getSession();
      if (saved?.user) {
        this.user = saved.user;
        if (this.online) {
          const me = await this.me();
          if (!me) { /* 토큰 만료 → 세션 정리 */
            this.user = null;
            CT.store.setSession(null);
          } else {
            /* 세션 복원 시에도 자동 동기화 (새 기기에서 로그인만 하면 동기화) */
            try {
              const r = await CT.sync.syncDown();
              if (typeof CT.onRestoredSync === 'function') CT.onRestoredSync(r);
              else CT._restoredSync = r;
            } catch { /* 조용히 무시 */ }
          }
        }
      }
      renderAuthArea();
    },

    async me() {
      try {
        const res = await fetch('/api/me', { headers: this.headers() });
        if (res.status === 401) { CT.store.setSession(null); return null; }
        if (!res.ok) return null;
        const data = await res.json();
        this.saveSession(data.user, data.token || this.token());
        return this.user;
      } catch {
        return this.user; /* 네트워크 단절 시 기존 세션 유지 */
      }
    },

    async signup(email, password, nickname) {
      email = (email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('올바른 이메일 주소를 입력해 주세요');
      if ((password || '').length < 6) throw new Error('비밀번호는 6자 이상이어야 합니다');

      if (!this.online) return this.demoLogin(email, nickname);

      const res = await fetch('/api/auth/signup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, nickname }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '회원가입에 실패했습니다');
      this.saveSession(data.user, data.token);
      renderAuthArea();
      return this.user;
    },

    async login(email, password) {
      email = (email || '').trim().toLowerCase();
      if (!email || !password) throw new Error('이메일과 비밀번호를 입력해 주세요');

      if (!this.online) return this.demoLogin(email);

      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '로그인에 실패했습니다');
      this.saveSession(data.user, data.token);
      renderAuthArea();
      return this.user;
    },

    /* 서버 없이 실행될 때: 로컬 전용 계정 (비밀번호 미저장) */
    async demoLogin(email, nickname) {
      this.user = {
        id: 'u_demo_' + hashCode(email),
        email,
        nickname: (nickname || '').trim() || email.split('@')[0],
        demo: true,
      };
      CT.store.setSession({ user: this.user, token: 'demo-token' });
      renderAuthArea();
      return this.user;
    },

    saveSession(user, token) {
      this.user = user;
      CT.store.setSession({ user, token });
    },

    logout() {
      this.user = null;
      CT.store.setSession(null);
      renderAuthArea();
      CT.toast('로그아웃되었습니다 — 명함은 이 기기에 그대로 남아 있어요');
    },
  };
  CT.auth = auth;

  function hashCode(s) {
    let h = 0;
    for (let i = 0; i < (s || '').length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
    return Math.abs(h).toString(36);
  }

  async function pingServer() {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch('/api/ping', { signal: ctrl.signal });
      clearTimeout(timer);
      return res.ok;
    } catch { return false; }
  }

  /* ============================================================
     Sync — 클라우드 업/다운 (충돌은 updatedAt 최신 우선)
     ============================================================ */
  const sync = {
    /* 서버로 전체 푸시 (기본: 내 명함으로 서버 대체) */
    async pushAll(cards) {
      const res = await fetch('/api/sync', {
        method: 'POST', headers: auth.headers(),
        body: JSON.stringify({ cards }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '동기화에 실패했습니다');
      return data;
    },

    /* 서버에서 목록 내려받기 */
    async pull() {
      const res = await fetch('/api/cards', { headers: auth.headers() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '불러오기에 실패했습니다');
      return data.cards || [];
    },

    /* 새 기기: 로그인 → 서버 목록을 로컬에 병합 */
    async syncDown() {
      if (!auth.user) throw new Error('로그인이 필요합니다');
      if (!auth.online) throw new Error('서버에 연결할 수 없어요 (데모 모드)');
      const serverCards = await this.pull();
      return mergeServerCards(serverCards);
    },

    /* 지금 동기화: 로컬을 서버에 올리고, 최신 병합 결과를 내려받음 */
    async syncNow() {
      if (!auth.user) throw new Error('로그인이 필요합니다');
      if (!auth.online) throw new Error('서버에 연결할 수 없어요 (데모 모드)');
      await this.pushAll(CT.store.getCards());
      const r = await this.syncDown();
      return r;
    },
  };
  CT.sync = sync;

  /* id 기준 병합 — updatedAt 이 최신인 쪽으로 덮어쓰기 */
  async function mergeServerCards(serverCards) {
    const local = CT.store.getCards();
    const byId = new Map(local.map((c) => [c.id, c]));
    let added = 0, updated = 0;
    for (const s of serverCards) {
      if (!s?.id) continue;
      const l = byId.get(s.id);
      if (!l) { byId.set(s.id, s); added++; continue; }
      const st = Date.parse(s.updatedAt || s.createdAt || 0);
      const lt = Date.parse(l.updatedAt || l.createdAt || 0);
      if (st >= lt) { byId.set(s.id, s); updated++; }
    }
    const merged = [...byId.values()];
    CT.store.setCards(merged);
    return { cards: merged, added, updated };
  }
  CT.mergeServerCards = mergeServerCards;

  /* 로그인 직후 앱 쪽 후크 (app.js 가 설정) */
  CT.onAuthed = null;

  /* ============================================================
     UI — 헤더 인증 영역 + 로그인 모달
     ============================================================ */
  function renderAuthArea() {
    const area = document.getElementById('authArea');
    if (!area) return;
    if (auth.user) {
      const name = auth.user.nickname || auth.user.email.split('@')[0];
      const demo = auth.user.demo || auth.online === false;
      area.innerHTML = `
        <span class="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300 sm:inline-flex">
          <span class="h-1.5 w-1.5 rounded-full ${demo ? 'bg-amber-400' : 'bg-emerald-400'}"></span>${CT.esc(name)}${demo ? ' · 데모' : ''}
        </span>
        <button type="button" id="btnSyncNow" title="지금 동기화" class="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm transition hover:bg-white/10">🔄</button>
        <button type="button" id="btnLogout" title="로그아웃" class="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm transition hover:bg-white/10">⏻</button>`;
      document.getElementById('btnSyncNow').addEventListener('click', async () => {
        try {
          const r = await sync.syncNow();
          CT.toast(`✅ 동기화 완료 — 서버 ${r.count ?? r.cards.length}장 · 새로 ${r.added}장 / 갱신 ${r.updated}장`);
          if (typeof CT.onSynced === 'function') CT.onSynced(r.cards);
        } catch (e) { CT.toast(`⚠️ ${e.message}`); }
      });
      document.getElementById('btnLogout').addEventListener('click', () => auth.logout());
    } else {
      area.innerHTML = `
        <button type="button" id="btnOpenAuth" class="rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 transition hover:-translate-y-0.5">로그인 / 회원가입</button>`;
      document.getElementById('btnOpenAuth').addEventListener('click', () => openAuthModal('login'));
    }
  }
  CT.renderAuthArea = renderAuthArea;

  const modal = {
    el: null, form: null, mode: 'login',
    open(mode = 'login') {
      this.mode = mode;
      this.el.classList.remove('hidden');
      this.el.classList.add('flex');
      setMode(mode);
      document.getElementById('authEmail').focus();
    },
    close() {
      this.el.classList.add('hidden');
      this.el.classList.remove('flex');
      document.getElementById('authError').classList.add('hidden');
      this.form.reset();
    },
  };

  function setMode(mode) {
    modal.mode = mode;
    const isSignup = mode === 'signup';
    document.getElementById('authNicknameField').classList.toggle('hidden', !isSignup);
    document.getElementById('btnAuthSubmit').textContent = isSignup ? '회원가입' : '로그인';
    document.getElementById('tabLogin').className = 'auth-tab rounded-lg py-2 transition ' + (isSignup ? 'text-slate-400' : 'bg-white/10 text-white');
    document.getElementById('tabSignup').className = 'auth-tab rounded-lg py-2 transition ' + (isSignup ? 'bg-white/10 text-white' : 'text-slate-400');
    document.getElementById('authPassword').autocomplete = isSignup ? 'new-password' : 'current-password';
  }

  function openAuthModal(mode) { modal.open(mode); }

  function showAuthError(msg) {
    const p = document.getElementById('authError');
    p.textContent = msg;
    p.classList.remove('hidden');
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('btnAuthSubmit');
    btn.disabled = true;
    btn.classList.add('opacity-60');
    try {
      const email = document.getElementById('authEmail').value;
      const password = document.getElementById('authPassword').value;
      const nickname = document.getElementById('authNickname').value;
      const user = modal.mode === 'signup'
        ? await auth.signup(email, password, nickname)
        : await auth.login(email, password);
      modal.close();
      CT.toast(auth.online ? `✅ ${user.nickname || user.email}님, 환영합니다!` : '✅ 로그인 (데모 모드 — 서버 미연동)');
      if (typeof CT.onAuthed === 'function') await CT.onAuthed(user);
    } catch (err) {
      showAuthError(err.message || '오류가 발생했습니다');
    } finally {
      btn.disabled = false;
      btn.classList.remove('opacity-60');
    }
  }

  /* ============================================================
     Google OAuth — 서버 302 콜백 → 해시 토큰 수신 → 세션 저장
     (해시는 서버에 전송되지 않으므로 토큰이 서버 로그/리퍼러에 남지 않음)
     ============================================================ */
  function handleGoogleCallback() {
    const h = location.hash || '';
    const tm = h.match(/#google-token=([A-Za-z0-9]+)/);
    const em = h.match(/#google-error/);
    if (!tm && !em) return false;

    /* URL 정리 (새로고침 시 재사용 방지) */
    history.replaceState(null, '', location.pathname + location.search);

    if (tm) {
      const token = tm[1];
      fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('토큰 검증 실패'))))
        .then((data) => {
          auth.saveSession(data.user, token);
          renderAuthArea();
          CT.toast(`✅ ${data.user.nickname || data.user.email}님, 환영합니다! (구글)`);
          if (typeof CT.onAuthed === 'function') CT.onAuthed(data.user);
          return CT.sync.syncDown().then((r) => {
            if (typeof CT.onSynced === 'function') CT.onSynced(r.cards);
          });
        })
        .catch(() => CT.toast('⚠️ 구글 로그인 처리 중 오류가 발생했습니다'));
    } else {
      CT.toast('⚠️ 구글 로그인에 실패했습니다. 다시 시도해 주세요');
    }
    return true;
  }

  /* ------------------ init ------------------ */
  document.addEventListener('DOMContentLoaded', async () => {
    modal.el = document.getElementById('authModal');
    modal.form = document.getElementById('authForm');

    document.getElementById('btnAuthClose').addEventListener('click', () => modal.close());
    modal.el.addEventListener('click', (e) => { if (e.target === modal.el) modal.close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.el.classList.contains('hidden')) modal.close(); });
    document.getElementById('tabLogin').addEventListener('click', () => setMode('login'));
    document.getElementById('tabSignup').addEventListener('click', () => setMode('signup'));
    modal.form.addEventListener('submit', handleAuthSubmit);

    const googleBtn = document.getElementById('btnGoogleLogin');
    if (googleBtn) {
      googleBtn.addEventListener('click', () => {
        if (auth.online === false) { CT.toast('⚠️ 구글 로그인은 서버 연결 시에만 사용할 수 있어요'); return; }
        location.href = '/api/auth/google/start';
      });
    }

    /* 구글 콜백이 먼저면 모달/초기화 흐름 건너뛰지 않고 자연 처리 */
    const handled = handleGoogleCallback();

    await auth.init();
  });
})();
