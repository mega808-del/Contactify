/* ============================================================
   Contactify — Backup (js/backup.js)
   ------------------------------------------------------------
   - 내보내기: JSON(전체 덱) / CSV(스프레드시트) / vCard(.vcf)
   - 가져오기: JSON / CSV / vCard 자동 인식 → 덱에 등록
   - JSON은 합치기/덮어쓰기 선택 UI 제공
   ============================================================ */
'use strict';

(() => {
  const $ = CT.$;
  const esc = CT.esc;
  const uid = CT.uid;
  const nowIso = () => new Date().toISOString();

  const CSV_HEADERS = [
    'id', 'name', 'title', 'company', 'email', 'phone', 'address',
    'homepage', 'bio', 'tags', 'careers', 'links', 'youtube', 'createdAt', 'updatedAt',
  ];

  /* ==================== 내보내기 ==================== */
  const backup = {
    exportJson(cards) {
      const payload = {
        format: 'contactify-backup',
        version: 2,
        exportedAt: nowIso(),
        count: cards.length,
        cards: cards.map(sanitize),
      };
      CT.download(`contactify-backup-${stamp()}.json`, JSON.stringify(payload, null, 2), 'application/json');
    },

    exportCsv(cards) {
      const escCell = CT.csvCell;
      const rows = [CSV_HEADERS.join(',')];
      for (const c of cards) {
        const s = sanitize(c);
        rows.push([
          s.id, s.name, s.title, s.company, s.email, s.phone, s.address,
          s.homepage, s.bio,
          s.tags.map((t) => t.tag).join('; '),
          s.careers.map((x) => `${x.period || ''} | ${x.desc || ''}`).join(' ;; '),
          s.links.map((x) => `${x.title || ''} :: ${x.url || ''}`).join(' ;; '),
          s.youtube, s.createdAt, s.updatedAt,
        ].map(escCell).join(','));
      }
      /* Excel 한글 호환: UTF-8 BOM */
      CT.download(`contactify-${stamp()}.csv`, '\uFEFF' + rows.join('\r\n'), 'text/csv;charset=utf-8');
    },

    exportVcf(cards) {
      const v = cards.map(vCardOf).filter(Boolean).join('\r\n');
      CT.download(`contactify-${stamp()}.vcf`, v, 'text/vcard;charset=utf-8');
    },
  };
  CT.backup = backup;

  function stamp() { return new Date().toISOString().slice(0, 10).replace(/-/g, ''); }

  function sanitize(c) {
    return {
      id: c.id || uid(),
      name: c.name || '', title: c.title || '', company: c.company || '',
      email: c.email || '', phone: c.phone || '', address: c.address || '',
      homepage: c.homepage || '', bio: c.bio || '', youtube: c.youtube || '',
      tags: (c.tags || []).map((t) => ({ id: t.id || uid(), tag: String(t.tag || '') })),
      careers: (c.careers || []).map((x) => ({ id: x.id || uid(), period: x.period || '', desc: x.desc || '' })),
      links: (c.links || []).map((x) => ({ id: x.id || uid(), title: x.title || '', url: x.url || '' })),
      images: { photo: c.images?.photo || '', logo: c.images?.logo || '' },
      hidden: sanitizeHidden(c.hidden),
      ownerId: c.ownerId ?? null,
      createdAt: c.createdAt || nowIso(),
      updatedAt: c.updatedAt || c.createdAt || nowIso(),
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

  CT.sanitizeCard = sanitize;

  function vCardOf(c) {
    if (!c || (!c.name && !c.phone && !c.email)) return '';
    const L = [];
    const note = (c.bio || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n');
    L.push('BEGIN:VCARD', 'VERSION:3.0');
    L.push(`N:${c.name}`, `FN:${c.name}`);
    if (c.title) L.push(`TITLE:${c.title}`);
    if (c.company) L.push(`ORG:${c.company}`);
    if (c.phone) L.push(`TEL;TYPE=CELL:${c.phone}`);
    if (c.email) L.push(`EMAIL;type=INTERNET:${c.email}`);
    if (c.homepage) L.push(`URL:${CT.safeUrl(c.homepage)}`);
    if (c.address) L.push(`ADR;TYPE=WORK:;;${c.address.replace(/[\r\n;]/g, ' ')}`);
    if (note) L.push(`NOTE:${note}`);
    if (c.tags?.length) L.push(`CATEGORIES:${c.tags.map((t) => t.tag).join(',')}`);
    if (c.links?.length) L.push(`X-CONTACTIFY-LINKS:${c.links.map((l) => `${l.title} :: ${l.url}`).join(' ;; ')}`);
    if (c.careers?.length) L.push(`X-CONTACTIFY-CAREERS:${c.careers.map((x) => `${x.period} | ${x.desc}`).join(' ;; ')}`);
    L.push('END:VCARD');
    return L.join('\r\n');
  }
  CT.vCardOf = vCardOf;

  /* ==================== 가져오기 ==================== */
  backup.importFile = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다'));
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const name = (file.name || '').toLowerCase();
        let format, cards;
        if (name.endsWith('.json') || text.trim().startsWith('{')) {
          format = 'json';
          cards = parseJson(text);
        } else if (name.endsWith('.vcf') || name.endsWith('.vcard')) {
          format = 'vcf';
          cards = parseVcf(text);
        } else if (name.endsWith('.csv') || text.includes(',') && /^[\w ]+,[\w "]/.test(text)) {
          format = 'csv';
          cards = parseCsv(text);
        } else {
          return reject(new Error('지원하지 않는 형식입니다 (JSON / CSV / .vcf)'));
        }
        if (!cards.length) return reject(new Error('가져올 명함 데이터가 없습니다'));
        resolve({ format, cards: cards.map(sanitize) });
        return;
      } catch (e) {
        reject(e);
        return;
      }
    };
    reader.readAsText(file, 'utf-8');
  });

  /* --- JSON --- */
  function parseJson(text) {
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('JSON 파싱 실패: 파일이 손상되었을 수 있어요'); }
    if (Array.isArray(data)) return data;                    // 카드 배열
    if (Array.isArray(data.cards)) return data.cards;        // 백업 페이로드
    if (data && typeof data === 'object' && (data.name || data.phone)) return [data]; // 카드 1장
    throw new Error('JSON 구조를 인식할 수 없습니다 (명함 배열 또는 contactify-backup 형식 필요)');
  }

  /* --- CSV --- */
  function parseCsv(text) {
    const table = parseCsvTable(text.replace(/^\uFEFF/, ''));
    if (table.length < 2) throw new Error('CSV에 데이터 행이 없습니다');
    const header = table[0].map((h) => h.trim().toLowerCase());
    const idx = Object.fromEntries(CSV_HEADERS.map((h) => [h, header.indexOf(h)]));
    if (idx.name === -1 && idx.phone === -1) throw new Error('CSV 헤더에 name/phone 열이 필요합니다');
    return table.slice(1).map((cells) => {
      const get = (k) => (idx[k] >= 0 ? (cells[idx[k]] || '').trim() : '');
      const tags = get('tags').split(';').map((t) => t.trim()).filter(Boolean).map((t) => ({ id: uid(), tag: t }));
      const careers = get('careers').split(';;').map((x) => x.trim()).filter(Boolean).map((x) => {
        const [period, ...rest] = x.split('|');
        return { id: uid(), period: (period || '').trim(), desc: rest.join('|').trim() };
      });
      const links = get('links').split(';;').map((x) => x.trim()).filter(Boolean).map((x) => {
        const [title, ...rest] = x.split('::');
        return { id: uid(), title: (title || '').trim(), url: rest.join('::').trim() };
      });
      return {
        id: get('id') || uid(), name: get('name'), title: get('title'), company: get('company'),
        email: get('email'), phone: get('phone'), address: get('address'), homepage: get('homepage'),
        bio: get('bio'), youtube: get('youtube'),
        tags, careers, links,
        images: { photo: '', logo: '' },
        ownerId: null,
        createdAt: get('createdAt') || nowIso(),
        updatedAt: nowIso(),
      };
    });
  }

  /* RFC4180 파서 (따옴표/쉼표/개행 처리) */
  function parseCsvTable(text) {
    const rows = [];
    let row = [], cell = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else inQ = false;
        } else cell += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (ch === '\r') { /* skip */ }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  /* --- vCard 3.0 --- */
  function parseVcf(text) {
    const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
    return unfolded.split(/END:VCARD/i).filter((p) => /BEGIN:VCARD/i.test(p)).map((block) => {
      const props = {};
      for (const line of block.split(/\r?\n/)) {
        const m = line.match(/^([A-Za-z-]+)(?:;([^:]*))?:(.*)$/);
        if (!m) continue;
        const key = m[1].toUpperCase();
        const val = m[3].trim();
        if (key === 'BEGIN') continue;
        if (!props[key]) props[key] = [];
        props[key].push(val);
      }
      const phone = (props.TEL || [])[0] || '';
      const email = (props.EMAIL || [])[0] || '';
      const org = (props.ORG || [])[0] || '';
      const addr = (props.ADR || [])[0] || '';
      const links = (props['X-CONTACTIFY-LINKS'] || [])[0] || '';
      const careers = (props['X-CONTACTIFY-CAREERS'] || [])[0] || '';
      const tagList = (props.CATEGORIES || [])[0] || '';
      const card = {
        id: uid(), name: (props.FN || props.N || [''])[0].replace(/\\n/g, ' ').trim(),
        title: (props.TITLE || [''])[0], company: org.split(';')[0].trim(),
        phone, email,
        address: addr.split(';').slice(2).join(' ').trim(),
        homepage: (props.URL || [''])[0],
        bio: (props.NOTE || [''])[0].replace(/\\n/g, '\n'),
        youtube: '',
        tags: tagList.split(',').map((t) => t.trim()).filter(Boolean).map((t) => ({ id: uid(), tag: t })),
        careers: careers.split(';;').filter(Boolean).map((x) => {
          const [period, ...rest] = x.split('|');
          return { id: uid(), period: (period || '').trim(), desc: rest.join('|').trim() };
        }),
        links: links.split(';;').filter(Boolean).map((x) => {
          const [title, ...rest] = x.split('::');
          return { id: uid(), title: (title || '').trim(), url: rest.join('::').trim() };
        }),
        images: { photo: '', logo: '' },
        ownerId: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      return card;
    }).filter((c) => c.name || c.phone || c.email);
  }

  /* ==================== UI 바인딩 ==================== */
  let pendingImport = null;

  function applyImport(cards, mode) {
    const current = CT.store.getCards();
    let deck;
    if (mode === 'replace') {
      deck = cards;
    } else {
      const byKey = new Map(current.map((c) => [c.id + '|' + (c.phone || ''), c]));
      let added = 0, merged = 0;
      for (const c of cards) {
        const key = c.id + '|' + (c.phone || '');
        const exist = byKey.get(key);
        if (!exist) { byKey.set(key, c); added++; continue; }
        const it = Date.parse(c.updatedAt || 0), et = Date.parse(exist.updatedAt || exist.createdAt || 0);
        if (it >= et) { byKey.set(key, c); merged++; }
      }
      deck = [...byKey.values()];
      CT.toast(`📥 ${added}장 추가 · ${merged}장 갱신됨`);
    }
    CT.store.setCards(deck);
    if (typeof CT.onDeckChanged === 'function') CT.onDeckChanged(deck);
    if (mode === 'replace') CT.toast(`📥 ${cards.length}장으로 교체되었습니다`);
  }
  CT.applyImport = applyImport;

  document.addEventListener('DOMContentLoaded', () => {
    const inp = document.getElementById('inpImport');
    const mergeBox = document.getElementById('mergeChoice');
    const btnJson = document.getElementById('btnExportJson');
    const btnCsv = document.getElementById('btnExportCsv');
    const btnVcf = document.getElementById('btnExportVcf');

    if (!inp) return;

    const getCards = () => (typeof CT.getDeck === 'function' ? CT.getDeck() : CT.store.getCards());

    btnJson.addEventListener('click', () => {
      const cards = getCards();
      if (!cards.length) return CT.toast('내보낼 명함이 없어요');
      backup.exportJson(cards);
      CT.toast(`📦 JSON 백업 다운로드 (${cards.length}장)`);
    });
    btnCsv.addEventListener('click', () => {
      const cards = getCards();
      if (!cards.length) return CT.toast('내보낼 명함이 없어요');
      backup.exportCsv(cards);
      CT.toast(`📊 CSV 다운로드 (${cards.length}장)`);
    });
    btnVcf.addEventListener('click', () => {
      const cards = getCards();
      if (!cards.length) return CT.toast('내보내기할 명함이 없어요');
      backup.exportVcf(cards);
      CT.toast(`🪪 vCard 다운로드 (${cards.length}장)`);
    });

    inp.addEventListener('change', async () => {
      const file = inp.files?.[0];
      if (!file) return;
      try {
        const { format, cards } = await backup.importFile(file);
        if (format === 'json') {
          pendingImport = cards;
          document.getElementById('mergeIncoming').textContent = String(cards.length);
          mergeBox.classList.remove('hidden');
          mergeBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          applyImport(cards, 'merge');
        }
      } catch (e) {
        CT.toast(`⚠️ ${e.message}`);
      } finally {
        inp.value = '';
      }
    });

    document.getElementById('btnMergeAdd').addEventListener('click', () => {
      const cards = pendingImport; pendingImport = null;
      mergeBox.classList.add('hidden');
      if (cards) applyImport(cards, 'merge');
    });
    document.getElementById('btnMergeReplace').addEventListener('click', () => {
      const cards = pendingImport; pendingImport = null;
      mergeBox.classList.add('hidden');
      if (cards) applyImport(cards, 'replace');
    });
    document.getElementById('btnMergeCancel').addEventListener('click', () => {
      pendingImport = null;
      mergeBox.classList.add('hidden');
      CT.toast('가져오기를 취소했습니다');
    });
  });
})();
