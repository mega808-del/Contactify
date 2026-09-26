/* ============================================================
   Contactify — App Logic (js/app.js)
   ------------------------------------------------------------
   - 다중 명함 덱(deck) 관리 + 편집/렌더/라우팅
   - 저장: 로컬(LocalStorage) + 로그인 시 서버 동기화
   - js/sync.js · js/backup.js 위에서 동작
   ============================================================ */
'use strict';

/* ---------- 엘리먼트 ---------- */
const $ = CT.$;
const el = {
  editorView: $('#editorView'), viewView: $('#viewView'), deckSection: $('#deckSection'),
  form: $('#cardForm'), inpName: $('#inpName'), inpTitle: $('#inpTitle'),
  inpCompany: $('#inpCompany'), inpEmail: $('#inpEmail'), inpPhone: $('#inpPhone'),
  inpHomepage: $('#inpHomepage'), inpAddress: $('#inpAddress'), inpBio: $('#inpBio'),
  bioCount: $('#bioCount'), inpTag: $('#inpTag'), tagWrap: $('#tagWrap'),
  tagPlaceholder: $('#tagPlaceholder'), btnAddTag: $('#btnAddTag'),
  careerList: $('#careerList'), inpYoutube: $('#inpYoutube'), btnYoutube: $('#btnYoutube'),
  ytPreviewWrap: $('#ytPreviewWrap'), ytFrame: $('#ytFrame'),
  inpLinkTitle: $('#inpLinkTitle'), inpLinkUrl: $('#inpLinkUrl'), btnAddLink: $('#btnAddLink'),
  linkList: $('#linkList'), headerBrand: $('#header-brand'), toast: $('#toast'),
  card: $('#card'), vLogo: $('#vLogo'), vPhoto: $('#vPhoto'), vPhotoFallback: $('#vPhotoFallback'),
  vName: $('#vName'), vRole: $('#vRole'), vCompany: $('#vCompany'), vBio: $('#vBio'),
  vTags: $('#vTags'), vTel: $('#vTel'), vTelText: $('#vTelText'),
  vEmail: $('#vEmail'), vEmailText: $('#vEmailText'),
  vHomepage: $('#vHomepage'), vHomepageText: $('#vHomepageText'),
  vAddressRow: $('#vAddressRow'), vAddress: $('#vAddress'),
  vCareerWrap: $('#vCareerWrap'), vCareerList: $('#vCareerList'),
  vLinksWrap: $('#vLinksWrap'), vLinks: $('#vLinks'),
  vVideoWrap: $('#vVideoWrap'), vYtFrame: $('#vYtFrame'),
  mvView: $('#mvView'), mvTel: $('#mvTel'), mvTelText: $('#mvTelText'),
  mvAddress: $('#mvAddress'), mvCompany: $('#mvCompany'), mvEmail: $('#mvEmail'),
  mvEmailLink: $('#mvEmailLink'), mvHomepage: $('#mvHomepage'), mvHomepageLink: $('#mvHomepageLink'),
  mvTitle: $('#mvTitle'), mvBio: $('#mvBio'), mvTags: $('#mvTags'),
  mvCareers: $('#mvCareers'), mvLinks: $('#mvLinks'),
  mobileHideGrid: $('#mobileHideGrid'), btnMvAll: $('#btnMvAll'), btnMvEssential: $('#btnMvEssential'),
  deckGrid: $('#deckGrid'), deckCount: $('#deckCount'), deckEmpty: $('#deckEmpty'),
};

/* ---------- 표시 항목 설정 (숨김 그리드) ----------
 * 인라인 hide-check 체크박스들과 같은 소스(card.hidden)를 읽고 쓰는 또 다른 UI.
 * 체크 = 그 항목을 명함에서 숨김 (PC·모바일 공통). 이름·전화번호는 항상 표시.
 */
const HIDE_ITEMS = [
  { key: 'title',    label: '💼 직책' },
  { key: 'company',  label: '🏢 회사명' },
  { key: 'email',    label: '✉️ 이메일' },
  { key: 'homepage', label: '🌐 홈페이지' },
  { key: 'address',  label: '📍 주소' },
  { key: 'bio',      label: '📝 자기소개' },
  { key: 'tags',     label: '🏷️ 태그' },
  { key: 'careers',  label: '📅 이력' },
  { key: 'links',    label: '🔗 커스텀 링크' },
];
const HIDE_ESSENTIAL = ['title', 'company', 'email', 'homepage'];   /* 추천: 모바일에서 자주 안 쓰는 항목만 숨김 */

/* 인라인 hide-check → 설정 그리드 체크 상태 반영 */
function syncGridFromInline() {
  document.querySelectorAll('#mobileHideGrid input[data-hide]').forEach((cb) => {
    const inline = document.querySelector(`#cardForm .hide-check[data-hide="${cb.dataset.hide}"]`);
    if (inline) cb.checked = inline.checked;
  });
}
/* 설정 그리드 → 인라인 hide-check 체크 상태 반영 */
function syncInlineFromGrid() {
  document.querySelectorAll('#mobileHideGrid input[data-hide]').forEach((cb) => {
    const inline = document.querySelector(`#cardForm .hide-check[data-hide="${cb.dataset.hide}"]`);
    if (inline) inline.checked = cb.checked;
  });
}
function renderMobileHideGrid() {
  if (!el.mobileHideGrid) return;
  el.mobileHideGrid.innerHTML = HIDE_ITEMS.map((it) => `
    <label class="flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-xs font-medium text-slate-300 transition hover:border-indigo-400/40">
      <input type="checkbox" data-hide="${it.key}" class="accent-indigo-500">
      <span>${it.label}</span>
    </label>`).join('');
  /* 그리드 체크 변경 → 인라인 동기화 */
  el.mobileHideGrid.addEventListener('change', (e) => {
    if (e.target.matches('input[data-hide]')) syncInlineFromGrid();
  });
}

/* ---------- 상태 ---------- */
const state = {
  deck: [],        // 저장된 명함 목록 (로컬 + 서버 동기화)
  editingId: null, // 현재 편집 중인 명함 id (null = 신규)
  viewId: null,    // 현재 보고 있는 명함 id
  tags: [], careers: [], links: [],
  images: { photo: '', logo: '' },
  hidden: {},      // { title:true, ... } — 명함에서 숨길 항목 (이름·전화번호 제외)
};

/* 숨김 체크박스 키 ↔ 명함 데이터 키 매핑 (이름·전화번호는 항상 표시) */
const HIDDEN_KEYS = ['title', 'company', 'email', 'homepage', 'address', 'bio', 'tags', 'careers', 'links', 'youtube', 'photo', 'logo'];

function readHidden() {
  const out = {};
  document.querySelectorAll('#cardForm .hide-check').forEach((cb) => {
    if (cb.checked && HIDDEN_KEYS.includes(cb.dataset.hide)) out[cb.dataset.hide] = true;
  }, true);
  return out;
}
function fillHidden(hidden) {
  const h = hidden || {};
  document.querySelectorAll('#cardForm .hide-check').forEach((cb) => {
    cb.checked = !!h[cb.dataset.hide];
  });
}

/* ---------- 덱(로컬) 기본 함수 ---------- */
CT.getDeck = () => state.deck.slice();

function loadDeck() {
  state.deck = CT.store.getCards();
  renderDeck();
}
function saveDeck() {
  CT.store.setCards(state.deck);
  renderDeck();
}
function upsertLocal(card) {
  const i = state.deck.findIndex((c) => c.id === card.id);
  if (i >= 0) state.deck[i] = card; else state.deck.unshift(card);
  saveDeck();
}

/* 서버 저장 (로그인 & 온라인일 때만, 실패는 조용히) */
async function pushToServer(card, isNew) {
  if (!CT.auth.user || !CT.auth.online) return false;
  try {
    await fetch(isNew ? '/api/cards' : `/api/cards/${card.id}`, {
      method: isNew ? 'POST' : 'PUT',
      headers: CT.auth.headers(),
      body: JSON.stringify(card),
    });
    return true;
  } catch { return false; }
}

/* ============================================================
   편집 폼 ↔ 데이터
   ============================================================ */
function readForm() {
  return {
    name: el.inpName.value.trim(), title: el.inpTitle.value.trim(),
    company: el.inpCompany.value.trim(), email: el.inpEmail.value.trim(),
    phone: el.inpPhone.value.trim(), homepage: el.inpHomepage.value.trim(),
    address: el.inpAddress.value.trim(), bio: el.inpBio.value.trim(),
    youtube: el.inpYoutube.value.trim(),
  };
}
function fillForm(d) {
  el.inpName.value = d.name || ''; el.inpTitle.value = d.title || '';
  el.inpCompany.value = d.company || ''; el.inpEmail.value = d.email || '';
  el.inpPhone.value = d.phone || ''; el.inpHomepage.value = d.homepage || '';
  el.inpAddress.value = d.address || ''; el.inpBio.value = d.bio || '';
  el.inpYoutube.value = d.youtube || '';
  el.bioCount.textContent = String(el.inpBio.value.length);
  if (d.youtube && CT.ytEmbed(d.youtube)) showYtPreview();
}
function fillEditorDynamic() {
  renderTags();
  el.careerList.innerHTML = '';
  if (state.careers.length) state.careers.forEach((c) => addCareerRow(c.period, c.desc));
  else addCareerRow();
  renderLinksEditor();
}

function buildCard() {
  const now = new Date().toISOString();
  const exist = state.editingId ? state.deck.find((c) => c.id === state.editingId) : null;
  return CT.sanitizeCard({
    ...(exist || {}),
    ...readForm(),
    id: state.editingId || CT.uid(),
    tags: state.tags.map((tag) => ({ tag })), /* 문자열 → {id, tag} */
    careers: collectCareers(),
    links: state.links,
    images: { ...state.images },
    hidden: readHidden(),
    createdAt: exist?.createdAt || now,
    updatedAt: now,
    ownerId: CT.auth.user?.id ?? null,
  });
}

function applyToEditor(card) {
  state.editingId = card?.id || null;
  state.tags = (card?.tags || []).map((t) => t.tag);
  state.careers = (card?.careers || []).map((c) => ({ ...c }));
  state.links = (card?.links || []).map((l) => ({ ...l }));
  state.images = { photo: card?.images?.photo || '', logo: card?.images?.logo || '' };
  fillHidden(card?.hidden);
  /* 설정 그리드도 인라인 체크 상태와 동기화 */
  syncGridFromInline();
  fillForm(card || {});
  restoreImagePreviews();
  fillEditorDynamic();
}

function restoreImagePreviews() {
  ['photo', 'logo'].forEach((key) => {
    const input = document.getElementById(key === 'photo' ? 'inpPhoto' : 'inpLogo');
    const box = input.closest('.upload-box');
    const preview = box.querySelector('.upload-preview');
    const empty = box.querySelector('.upload-empty');
    const img = preview.querySelector('img');
    if (state.images[key]) {
      img.src = state.images[key];
      preview.classList.remove('hidden'); preview.classList.add('flex');
      empty.classList.add('hidden');
      box.classList.add('has-image');
    } else {
      img.src = ''; input.value = '';
      preview.classList.add('hidden'); preview.classList.remove('flex');
      empty.classList.remove('hidden');
      box.classList.remove('has-image');
    }
  });
}

/* ============================================================
   이미지 업로드
   ============================================================ */
function setupImageUpload(fileInputId) {
  const input = document.getElementById(fileInputId);
  const box = input.closest('.upload-box');
  const empty = box.querySelector('.upload-empty');
  const preview = box.querySelector('.upload-preview');
  const img = preview.querySelector('img');
  const key = fileInputId === 'inpPhoto' ? 'photo' : 'logo';

  const apply = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 2.5 * 1024 * 1024) { CT.toast('이미지는 2.5MB 이하로 업로드해 주세요'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      state.images[key] = reader.result;
      img.src = reader.result;
      empty.classList.add('hidden');
      preview.classList.remove('hidden'); preview.classList.add('flex');
      box.classList.add('has-image');
    };
    reader.readAsDataURL(file);
  };
  input.addEventListener('change', () => apply(input.files[0]));
  box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('dragover'); });
  box.addEventListener('dragleave', () => box.classList.remove('dragover'));
  box.addEventListener('drop', (e) => { e.preventDefault(); box.classList.remove('dragover'); apply(e.dataTransfer.files[0]); });
  preview.querySelector('.remove-image').addEventListener('click', () => {
    state.images[key] = ''; input.value = ''; img.src = '';
    preview.classList.add('hidden'); preview.classList.remove('flex');
    empty.classList.remove('hidden');
    box.classList.remove('has-image');
  });
}

/* ============================================================
   태그
   ============================================================ */
function renderTags() {
  el.tagWrap.querySelectorAll('.tag-chip').forEach((c) => c.remove());
  el.tagPlaceholder.style.display = state.tags.length ? 'none' : '';
  state.tags.forEach((tag, i) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.innerHTML = `${CT.esc(tag)}<button type="button" class="chip-x" aria-label="태그 삭제" data-i="${i}">✕</button>`;
    chip.querySelector('.chip-x').addEventListener('click', () => { state.tags.splice(i, 1); renderTags(); });
    el.tagWrap.insertBefore(chip, el.inpTag);
  });
}
function addTag() {
  const raw = el.inpTag.value.trim().replace(/\s+/g, ' ');
  if (!raw) return;
  for (const part of raw.split(/\s*,\s*/)) {
    if (!part) continue;
    if (state.tags.includes(part)) { CT.toast('이미 추가된 태그예요'); continue; }
    if (state.tags.length >= 12) { CT.toast('태그는 최대 12개까지 가능해요'); break; }
    state.tags.push(part.slice(0, 20));
  }
  el.inpTag.value = '';
  renderTags();
}

/* ============================================================
   이력
   ============================================================ */
function addCareerRow(period = '', desc = '') {
  const row = document.createElement('div');
  row.className = 'career-row';
  row.innerHTML = `
    <input type="text" class="career-period field-input sm:max-w-[11rem]" placeholder="예) 2021 ~ 현재" value="${CT.esc(period)}">
    <input type="text" class="career-desc field-input flex-1 min-w-[10rem]" placeholder="예) ABC 컴퍼니 · 프로덕트 디자이너" value="${CT.esc(desc)}">
    <button type="button" class="row-del" aria-label="이력 삭제">✕</button>`;
  row.querySelector('.row-del').addEventListener('click', () => {
    row.remove();
    if (!el.careerList.children.length) addCareerRow();
  });
  el.careerList.appendChild(row);
}
function collectCareers() {
  return [...el.careerList.querySelectorAll('.career-row')].map((r) => ({
    id: CT.uid(), period: r.querySelector('.career-period').value.trim(), desc: r.querySelector('.career-desc').value.trim(),
  })).filter((c) => c.period || c.desc);
}

/* ============================================================
   커스텀 링크
   ============================================================ */
function renderLinksEditor() {
  el.linkList.innerHTML = '';
  state.links.forEach((link, i) => {
    const div = document.createElement('div');
    div.className = 'link-row-item';
    div.innerHTML = `
      <div class="min-w-0">
        <p class="truncate font-semibold text-slate-200">${CT.esc(link.title)}</p>
        <p class="truncate text-xs text-slate-500">${CT.esc(link.url)}</p>
      </div>
      <button type="button" class="chip-x shrink-0 text-slate-500 hover:text-rose-300" aria-label="링크 삭제">✕</button>`;
    div.querySelector('button').addEventListener('click', () => { state.links.splice(i, 1); renderLinksEditor(); });
    el.linkList.appendChild(div);
  });
}
function addLink() {
  const title = el.inpLinkTitle.value.trim();
  const url = CT.safeUrl(el.inpLinkUrl.value.trim());
  if (!title || !url) { CT.toast('링크 제목과 URL을 모두 입력해 주세요'); return; }
  if (state.links.length >= 10) { CT.toast('링크는 최대 10개까지 가능해요'); return; }
  state.links.push({ id: CT.uid(), title: title.slice(0, 30), url });
  el.inpLinkTitle.value = ''; el.inpLinkUrl.value = '';
  renderLinksEditor();
}

/* ============================================================
   YouTube
   ============================================================ */
function showYtPreview() {
  const embed = CT.ytEmbed(el.inpYoutube.value);
  if (!embed) { CT.toast('유효한 YouTube URL을 입력해 주세요'); return; }
  el.ytFrame.src = embed;
  el.ytPreviewWrap.classList.remove('hidden');
}

/* ============================================================
   명함 렌더링
   ============================================================ */
function renderCard(d) {
  /* 체크로 숨긴 항목은 데이터가 있어도 표시하지 않음 (이름·전화번호는 항상 표시) */
  const hid = (k) => !!(d.hidden && d.hidden[k]);
  const use = (k, v) => (hid(k) ? '' : (v || ''));

  const hasPhoto = !!(!hid('photo') && d.images?.photo);
  el.vPhoto.src = use('photo', d.images?.photo);
  el.vPhoto.classList.toggle('hidden', !hasPhoto);
  el.vPhotoFallback.classList.toggle('hidden', hasPhoto);
  el.vPhotoFallback.textContent = (d.name || '?').trim().charAt(0) || '?';

  const hasLogo = !!(!hid('logo') && d.images?.logo);
  el.vLogo.src = use('logo', d.images?.logo);
  el.vLogo.classList.toggle('hidden', !hasLogo);
  const lf = el.vLogo.nextElementSibling;
  lf.classList.toggle('show', !hasLogo);
  lf.textContent = (use('company', d.company) || 'C').trim().charAt(0).toUpperCase() || 'C';

  el.vName.textContent = d.name || '이름 없음';
  el.vRole.textContent = use('title', d.title);
  el.vRole.classList.toggle('hidden', !el.vRole.textContent);
  el.vCompany.textContent = use('company', d.company);
  el.vCompany.classList.toggle('hidden', !el.vCompany.textContent);
  el.vBio.textContent = use('bio', d.bio);
  el.vBio.classList.toggle('hidden', !el.vBio.textContent);

  el.vTags.innerHTML = !hid('tags') ? (d.tags || []).map((t) => `<span class="tag-chip">${CT.esc(t.tag)}</span>`).join('') : '';

  const tel = CT.telHref(d.phone);
  el.vTel.classList.toggle('hidden', !tel);
  if (tel) { el.vTel.href = tel; el.vTelText.textContent = d.phone; }

  const mailto = !hid('email') && d.email ? `mailto:${d.email}` : '';
  el.vEmail.classList.toggle('hidden', !mailto);
  if (mailto) { el.vEmail.href = mailto; el.vEmailText.textContent = d.email; }

  const home = !hid('homepage') ? CT.safeUrl(d.homepage) : '';
  el.vHomepage.classList.toggle('hidden', !home);
  if (home) { el.vHomepage.href = home; el.vHomepageText.textContent = d.homepage.replace(/^https?:\/\//i, ''); }

  el.vAddressRow.classList.toggle('hidden', hid('address') || !d.address);
  el.vAddress.textContent = use('address', d.address);

  const careers = hid('careers') ? [] : (d.careers || []);
  el.vCareerWrap.classList.toggle('hidden', careers.length === 0);
  el.vCareerList.innerHTML = careers.map((c) => `
    <li class="relative pl-5">
      <span class="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,.8)]"></span>
      <p class="text-xs font-semibold text-indigo-300">${CT.esc(c.period)}</p>
      <p class="text-sm text-slate-300">${CT.esc(c.desc)}</p>
    </li>`).join('');

  const links = hid('links') ? [] : (d.links || []);
  el.vLinksWrap.classList.toggle('hidden', links.length === 0);
  el.vLinks.innerHTML = links.map((l) => `
    <a href="${CT.esc(CT.safeUrl(l.url))}" target="_blank" rel="noopener"
       class="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-slate-200 transition hover:border-indigo-400/40 hover:bg-indigo-500/10">
      <span class="min-w-0 truncate">${CT.esc(l.title)}</span>
      <span class="shrink-0 text-slate-500">↗</span>
    </a>`).join('');

  const embed = hid('youtube') ? '' : CT.ytEmbed(d.youtube);
  el.vVideoWrap.classList.toggle('hidden', !embed);
  if (embed) el.vYtFrame.src = embed;

  renderMobileView(d);
}

/* ============================================================
   모바일 9:16 세로 명함 뷰
   - 표시 순서: 이름(상단 공통) → 전화 → 주소 → 회사 → 이메일 → 홈페이지 → …
   - 표시 항목 설정(체크박스)에서 체크된 것만 표시, 해제 시 PC에서만 표시
   ============================================================ */
function renderMobileView(d) {
  if (!el.mvView) return;
  /* 체크로 숨긴 항목(설정창/인라인 공통, PC·모바일 동일 적용) + 값이 없는 항목도 숨김 */
  const hid = (k) => !!(d.hidden && d.hidden[k]);

  const toggleRows = {
    tel: true,   /* 전화번호는 항상 표시 */
    address: !hid('address') && !!d.address,
    company: !hid('company') && !!d.company,
    email: !hid('email') && !!d.email,
    homepage: !hid('homepage') && !!d.homepage,
    title: !hid('title') && !!d.title,
    bio: !hid('bio') && !!d.bio,
    tags: !hid('tags') && (d.tags || []).length > 0,
    careers: !hid('careers') && (d.careers || []).length > 0,
    links: !hid('links') && (d.links || []).length > 0,
  };

  /* 행 토글 — mv-mark 텍스트로 행 매칭 */
  el.mvView.querySelectorAll('.mv-seq').forEach((row) => {
    const mark = row.querySelector('.mv-mark');
    if (!mark) return;
    const key = mark.textContent.trim();
    row.classList.toggle('hidden', !toggleRows[key]);
  });

  /* 값 채우기 */
  const tel = CT.telHref(d.phone);
  if (tel) { el.mvTel.href = tel; el.mvTelText.textContent = d.phone; }

  el.mvAddress.textContent = d.address || '';
  el.mvCompany.textContent = d.company || '';
  el.mvEmail.textContent = d.email || '';
  el.mvEmailLink.href = d.email ? `mailto:${d.email}` : '#';
  const home = CT.safeUrl(d.homepage);
  el.mvHomepage.textContent = (d.homepage || '').replace(/^https?:\/\//i, '');
  el.mvHomepageLink.href = home || '#';
  el.mvTitle.textContent = d.title || '';
  el.mvBio.textContent = d.bio || '';

  el.mvTags.innerHTML = (d.tags || []).map((t) => `<span class="tag-chip">${CT.esc(t.tag)}</span>`).join('');

  const careers = d.careers || [];
  el.mvCareers.innerHTML = careers.map((c) => `
    <p class="text-sm text-slate-300"><span class="font-semibold text-indigo-300">${CT.esc(c.period)}</span> ${CT.esc(c.desc)}</p>`).join('');

  const links = d.links || [];
  el.mvLinks.innerHTML = links.map((l) => `
    <a href="${CT.esc(CT.safeUrl(l.url))}" target="_blank" rel="noopener"
       class="inline-flex max-w-full items-center gap-1 rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1 text-xs font-medium text-slate-200">
      <span class="truncate">${CT.esc(l.title)}</span><span class="text-slate-500">↗</span>
    </a>`).join('');
}

/* ============================================================
   덱(내 명함 목록) 렌더링
   ============================================================ */
function renderDeck() {
  el.deckCount.textContent = String(state.deck.length);
  el.deckEmpty.classList.toggle('hidden', state.deck.length > 0);
  el.deckGrid.innerHTML = state.deck.map((c) => `
    <div class="group flex items-center gap-4 rounded-2xl border border-white/10 bg-ink-850/80 p-4 transition hover:border-indigo-400/40 hover:bg-indigo-500/5">
      <button type="button" data-open="${c.id}" class="flex min-w-0 flex-1 items-center gap-4 text-left">
        ${c.images?.photo
          ? `<img src="${c.images.photo}" alt="" class="h-12 w-12 shrink-0 rounded-xl border border-white/10 object-cover">`
          : `<span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/40 to-violet-600/40 text-lg font-extrabold text-white">${CT.esc((c.name || '?').charAt(0))}</span>`}
        <span class="min-w-0">
          <span class="block truncate text-sm font-bold text-white">${CT.esc(c.name || '이름 없음')}</span>
          <span class="block truncate text-xs text-slate-500">${CT.esc([c.title, c.company].filter(Boolean).join(' · ') || c.phone || '')}</span>
        </span>
      </button>
      ${c.phone
        ? `<a href="${CT.esc(CT.telHref(c.phone))}" title="전화" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm transition hover:border-emerald-400/40 hover:bg-emerald-500/10">📞</a>`
        : '<span class="h-9 w-9 shrink-0"></span>'}
      <button type="button" data-edit="${c.id}" title="수정" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm transition hover:bg-white/10">✏️</button>
      <button type="button" data-del="${c.id}" title="삭제" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm transition hover:border-rose-400/40 hover:bg-rose-500/10">🗑️</button>
    </div>`).join('');

  el.deckGrid.querySelectorAll('[data-open]').forEach((b) =>
    b.addEventListener('click', () => openView(b.dataset.open)));
  el.deckGrid.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => { applyToEditor(state.deck.find((c) => c.id === b.dataset.edit)); showEditor(true); }));
  el.deckGrid.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const card = state.deck.find((c) => c.id === b.dataset.del);
      if (!card || !confirm(`'${card.name}' 명함을 삭제할까요?`)) return;
      state.deck = state.deck.filter((c) => c.id !== card.id);
      saveDeck();
      if (CT.auth.user && CT.auth.online) {
        try { await fetch(`/api/cards/${card.id}`, { method: 'DELETE', headers: CT.auth.headers() }); } catch {}
      }
      CT.toast('삭제되었습니다');
    }));
}

/* ============================================================
   뷰 전환 (간단 라우터)
   ============================================================ */
function showView() {
  const card = state.deck.find((c) => c.id === state.viewId);
  if (!card) { showEditor(); return; }
  renderCard(card);
  el.editorView.classList.add('hidden');
  el.deckSection.classList.add('hidden');
  el.viewView.classList.remove('hidden');
  history.replaceState(null, '', `#card/${state.viewId}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function showEditor(keepScroll = false) {
  el.viewView.classList.add('hidden');
  el.deckSection.classList.remove('hidden');
  el.editorView.classList.remove('hidden');
  history.replaceState(null, '', state.editingId ? `#edit/${state.editingId}` : '#editor');
  if (!keepScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}
function openView(id) {
  state.viewId = id;
  showView();
}

/* ============================================================
   vCard (카드 뷰 액션)
   ============================================================ */
function downloadCurrentVCard() {
  const card = state.deck.find((c) => c.id === state.viewId);
  if (!card) return;
  CT.download(`${card.name || 'contact'}.vcf`, CT.vCardOf(card), 'text/vcard;charset=utf-8');
  CT.toast('🪪 vCard가 다운로드되었습니다');
}

/* ============================================================
   이벤트 바인딩
   ============================================================ */
function bindEvents() {
  el.headerBrand.addEventListener('click', () => { applyToEditor(null); showEditor(); });

  /* 표시 항목 설정 프리셋 버튼 (체크 = 숨김) */
  el.btnMvAll?.addEventListener('click', () => {
    document.querySelectorAll('#mobileHideGrid input[data-hide]').forEach((cb) => { cb.checked = false; });
    syncInlineFromGrid();
    CT.toast('모든 항목을 표시합니다');
  });
  el.btnMvEssential?.addEventListener('click', () => {
    document.querySelectorAll('#mobileHideGrid input[data-hide]').forEach((cb) => {
      cb.checked = HIDE_ESSENTIAL.includes(cb.dataset.hide);   /* 추천 항목만 숨김 */
    });
    syncInlineFromGrid();
    CT.toast('직책·회사명·이메일·홈페이지를 숨기고 핵심만 표시합니다');
  });

  /* 저장 & 보기 */
  el.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!el.inpName.value.trim()) { el.inpName.focus(); CT.toast('이름을 입력해 주세요'); return; }
    if (!el.inpPhone.value.trim()) { el.inpPhone.focus(); CT.toast('전화번호를 입력해 주세요'); return; }
    const isNew = !state.deck.some((c) => c.id === (state.editingId || ''));
    const card = buildCard();
    upsertLocal(card);
    await pushToServer(card, isNew);
    state.viewId = card.id;
    showView();
    CT.toast(CT.auth.user && CT.auth.online ? '✅ 저장 & 클라우드 동기화 완료' : '✅ 명함이 저장되었습니다');
  });

  /* bio 카운터 */
  el.inpBio.addEventListener('input', () => { el.bioCount.textContent = String(el.inpBio.value.length); });

  /* 태그 */
  el.inpTag.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addTag(); }
    if (e.key === 'Backspace' && !el.inpTag.value && state.tags.length) { state.tags.pop(); renderTags(); }
  });
  el.btnAddTag.addEventListener('click', () => { addTag(); el.inpTag.focus(); });

  /* 이력 */
  $('#btnAddCareer').addEventListener('click', () => {
    if (el.careerList.children.length >= 10) { CT.toast('이력은 최대 10개까지 가능해요'); return; }
    addCareerRow();
  });

  /* YouTube */
  el.btnYoutube.addEventListener('click', showYtPreview);
  el.inpYoutube.addEventListener('change', () => {
    if (!el.inpYoutube.value) { el.ytFrame.src = ''; el.ytPreviewWrap.classList.add('hidden'); }
  });

  /* 링크 */
  el.btnAddLink.addEventListener('click', addLink);
  [el.inpLinkTitle, el.inpLinkUrl].forEach((inp) =>
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } }));

  /* 폼 리셋 */
  $('#btnReset').addEventListener('click', () => {
    if (!confirm('입력 내용을 모두 지우고 처음부터 시작할까요?')) return;
    applyToEditor(null);
    CT.toast('초기화되었습니다');
  });

  /* 카드 뷰 액션 */
  $('#btnEdit').addEventListener('click', () => {
    applyToEditor(state.deck.find((c) => c.id === state.viewId));
    showEditor(true);
  });
  $('#btnNew').addEventListener('click', () => { applyToEditor(null); showEditor(); });
  $('#btnSave').addEventListener('click', async () => {
    const isNew = !state.deck.some((c) => c.id === (state.editingId || ''));
    const card = buildCard();
    upsertLocal(card);
    await pushToServer(card, isNew);
    CT.toast('✅ 저장되었습니다');
  });
  $('#btnShare').addEventListener('click', async () => {
    try {
      if (navigator.share) { await navigator.share({ title: 'Contactify 명함', url: location.href }); return; }
      await navigator.clipboard.writeText(location.href);
      CT.toast('🔗 명함 링크가 복사되었습니다');
    } catch { CT.toast('복사가 차단된 환경이에요'); }
  });
  $('#btnPrint').addEventListener('click', () => window.print());
  $('#btnVCard').addEventListener('click', downloadCurrentVCard);

  /* 3D 틸트 */
  if (window.matchMedia('(hover:hover)').matches) {
    el.card.addEventListener('mousemove', (e) => {
      const r = el.card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      el.card.style.transform = `perspective(1100px) rotateY(${x * 7}deg) rotateX(${-y * 7}deg)`;
    });
    el.card.addEventListener('mouseleave', () => { el.card.style.transform = ''; });
  }
}

/* ============================================================
   인증/동기화 훅 (sync.js 에서 호출)
   ============================================================ */
CT.onAuthed = async (user) => {
  if (!CT.auth.online) {
    CT.toast('로컬 계정으로 로그인했습니다 — 서버 연동 없이 이 기기에만 저장돼요');
    renderDeck();
    return;
  }
  try {
    const r = await CT.sync.syncDown();
    renderDeck();
    CT.toast(`☁️ 클라우드 동기화 — ${r.cards.length}장 (새로 ${r.added}장 · 갱신 ${r.updated}장)`);
  } catch (e) {
    CT.toast(`⚠️ ${e.message}`);
  }
};

CT.onSynced = (cards) => {
  state.deck = cards;
  renderDeck();
};

/* 백업 가져오기 후 덱 갱신 훅 */
CT.onDeckChanged = (deck) => {
  state.deck = deck;
  renderDeck();
};

/* ============================================================
   init
   ============================================================ */
/* 세션 복원 시 sync.js가 자동 동기화한 결과 반영 (새 기기에서 로그인만 하면 자동 동기화) */
CT.onRestoredSync = (r) => {
  if (!r?.cards) return;
  state.deck = r.cards;
  renderDeck();
  if (r.cards.length) CT.toast(`☁️ 클라우드에서 ${r.cards.length}장 동기화 (새로 ${r.added}장 · 갱신 ${r.updated}장)`);
};

function init() {
  setupImageUpload('inpPhoto');
  setupImageUpload('inpLogo');
  addCareerRow();
  renderMobileHideGrid();
  bindEvents();
  loadDeck();

  /* 해시 라우팅: #card/:id · #edit/:id · #editor */
  const applyRoute = () => {
    const h = location.hash.replace(/^#/, '');
    const [kind, id] = h.split('/');
    if (kind === 'card' && state.deck.find((c) => c.id === id)) {
      state.viewId = id;
      el.editorView.classList.add('hidden');
      el.deckSection.classList.add('hidden');
      el.viewView.classList.remove('hidden');
      renderCard(state.deck.find((c) => c.id === id));
    } else {
      state.viewId = null;
      el.viewView.classList.add('hidden');
      el.deckSection.classList.remove('hidden');
      el.editorView.classList.remove('hidden');
      if (kind === 'edit' && state.deck.find((c) => c.id === id)) {
        applyToEditor(state.deck.find((c) => c.id === id));
      }
    }
  };
  window.addEventListener('hashchange', applyRoute);
  applyRoute();
}

init();
