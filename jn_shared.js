/* ============================================================
   JN Shared Data Layer  v2.0
   ------------------------------------------------------------
   모든 JN 앱(broker_ledger, case_notes, item_scout, jn_datahub ...)이
   같은 도메인(exel21c.github.io)에서 회사정보·거래처·환율·문서번호를 공유.

   사용법: 각 HTML의 </body> 직전에
     <script src="jn_shared.js"></script>

   localStorage 키 (모두 jn_ 접두사, 기존 jn_customs_pipeline과 공존):
     jn_company   회사(발신자) 정보 — 국문/영문 이원화   — object
     jn_clients   거래처 목록 (구분·지역·송금정보 포함)  — array
     jn_settings  공통 설정 + 환율 캐시 + 문서번호 카운터 — object

   v1 → v2 변경점:
     - jn_company: 평면 구조 → { ko:{...}, en:{...}, license, logo,
       brandColor, docPrefix } (자동 마이그레이션 내장)
     - jn_clients: kind(customer/supplier/both), region(domestic/overseas),
       remit(해외 송금정보) 필드 추가
     - JN.docNo: 문서번호 자동 생성기 (PREFIX-YYYYMMDD-001)
   ============================================================ */
(function (global) {
  'use strict';

  const KEYS = { company: 'jn_company', clients: 'jn_clients', settings: 'jn_settings' };

  /* ---------- 저수준 헬퍼 ---------- */
  function read(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { console.warn('[JN] read fail:', key, e); return fallback; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { console.warn('[JN] write fail:', key, e); return false; }
  }
  const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const now = () => new Date().toISOString();
  const ymd = (d) => {
    d = d || new Date();
    return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  };

  /* ---------- 회사(발신자) 정보 — 국문/영문 이원화 ---------- */
  const COMPANY_DEFAULT = {
    ko: { name: '', bizNo: '', address: '', tel: '', fax: '', email: '', bank: '' },
    en: { name: '', address: '', tel: '', email: '',
          bankName: '', bankAccount: '', swift: '', beneficiary: '' },
    license: '',            // 예: CBP License #42913
    logo: '',               // dataURL (권장 300px 이하)
    brandColor: '#0e4f5e',  // 모든 앱/문서 포인트 색상
    docPrefix: 'JN',        // 문서번호 접두사
    updatedAt: null
  };
  function migrateCompanyV1(c) {
    // v1 평면 구조(nameKo, bank...) → v2 중첩 구조
    if (!c || c.ko) return c;
    return Object.assign({}, COMPANY_DEFAULT, {
      ko: { name: c.nameKo || '', bizNo: c.bizNo || '', address: c.address || '',
            tel: c.tel || '', fax: c.fax || '', email: c.email || '', bank: c.bank || '' },
      en: Object.assign({}, COMPANY_DEFAULT.en, { name: c.nameEn || '' }),
      license: c.license || '', updatedAt: c.updatedAt || null
    });
  }
  const company = {
    get() {
      const c = migrateCompanyV1(read(KEYS.company, null));
      if (!c) return JSON.parse(JSON.stringify(COMPANY_DEFAULT));
      // 필드 누락 보정
      const merged = Object.assign({}, COMPANY_DEFAULT, c);
      merged.ko = Object.assign({}, COMPANY_DEFAULT.ko, c.ko || {});
      merged.en = Object.assign({}, COMPANY_DEFAULT.en, c.en || {});
      return merged;
    },
    save(patch) {
      const cur = company.get();
      const merged = Object.assign({}, cur, patch, { updatedAt: now() });
      if (patch.ko) merged.ko = Object.assign({}, cur.ko, patch.ko);
      if (patch.en) merged.en = Object.assign({}, cur.en, patch.en);
      write(KEYS.company, merged); return merged;
    }
  };

  /* ---------- 거래처 ----------
     kind:   'customer'(화주/고객) | 'supplier'(공급처) | 'both'(겸용)
     region: 'domestic'(국내) | 'overseas'(해외)
     remit:  해외 송금정보 { bank, account, swift, beneficiary, bankAddr }
  -------------------------------- */
  const CLIENT_DEFAULT = {
    id: '', kind: 'customer', region: 'domestic',
    nameKo: '', nameEn: '', attn: '', tel: '', mobile: '', email: '',
    address: '', tags: [], memo: '',
    remit: { bank: '', account: '', swift: '', beneficiary: '', bankAddr: '' },
    createdAt: '', updatedAt: ''
  };
  const clients = {
    list() {
      return read(KEYS.clients, []).map(c => {
        const m = Object.assign({}, CLIENT_DEFAULT, c);
        m.remit = Object.assign({}, CLIENT_DEFAULT.remit, c.remit || {});
        m.tags = Array.isArray(c.tags) ? c.tags : [];
        return m;
      });
    },
    get(id) { return clients.list().find(c => c.id === id) || null; },
    search(q, opts) {
      opts = opts || {};
      let rows = clients.list();
      if (opts.kind) rows = rows.filter(c => c.kind === opts.kind || c.kind === 'both');
      if (opts.region) rows = rows.filter(c => c.region === opts.region);
      q = (q || '').toLowerCase().trim();
      if (!q) return rows;
      return rows.filter(c =>
        [c.nameKo, c.nameEn, c.attn, c.email, c.tel, c.mobile, c.address, (c.tags || []).join(' ')]
          .join(' ').toLowerCase().includes(q));
    },
    upsert(data) {
      const all = read(KEYS.clients, []);
      if (data.id) {
        const i = all.findIndex(c => c.id === data.id);
        if (i > -1) {
          all[i] = Object.assign({}, all[i], data, { updatedAt: now() });
          if (data.remit) all[i].remit = Object.assign({}, all[i].remit || {}, data.remit);
          write(KEYS.clients, all); return all[i];
        }
      }
      const rec = Object.assign({}, JSON.parse(JSON.stringify(CLIENT_DEFAULT)), data,
        { id: data.id || uid(), createdAt: now(), updatedAt: now() });
      all.push(rec); write(KEYS.clients, all); return rec;
    },
    remove(id) { write(KEYS.clients, read(KEYS.clients, []).filter(c => c.id !== id)); }
  };

  /* ---------- 설정 + 환율 + 문서번호 카운터 ---------- */
  const settings = {
    get() { return read(KEYS.settings, { currency: 'USD', fxCache: null, docCounters: {} }); },
    set(patch) { const s = Object.assign(settings.get(), patch); write(KEYS.settings, s); return s; }
  };

  const fx = {
    CACHE_HOURS: 12,
    /* USD→KRW 환율. await JN.fx.get() → { rate, fetchedAt, source } / get(true)=강제 갱신 */
    async get(force) {
      const s = settings.get();
      const c = s.fxCache;
      const fresh = c && (Date.now() - new Date(c.fetchedAt).getTime()) / 36e5 < fx.CACHE_HOURS;
      if (fresh && !force) return c;
      try {
        const r = await fetch('https://open.er-api.com/v6/latest/USD');
        const j = await r.json();
        if (j && j.rates && j.rates.KRW) {
          const cache = { rate: j.rates.KRW, fetchedAt: now(), source: 'open.er-api.com' };
          settings.set({ fxCache: cache }); return cache;
        }
      } catch (e) { console.warn('[JN] fx fetch fail', e); }
      return c || { rate: null, fetchedAt: null, source: 'none' };
    },
    usdToKrw(usd, rate) { return Math.round(usd * rate); },
    krwToUsd(krw, rate) { return Math.round((krw / rate) * 100) / 100; }
  };

  /* ---------- 문서번호 생성기 ----------
     JN.docNo.preview('INV') → 'INV-20260709-003' (카운터 증가 없음)
     JN.docNo.next('INV')    → 'INV-20260709-003' (증가·저장)
     prefix 생략 시 회사 설정의 docPrefix 사용
  ------------------------------------- */
  const docNo = {
    _key(prefix) { return (prefix || company.get().docPrefix || 'DOC') + '-' + ymd(); },
    _fmt(prefix, n) { return this._key(prefix) + '-' + String(n).padStart(3, '0'); },
    preview(prefix) {
      const s = settings.get();
      const n = (s.docCounters && s.docCounters[this._key(prefix)]) || 0;
      return this._fmt(prefix, n + 1);
    },
    next(prefix) {
      const s = settings.get();
      s.docCounters = s.docCounters || {};
      const k = this._key(prefix);
      s.docCounters[k] = (s.docCounters[k] || 0) + 1;
      // 오래된 날짜 카운터 정리(30개 초과 시)
      const keys = Object.keys(s.docCounters);
      if (keys.length > 30) keys.sort().slice(0, keys.length - 30).forEach(x => delete s.docCounters[x]);
      settings.set({ docCounters: s.docCounters });
      return this._fmt(prefix, s.docCounters[k]);
    }
  };

  /* ---------- 백업 / 복원 ---------- */
  function exportAll() {
    return JSON.stringify({
      _type: 'jn_shared_backup', _v: 2, exportedAt: now(),
      company: company.get(), clients: clients.list(), settings: settings.get()
    }, null, 2);
  }
  function importAll(json) {
    const d = typeof json === 'string' ? JSON.parse(json) : json;
    if (d._type !== 'jn_shared_backup') throw new Error('jn_shared 백업 파일이 아닙니다.');
    if (d.company) write(KEYS.company, migrateCompanyV1(d.company));
    if (d.clients) write(KEYS.clients, d.clients);
    if (d.settings) write(KEYS.settings, d.settings);
    return { clients: (d.clients || []).length };
  }

  /* ---------- 기존 앱 데이터 일회성 이관 ---------- */
  function migrate(sourceKey, mapFn) {
    const src = read(sourceKey, null);
    if (!Array.isArray(src)) return { moved: 0 };
    let moved = 0;
    src.forEach(r => {
      const m = mapFn(r); if (!m) return;
      const dup = clients.list().some(c =>
        (m.nameKo && c.nameKo === m.nameKo) || (m.email && m.email && m.email === c.email));
      if (!dup) { clients.upsert(m); moved++; }
    });
    return { moved };
  }

  /* ---------- 거래처 선택 모달 (UI) ----------
     JN.pickClient(cb)                      전체에서 선택
     JN.pickClient(cb, {kind:'supplier'})   공급처만
  --------------------------------------------- */
  const KIND_LABEL = { customer: '고객', supplier: '공급', both: '겸용' };
  function pickClient(onSelect, opts) {
    opts = opts || {};
    const old = document.getElementById('jn-picker'); if (old) old.remove();
    const brand = company.get().brandColor || '#0e4f5e';
    const wrap = document.createElement('div');
    wrap.id = 'jn-picker';
    wrap.innerHTML = `
      <style>
        #jn-picker{position:fixed;inset:0;background:rgba(10,30,35,.45);z-index:99999;
          display:flex;align-items:flex-start;justify-content:center;padding:8vh 16px;font-family:inherit}
        #jn-picker .jnp-box{background:#fff;border-radius:14px;width:100%;max-width:440px;
          box-shadow:0 18px 50px rgba(0,0,0,.25);overflow:hidden;display:flex;flex-direction:column;max-height:70vh}
        #jn-picker .jnp-hd{background:${brand};color:#fff;padding:12px 16px;font-weight:700;
          display:flex;justify-content:space-between;align-items:center;font-size:14px}
        #jn-picker .jnp-hd button{background:none;border:0;color:#fff;font-size:18px;cursor:pointer;line-height:1}
        #jn-picker input.jnp-q{margin:12px 16px 6px;padding:9px 12px;border:1px solid #cfdde0;
          border-radius:8px;font-size:14px;outline:none}
        #jn-picker input.jnp-q:focus{border-color:${brand}}
        #jn-picker .jnp-list{overflow-y:auto;padding:6px 8px 12px}
        #jn-picker .jnp-item{padding:10px 12px;border-radius:8px;cursor:pointer;display:flex;gap:8px;align-items:center}
        #jn-picker .jnp-item:hover{background:#eef5f6}
        #jn-picker .jnp-badge{font-size:10px;padding:2px 6px;border-radius:10px;background:${brand}18;color:${brand};flex:none}
        #jn-picker .jnp-name{font-weight:600;font-size:14px;color:#16323a}
        #jn-picker .jnp-sub{font-size:12px;color:#7d97a0;margin-top:2px}
        #jn-picker .jnp-empty{padding:24px;text-align:center;color:#8aa2ab;font-size:13px;line-height:1.6}
      </style>
      <div class="jnp-box">
        <div class="jnp-hd"><span>거래처 선택</span><button aria-label="닫기">×</button></div>
        <input class="jnp-q" placeholder="회사명·담당자·이메일 검색" autofocus>
        <div class="jnp-list"></div>
      </div>`;
    document.body.appendChild(wrap);
    const listEl = wrap.querySelector('.jnp-list');
    const qEl = wrap.querySelector('.jnp-q');
    function render(q) {
      const rows = clients.search(q, opts);
      listEl.innerHTML = rows.length ? rows.map(c => `
        <div class="jnp-item" data-id="${c.id}">
          <span class="jnp-badge">${KIND_LABEL[c.kind] || ''}${c.region === 'overseas' ? '·해외' : ''}</span>
          <div>
            <div class="jnp-name">${c.nameKo || c.nameEn || '(이름 없음)'}</div>
            <div class="jnp-sub">${[c.attn, c.tel, c.email].filter(Boolean).join(' · ')}</div>
          </div>
        </div>`).join('')
        : `<div class="jnp-empty">거래처가 없습니다.<br>jn_datahub.html에서 먼저 등록하세요.</div>`;
    }
    render('');
    qEl.addEventListener('input', () => render(qEl.value));
    listEl.addEventListener('click', e => {
      const item = e.target.closest('.jnp-item'); if (!item) return;
      wrap.remove(); onSelect(clients.get(item.dataset.id));
    });
    wrap.querySelector('.jnp-hd button').onclick = () => wrap.remove();
    wrap.addEventListener('click', e => { if (e.target === wrap) wrap.remove(); });
    qEl.focus();
  }

  /* ---------- 다른 탭 변경 감지 ---------- */
  const listeners = [];
  window.addEventListener('storage', e => {
    if (Object.values(KEYS).includes(e.key)) listeners.forEach(fn => fn(e.key));
  });

  global.JN = {
    VERSION: '2.0',
    KEYS, company, clients, settings, fx, docNo,
    export: exportAll, import: importAll, migrate, pickClient,
    onChange(fn) { listeners.push(fn); }
  };
})(window);
