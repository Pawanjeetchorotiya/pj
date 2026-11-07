/* PJ RGHS Suite - claim status content script (isolated world, every RGHS page)
   - Transaction ID Tracker (tmsBisTrack, tmsBisTrack1): glass panel, filters, quick dates, bottom bar
   - Payment Tracker (tmsPaymentTrack): payment summary card
   - every page: upload ticker, portal pop-up
   Every TID read on the trackers is saved (chrome.storage.local) for the Daily sheet / Excel export. */
(function () {
  'use strict';
  if (window.__pjRghsContent) return;
  window.__pjRghsContent = true;
  const PJ = self.PJ;
  const DS = self.DailySheet;
  if (!PJ) return;

  /* Only one copy of this tool draws on a page. If two copies (version 3.2.0 or newer) are installed,
     the newest one wins and the other stays quiet. */
  const cmpVer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
  const RUN_ATTR = 'data-pj-rghs-run';
  const running = document.documentElement.getAttribute(RUN_ATTR);
  if (running && cmpVer(running, PJ.VERSION) >= 0) return;
  document.documentElement.setAttribute(RUN_ATTR, PJ.VERSION);
  // Marks the elements made by THIS copy of the tool, so a second (old) copy can be detected.
  const OWN = 'pj' + Math.random().toString(36).slice(2, 10);
  try { document.dispatchEvent(new CustomEvent('pj-rghs-takeover', { detail: PJ.VERSION })); } catch (e) { /* ignore */ }
  let DEAD = false;
  const TIMERS = [];
  const every = (fn, ms) => { const t = setInterval(fn, ms); TIMERS.push(t); return t; };
  document.addEventListener('pj-rghs-takeover', (e) => {
    if (DEAD || !e || cmpVer(e.detail, PJ.VERSION) <= 0) return;
    // a newer copy has started: remove everything this copy drew
    DEAD = true;
    TIMERS.forEach(clearInterval);
    document.querySelectorAll('[data-pj-own="' + OWN + '"]').forEach(h => h.remove());
    document.querySelectorAll('[data-pj-rghs-hidden]').forEach(h => h.removeAttribute('data-pj-rghs-hidden'));
  });

  const IS_TRACKER = /tmsBisTrack/i.test(location.href);
  const IS_PAY = /tmsPaymentTrack/i.test(location.href);
  const IS_OPD = /tmsOPDDetails/i.test(location.href);
  const TO_BRIDGE = 'PJ_RGHS_CS';
  const FROM_BRIDGE = 'PJ_RGHS_BRIDGE';
  const esc = PJ.esc;
  const fmt = PJ.fmt;

  const S = {
    settings: Object.assign({}, PJ.DEFAULTS),
    uploads: {},
    snapshot: null,
    data: null,          // current tracker read
    stats: null,
    statusIndex: [],
    filter: null,        // {label, count, d, k}
    sheet: null,         // 'settings' | 'dates' | null
    saved: null,         // {count, at} - last save for the daily sheet
    pay: null            // payment page read
  };

  /* ================= icons ================= */
  const I = (p) => '<svg class="i" viewBox="0 0 24 24">' + p + '</svg>';
  const ICON = {
    views: I('<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>'),
    cal: I('<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
    refresh: I('<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/>'),
    copy: I('<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>'),
    min: I('<path d="M6 12h12"/>'),
    expand: I('<path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5"/>'),
    swap: I('<path d="M5 8h13l-3.5-3.5M19 16H6l3.5 3.5"/>'),
    close: I('<path d="M6 6l12 12M18 6L6 18"/>'),
    up: I('<path d="M12 19V6M6 11.5l6-6 6 6"/>'),
    sheet: I('<rect x="4" y="3.5" width="16" height="17" rx="2.5"/><path d="M4 9h16M4 14.5h16M10 9v11.5"/>')
  };

  /* ================= small helpers ================= */
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const cw = () => document.documentElement.clientWidth || innerWidth;
  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }
  function makeHost(name, z) {
    const h = document.createElement('div');
    h.setAttribute('data-pj-rghs', name);
    h.setAttribute('data-pj-own', OWN);
    h.style.cssText = 'all:initial;display:block;position:fixed;z-index:' + (z || 2147483000) + ';';
    (document.documentElement || document.body).appendChild(h);
    return { host: h, root: h.attachShadow({ mode: 'open' }) };
  }
  function copyText(t) {
    return new Promise(res => {
      const fallback = () => {
        try {
          const ta = document.createElement('textarea');
          ta.value = t; ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
          document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
        } catch (e) { /* ignore */ }
        res(true);
      };
      try { navigator.clipboard.writeText(t).then(() => res(true), fallback); } catch (e) { fallback(); }
    });
  }
  function findByText(rx, maxLen, below) {
    let best = null, bw = 0;
    for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span,p,strong,b,legend,label,td,th,caption,header')) {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > maxLen || !rx.test(t)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (below != null && r.top < below) continue;
      if (r.width > bw) { bw = r.width; best = el; }
    }
    return best;
  }
  function pageName() {
    const seg = (location.pathname.split('/').filter(Boolean).pop() || 'RGHS page');
    return seg.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-]+/g, ' ').replace(/^tms\s*/i, '').replace(/\b\w/g, c => c.toUpperCase()).trim();
  }
  function detectCols(headers) {
    const H = (headers || []).map(h => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
    const f = (pred) => H.findIndex(pred);
    let tid = f(h => h === 'transactionid' || h === 'tid' || h === 'transactionidno' || h === 'tidno');
    if (tid < 0) tid = f(h => h.indexOf('transactionid') !== -1 && h.indexOf('status') === -1 && h.indexOf('created') === -1 && h.indexOf('date') === -1);
    let status = f(h => h === 'transactionidstatus');
    if (status < 0) status = f(h => h.indexOf('transactionidstatus') !== -1 || h === 'tidstatus');
    if (status < 0) status = f(h => h.indexOf('status') !== -1 && h.indexOf('created') === -1 && h.indexOf('date') === -1 && h.indexOf('claimsubmission') === -1);
    const dept = f(h => h.indexOf('department') !== -1 || h === 'dept' || h === 'type');
    let amount = f(h => h.indexOf('hospitalclaimamount') !== -1);
    if (amount < 0) amount = f(h => h.indexOf('claim') !== -1 && h.indexOf('amount') !== -1);
    if (amount < 0) amount = f(h => h.indexOf('amount') !== -1);
    let name = f(h => h.indexOf('patientname') !== -1);
    if (name < 0) name = f(h => h.indexOf('beneficiaryname') !== -1);
    if (name < 0) name = f(h => /name$/.test(h) && h.indexOf('hospital') === -1 && h.indexOf('package') === -1 && h.indexOf('doctor') === -1);
    let created = f(h => h.indexOf('transactionidcreatedon') !== -1);
    if (created < 0) created = f(h => h.indexOf('createdon') !== -1 || h.indexOf('createddate') !== -1);
    if (created < 0) created = f(h => h.indexOf('created') !== -1);
    const gender = f(h => h === 'gender' || h === 'sex');
    const age = f(h => h === 'age' || h === 'ageinyears');
    const card = f(h => h.indexOf('cardno') !== -1 || h.indexOf('rghscard') !== -1);
    const doctor = f(h => h.indexOf('treatingdoctor') !== -1 || h === 'doctorname');
    return { tid, status, dept, amount, name, created, gender, age, card, doctor };
  }
  const COL_NAMES = { tid: 'Transaction Id', status: 'Transaction Id Status', dept: 'Department', amount: 'Hospital Claim Amount', name: 'Patient Name', created: 'Transaction Id Created On', gender: 'Gender', age: 'Age', card: 'RGHS Card No.', doctor: 'Treating Doctor' };
  function looksTid(s) {
    s = String(s || '').trim();
    if (s.length < 6 || s.length > 32) return false;
    if (!/^[A-Za-z0-9][A-Za-z0-9\-\/_]*$/.test(s)) return false;
    return (s.match(/\d/g) || []).length >= 5;
  }

  /* ================= storage ================= */
  async function load() {
    const r = await PJ.get(['settings', 'uploads', 'snapshot']);
    S.settings = Object.assign({}, PJ.DEFAULTS, r.settings || {});
    S.uploads = r.uploads || {};
    S.snapshot = r.snapshot || null;
    PJ.setLogoStyle(S.settings.logo);
    S.loaded = true;
    if (S.pendingData) { const a = S.pendingData; S.pendingData = null; a.forEach(fn => fn()); }
  }
  async function setSetting(patch) {
    Object.assign(S.settings, patch);
    onSettings();
    await PJ.set({ settings: S.settings });
  }
  function onSettings() { PJ.setLogoStyle(S.settings.logo); renderTicker(); renderPanel(); renderPayCard(); hideOtherEmptyBars(); }
  function onUploads() { renderTicker(); if (IS_TRACKER) renderPanel(); else highlightRows(); }
  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local') return;
      if (ch.settings) {
        const nv = Object.assign({}, PJ.DEFAULTS, ch.settings.newValue || {});
        if (JSON.stringify(nv) !== JSON.stringify(S.settings)) { S.settings = nv; onSettings(); }
      }
      if (ch.uploads) { S.uploads = ch.uploads.newValue || {}; onUploads(); }
      if (ch.snapshot) S.snapshot = ch.snapshot.newValue || null;
    });
  } catch (e) { /* extension reloaded */ }

  /* ================= shared glass CSS ================= */
  const FONT = '"Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif';
  const GLASS_CSS = `
:host{all:initial}
*{box-sizing:border-box;margin:0;padding:0}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;text-shadow:inherit;letter-spacing:inherit}
svg.i{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;display:block}
.g{--tx:#0b1324;--tx2:#334155;--mut:#56657c;--ok:#047857;--okb:rgba(16,185,129,.17);--warn:#c2410c;--warnb:rgba(249,115,22,.17);
--bad:#dc2626;--badb:rgba(239,68,68,.15);--line:rgba(15,23,42,.10);--chip:rgba(255,255,255,.45);--chiph:rgba(255,255,255,.75);
--ts:0 1px 0 rgba(255,255,255,.75);--bg:rgba(255,255,255,.24);--sheen:rgba(255,255,255,.5);--blur:18px;--sat:185%;--edge:rgba(255,255,255,.72);
color:var(--tx);text-shadow:var(--ts);font-family:${FONT};
background:linear-gradient(180deg,var(--sheen),rgba(255,255,255,0) 46%),linear-gradient(var(--bg),var(--bg));
-webkit-backdrop-filter:blur(var(--blur)) saturate(var(--sat));backdrop-filter:blur(var(--blur)) saturate(var(--sat));
border:1px solid var(--edge);
box-shadow:inset 0 1px 0 rgba(255,255,255,.95),inset 0 -1px 0 rgba(255,255,255,.3),inset 1px 0 0 rgba(255,255,255,.35),inset -1px 0 0 rgba(255,255,255,.22),0 14px 34px rgba(15,23,42,.16),0 2px 8px rgba(15,23,42,.08)}
.gl-clear{--bg:rgba(255,255,255,.10);--blur:10px;--sat:165%;--sheen:rgba(255,255,255,.35)}
.gl-frosted{--bg:rgba(255,255,255,.68);--blur:28px;--sat:140%}
.t-dark{--tx:#f1f5f9;--tx2:#d7dfea;--mut:#a5b3c7;--ok:#34d399;--okb:rgba(52,211,153,.2);--warn:#fdba74;--warnb:rgba(251,146,60,.2);
--bad:#fca5a5;--badb:rgba(248,113,113,.2);--line:rgba(255,255,255,.14);--chip:rgba(255,255,255,.10);--chiph:rgba(255,255,255,.2);
--ts:0 1px 2px rgba(0,0,0,.6);--bg:rgba(15,23,42,.46);--sheen:rgba(255,255,255,.12);--edge:rgba(255,255,255,.22)}
.t-dark.gl-clear{--bg:rgba(15,23,42,.24)}
.t-dark.gl-frosted{--bg:rgba(15,23,42,.8)}
.ok{color:var(--ok)}.wn{color:var(--warn)}.bad{color:var(--bad)}
`;

  /* ================= UPLOAD TICKER (every page) ================= */
  const T = { h: null, root: null, open: false, sig: '' };
  let TB = null; // top bar anchors

  function tickerScopeOpt() {
    if (S.settings.tickerScope === 'all') return { scope: 'all' };
    if (IS_TRACKER && S.data && S.data.range && S.data.range.from && S.data.range.to) {
      return { scope: 'range', from: S.data.range.from, to: S.data.range.to };
    }
    return { scope: 'month' };
  }
  function tickerList() { return PJ.scopeUploads(S.uploads, tickerScopeOpt()); }

  const TICKER_CSS = `
.wrap{position:relative;font:12px/1.2 ${FONT}}
.tk{display:flex;align-items:center;gap:8px;height:30px;padding:0 4px;border-radius:999px;overflow:hidden}
.badge{flex:none;display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 11px 0 9px;border-radius:999px;background:linear-gradient(135deg,#f43f5e,#dc2626);color:#fff;font-weight:700;font-size:11.5px;text-shadow:none;box-shadow:0 2px 7px rgba(220,38,38,.38),inset 0 1px 0 rgba(255,255,255,.4)}
.badge:hover{filter:brightness(1.06)}
.badge i{width:6px;height:6px;border-radius:50%;background:#fff;animation:blink 1.2s infinite}
@keyframes blink{50%{opacity:.25}}
.mq{flex:1;min-width:0;overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 16px,#000 calc(100% - 16px),transparent);mask-image:linear-gradient(90deg,transparent,#000 16px,#000 calc(100% - 16px),transparent)}
.track{display:inline-flex;white-space:nowrap;animation:mq linear infinite;will-change:transform}
.mq:hover .track{animation-play-state:paused}
.track span{padding-right:56px;font-size:12px;font-weight:600}
.track span b{color:#b91c1c;font-weight:700}
.t-dark .track span b{color:#fca5a5}
@keyframes mq{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.dd{position:absolute;top:38px;left:50%;transform:translateX(-50%);width:min(460px,94vw);max-height:380px;display:flex;flex-direction:column;border-radius:18px;overflow:hidden}
.dd.g{--bg:rgba(255,255,255,.86)}
.dd.g.t-dark{--bg:rgba(15,23,42,.9)}
.ddh{display:flex;align-items:center;gap:8px;padding:9px 8px 7px 12px;border-bottom:1px solid var(--line)}
.ddh div{display:flex;flex-direction:column;gap:2px;min-width:0}
.ddh b{font-size:13px}
.ddh small{font-size:11px;color:var(--mut)}
.x{margin-left:auto;width:26px;height:26px;border-radius:9px;display:grid;place-items:center;background:var(--chip)}
.ddl{flex:1;overflow:auto;padding:6px}
.it{display:grid;grid-template-columns:1fr auto;gap:2px 8px;padding:7px 8px;border-radius:12px}
.it:hover{background:var(--chip)}
.l1{display:flex;align-items:center;gap:6px;font-size:12.5px;min-width:0}
.l1 b{font-family:Consolas,"Cascadia Mono",monospace;font-size:12.5px}
.tag{font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:99px;background:rgba(99,102,241,.15);color:#4338ca;text-shadow:none}
.t-dark .tag{color:#c7d2fe}
.l2{grid-column:1;font-size:11.5px;color:var(--tx2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt{grid-column:2;grid-row:1/3;display:flex;gap:4px;align-items:center}
.sb{padding:4px 10px;border-radius:99px;font-size:11.5px;font-weight:700;background:var(--chip);border:1px solid var(--line)}
.sb:hover{background:var(--chiph)}
.sb.p{background:linear-gradient(135deg,#22d3ee,#6366f1 55%,#a855f7);color:#fff;text-shadow:none;border-color:transparent}
.ddf{display:flex;align-items:center;gap:8px;padding:8px 10px;border-top:1px solid var(--line)}
.hint{font-size:11px;color:var(--mut);flex:1}
`;

  function mountTicker() {
    const x = makeHost('ticker', 2147482000);
    T.h = x.host; T.root = x.root;
    T.root.addEventListener('click', onTickerClick);
    document.addEventListener('click', (e) => {
      if (T.open && !e.composedPath().includes(T.h)) { T.open = false; renderTicker(); }
    }, true);
  }

  function renderTicker() {
    if (DEAD) return;
    const list = tickerList();
    const show = !!S.settings.alertTicker && list.length > 0;
    if (!show) {
      // Nothing to upload: keep the top bar clean - no ticker at all.
      if (T.h) { T.h.style.display = 'none'; T.open = false; T.sig = ''; }
      return;
    }
    if (!T.h) mountTicker();
    T.h.style.display = 'block';
    const opt = tickerScopeOpt();
    const allCount = Object.keys(S.uploads).length;
    const sig = JSON.stringify([list.map(u => [u.tid, u.name, u.dept, u.date, u.amount]), allCount, opt, S.settings.theme, S.settings.glass, T.open]);
    if (sig === T.sig) { positionTicker(); return; }
    T.sig = sig;
    const cls = 'g t-' + S.settings.theme + ' gl-' + S.settings.glass;
    const items = list.map(u => '<span><b>TID ' + esc(u.tid) + '</b> · ' + esc(u.name || '-') + ' · ' + esc(PJ.DEPT_LABEL[u.dept] || u.dept || '-') + ' · ' +
      esc(PJ.isoToDmy(u.date) || u.dateRaw || '-') + ' · ₹' + esc(PJ.fmtAmt(u.amount)) + ' — Please upload this TID</span>').join('');
    const chars = list.reduce((n, u) => n + PJ.uploadLine(u).length + 30, 0);
    const dur = Math.max(14, Math.round(chars * 0.16));
    const hidden = allCount - list.length;
    let dd = '';
    if (T.open) {
      dd = '<div class="dd ' + cls + '"><div class="ddh"><div><b>TIDs to upload (' + list.length + ')</b><small>' + esc(PJ.scopeLabel(opt)) + '</small></div>' +
        '<button class="x" data-act="close" title="Close">' + ICON.close + '</button></div><div class="ddl">' +
        list.map(u => '<div class="it"><div class="l1"><b>' + esc(u.tid) + '</b><span class="tag">' + esc(PJ.DEPT_LABEL[u.dept] || u.dept || '-') + '</span><span>₹' + esc(PJ.fmtAmt(u.amount)) + '</span></div>' +
          '<div class="l2">' + esc(u.name || '-') + ' · ' + esc(PJ.isoToDmy(u.date) || u.dateRaw || '-') + (u.source ? ' · seen on ' + esc(u.source) : '') + '</div>' +
          '<div class="bt"><button class="sb" data-act="copy1" data-tid="' + esc(u.tid) + '">Copy</button><button class="sb" data-act="done" data-tid="' + esc(u.tid) + '">Done</button></div></div>').join('') +
        '</div><div class="ddf"><span class="hint">' + (hidden > 0 ? hidden + ' saved TID' + (hidden > 1 ? 's' : '') + ' from other dates are hidden. Change "Upload ticker shows" in Settings.' : 'Done removes a TID from the list.') + '</span>' +
        '<button class="sb p" data-act="copyall">Copy all</button></div></div>';
    }
    T.root.innerHTML = '<style>' + GLASS_CSS + TICKER_CSS + '</style><div class="wrap"><div class="tk ' + cls + '">' +
      '<button class="badge" data-act="list" title="Show the list"><i></i>' + list.length + ' TID' + (list.length > 1 ? 's' : '') + ' to upload</button>' +
      '<div class="mq"><div class="track" style="animation-duration:' + dur + 's">' + items + items + '</div></div></div>' + dd + '</div>';
    T.wrap = T.root.querySelector('.wrap');
    positionTicker();
  }

  function onTickerClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'list') { T.open = !T.open; renderTicker(); }
    else if (act === 'close') { T.open = false; renderTicker(); }
    else if (act === 'copy1') { copyText(b.dataset.tid).then(() => { b.textContent = 'Copied'; }); }
    else if (act === 'copyall') { copyText(PJ.uploadsText(tickerList())).then(() => { b.textContent = 'Copied'; }); }
    else if (act === 'done') { const tid = b.dataset.tid; delete S.uploads[tid]; onUploads(); PJ.send({ type: 'uploads:done', tids: [tid] }); }
  }

  function findTopBar() {
    if (TB && TB.welcome.isConnected) return TB;
    TB = null;
    if (!document.body) return null;
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: n => /^\s*welcome\b/i.test(n.nodeValue || '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    });
    let n, welcome = null;
    while ((n = tw.nextNode())) {
      const el = n.parentElement;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.top + scrollY < 260) { welcome = el; break; }
    }
    if (!welcome) return null;
    let bar = welcome;
    while (bar.parentElement && bar.parentElement !== document.body && bar.parentElement !== document.documentElement) {
      const pr = bar.parentElement.getBoundingClientRect();
      if (pr.height > 130) break;
      bar = bar.parentElement;
    }
    const wr = welcome.getBoundingClientRect();
    let menu = null, menuScore = -1;
    for (const el of bar.querySelectorAll('a,button,i,span,img,svg,div')) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8 || r.width > 70 || r.height > 70) continue;
      if (r.right > wr.left - 60) continue;
      const k = ((el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('aria-label') || '');
      const score = (/toggle|menu|bars|sidebar|hamburger|nav/i.test(k) ? 1000 : 0) - r.left / 10;
      if (score > menuScore) { menuScore = score; menu = el; }
    }
    TB = { welcome, bar, menu };
    return TB;
  }

  function positionTicker() {
    if (!T.h || T.h.style.display === 'none' || !T.wrap) return;
    const a = findTopBar();
    if (a) {
      const wr = a.welcome.getBoundingClientRect();
      const br = a.bar.getBoundingClientRect();
      const leftX = a.menu ? a.menu.getBoundingClientRect().right : br.left + 56;
      const rightX = wr.left;
      const avail = rightX - leftX - 40;
      const width = Math.max(220, Math.min(620, avail));
      const midY = br.height <= 130 ? br.top + br.height / 2 : wr.top + wr.height / 2;
      T.wrap.style.width = width + 'px';
      T.h.style.left = Math.round((leftX + rightX) / 2 - width / 2) + 'px';
      T.h.style.top = Math.round(midY - 15) + 'px';
      T.h.style.visibility = midY < -20 ? 'hidden' : 'visible';
    } else {
      const width = Math.min(560, cw() - 40);
      T.wrap.style.width = width + 'px';
      T.h.style.left = Math.round(cw() / 2 - width / 2) + 'px';
      T.h.style.top = '6px';
    }
  }

  /* ================= TRACKER + PAYMENT: data from the bridge ================= */
  function toBridge(m) { m.src = TO_BRIDGE; try { window.postMessage(m, location.origin); } catch (e) { /* ignore */ } }
  function whenLoaded(fn) { if (S.loaded) fn(); else (S.pendingData = S.pendingData || []).push(fn); }

  if (IS_TRACKER || IS_PAY) {
    window.addEventListener('message', ev => {
      if (ev.source !== window || !ev.data || ev.data.src !== FROM_BRIDGE) return;
      const m = ev.data;
      if (m.type === 'data') {
        const meta = { partial: !!m.serverSide, source: 'datatable' };
        if (IS_PAY) whenLoaded(() => processPayment(m.headers || [], m.rows || [], meta));
        else whenLoaded(() => processData(m.headers || [], m.rows || [], meta));
      }
      else if (m.type === 'nodt') {
        if (IS_PAY) { if (!S.pay || S.pay.source !== 'datatable') startDomFallback(); }
        else if (!S.data || S.data.source !== 'datatable') startDomFallback();
      }
      else if (m.type === 'filtered') { if (S.filter) { S.filter.count = m.count; renderPanel(); } }
    });
  }

  /* DOM fallback when no DataTable is found (reads the visible rows only) */
  let domObs = null, domTimer = null;
  function trackerDomTable() {
    for (const tb of document.querySelectorAll('table')) {
      if (tb.closest('[data-pj-rghs]')) continue;
      const head = tb.tHead ? tb.tHead.rows[tb.tHead.rows.length - 1] : tb.rows[0];
      if (!head) continue;
      const hs = Array.from(head.cells).map(c => PJ.clean(c.textContent));
      if (hs.some(h => (/transaction\s*id/i.test(h) || /^tid(\s*no\.?)?$/i.test(h)) && !/status|created/i.test(h))) return { tb, hs, head };
    }
    return null;
  }
  function readDom() {
    const cur = IS_PAY ? S.pay : S.data;
    if (cur && cur.source === 'datatable') return;
    const t = trackerDomTable();
    if (!t) return;
    const rows = [];
    const bodyRows = t.tb.tBodies.length ? Array.from(t.tb.tBodies).flatMap(b => Array.from(b.rows)) : Array.from(t.tb.rows).slice(1);
    bodyRows.forEach(tr => { if (tr !== t.head && tr.cells.length > 1) rows.push(Array.from(tr.cells).map(c => PJ.clean(c.textContent))); });
    const sig = JSON.stringify(rows).length + ':' + rows.length + ':' + (rows[0] || []).join('|');
    if (cur && cur.source === 'dom' && cur.domSig === sig) return;
    const meta = { partial: true, source: 'dom', domSig: sig };
    if (IS_PAY) processPayment(t.hs, rows, meta); else processData(t.hs, rows, meta);
  }
  function startDomFallback() {
    readDom();
    if (domObs) return;
    domObs = new MutationObserver(() => { clearTimeout(domTimer); domTimer = setTimeout(readDom, 700); });
    domObs.observe(document.body, { childList: true, subtree: true });
  }
  function domFilter(set) {
    const t = trackerDomTable();
    if (!t) return;
    const ti = detectCols(t.hs).tid;
    let count = 0;
    Array.from(t.tb.tBodies[0] ? t.tb.tBodies[0].rows : []).forEach(tr => {
      const v = ti >= 0 && tr.cells[ti] ? PJ.clean(tr.cells[ti].textContent) : '';
      const show = !set || set.has(v);
      tr.style.display = show ? '' : 'none';
      if (show) count++;
    });
    if (S.filter) S.filter.count = count;
  }

  function processData(headers, raw, meta) {
    if (DEAD) return;
    const cols = detectCols(headers);
    const rows = [];
    for (const cells of raw) {
      const tid = cols.tid >= 0 ? PJ.clean(cells[cols.tid]) : '';
      const status = cols.status >= 0 ? PJ.clean(cells[cols.status]) : '';
      if (!tid && !status) continue;
      if (/no data available|no matching records|no records/i.test(tid + ' ' + status)) continue;
      const amount = cols.amount >= 0 ? PJ.parseAmount(cells[cols.amount]) : 0;
      const dateRaw = cols.created >= 0 ? PJ.clean(cells[cols.created]) : '';
      const r = {
        tid, status, amount,
        dept: cols.dept >= 0 ? PJ.normDept(cells[cols.dept]) : 'OTHER',
        name: cols.name >= 0 ? PJ.clean(cells[cols.name]) : '',
        dateRaw, date: PJ.parseDate(dateRaw)
      };
      r.f = PJ.flags(status, amount);
      rows.push(r);
    }
    const hadFilter = !!S.filter;
    S.data = { headers, cols, rows, partial: !!meta.partial, source: meta.source, domSig: meta.domSig, range: readRange(rows), at: Date.now() };
    S.stats = PJ.computeStats(rows);
    if (hadFilter) {
      S.filter = null;
      if (meta.source === 'datatable') toBridge({ type: 'filter', tids: null }); else domFilter(null);
    }
    renderPanel();
    renderTicker();
    if (rows.length) { saveSnapshot(); syncUploadsFromTracker(rows); saveRecords(headers, raw); }
  }

  /* every TID read here is kept for the Daily sheet (Excel export) */
  function saveRecords(headers, raw) {
    if (!DS) return;
    const recs = DS.recordsFromTracker(headers, raw);
    if (!recs.length) return;
    // the tracker dates decide which month buckets this read covers
    PJ.send({ type: 'records:put', records: recs, page: pageName() }).then(r => {
      S.saved = { count: recs.length, at: Date.now(), ok: !!(r && r.ok) };
      renderPanel();
    });
  }

  function processPayment(headers, raw, meta) {
    if (DEAD || !DS) return;
    const pays = DS.paymentsFromTable(headers, raw);
    const list = Object.values(pays);
    let paid = 0, approved = 0, deduction = 0, paidCount = 0;
    list.forEach(p => { const f = DS.paymentFields(p); if (f.paid) { paid += f.paid; paidCount++; } approved += f.approved || 0; deduction += f.deduction || 0; });
    S.pay = { count: list.length, paid, approved, deduction, paidCount, partial: !!meta.partial, source: meta.source, domSig: meta.domSig, at: Date.now(), headers };
    renderPayCard();
    if (list.length) {
      PJ.send({ type: 'payments:put', payments: pays }).then(r => { S.pay.saved = !!(r && r.ok); renderPayCard(); });
    }
  }

  function readRange(rows) {
    const d = findDateInputs();
    const f = d.from ? PJ.parseDate(d.from.value) : '';
    const t = d.to ? PJ.parseDate(d.to.value) : '';
    if (f && t) return { from: f, to: t, fromDmy: PJ.isoToDmy(f), toDmy: PJ.isoToDmy(t), source: 'boxes' };
    const ds = rows.map(r => r.date).filter(Boolean).sort();
    if (ds.length) return { from: ds[0], to: ds[ds.length - 1], fromDmy: PJ.isoToDmy(ds[0]), toDmy: PJ.isoToDmy(ds[ds.length - 1]), source: 'rows' };
    return null;
  }

  function saveSnapshot() {
    const d = S.data;
    const statuses = [], idx = new Map();
    const rows = d.rows.map(r => {
      let i = idx.get(r.status);
      if (i === undefined) { i = statuses.length; statuses.push(r.status); idx.set(r.status, i); }
      return [r.tid, r.dept, i, r.amount, r.date];
    });
    const counts = {};
    ['ALL', 'OPD', 'IPD', 'DC'].forEach(k => { const s = S.stats[k]; counts[k] = { total: s.total, claimed: s.claimed, pending: s.pending, c: s.c }; });
    const snap = { at: Date.now(), range: d.range ? { from: d.range.from, to: d.range.to } : null, total: d.rows.length, partial: d.partial, statuses, rows, counts };
    S.snapshot = snap;
    PJ.set({ snapshot: snap, trackerUrl: location.origin + location.pathname });
  }

  function syncUploadsFromTracker(rows) {
    const add = [], remove = [], seen = new Set();
    rows.forEach(r => {
      if (r.tid && r.f.toUpload) {
        seen.add(r.tid);
        add.push({ tid: r.tid, name: r.name, dept: r.dept, date: r.date, dateRaw: r.dateRaw, amount: r.amount, status: r.status, source: 'Transaction ID Tracker' });
      }
    });
    rows.forEach(r => { if (r.tid && !r.f.toUpload && !seen.has(r.tid) && S.uploads[r.tid]) remove.push(r.tid); });
    if (add.length || remove.length) PJ.send({ type: 'uploads:sync', add, remove });
  }

  /* ================= TRACKER: anchors and quick dates ================= */
  let TR = null;
  function findSearchBtn(scope) {
    const els = $$('button, input[type=button], input[type=submit], a', scope || document).filter(e => !e.closest('[data-pj-rghs]'));
    const label = e => PJ.clean(e.innerText || e.value || e.textContent || '');
    return els.find(e => /^search$/i.test(label(e)) && visible(e)) ||
      els.find(e => /\bsearch\b/i.test(label(e)) && label(e).length < 20 && visible(e)) || null;
  }
  function trackerAnchors() {
    if (TR && TR.title.isConnected) return TR;
    TR = null;
    const title = findByText(/^transaction\s*id\s*tracker\b/i, 60) || findByText(/^(beneficiary|tid)\s*(details\s*)?track/i, 60);
    if (!title) return null;
    // the card is the nearest box (the title itself or a parent) that holds the SEARCH button - never <body>
    let card = title.parentElement && title.parentElement !== document.body ? title.parentElement : title, search = null, el = title;
    while (el && el !== document.body && el !== document.documentElement) {
      const sb = findSearchBtn(el);
      if (sb) { search = sb; card = el; break; }
      el = el.parentElement;
    }
    TR = { title, card, search, benef: null };
    return TR;
  }
  function benefHeader(below) {
    return findByText(/^beneficiary\s*details\b/i, 50, below);
  }
  function labelText(i) {
    let t = '';
    try {
      if (i.id) { const l = document.querySelector('label[for="' + CSS.escape(i.id) + '"]'); if (l) t += ' ' + l.textContent; }
      const cl = i.closest('label'); if (cl) t += ' ' + cl.textContent;
      const prev = i.previousElementSibling; if (prev && prev.textContent.length < 40) t += ' ' + prev.textContent;
      const p = i.parentElement; if (p && p.textContent.length < 60) t += ' ' + p.textContent;
      if (p && p.previousElementSibling && p.previousElementSibling.textContent.length < 40) t += ' ' + p.previousElementSibling.textContent;
    } catch (e) { /* ignore */ }
    return t;
  }
  function findDateInputs() {
    const a = IS_TRACKER ? trackerAnchors() : null;
    return findDateInputsIn((a && a.card) || document);
  }
  function findDateInputsIn(scope) {
    const inputs = $$('input', scope).filter(i => /^(text|date|search|)$/i.test(i.type || '') && !i.closest('[data-pj-rghs]'));
    const desc = i => [i.id, i.name, i.placeholder, i.getAttribute('aria-label'), labelText(i)].join(' ').toLowerCase();
    if (scope !== document && inputs.length < 2) return findDateInputsIn(document);
    let from = inputs.find(i => /from|start/.test(desc(i)));
    let to = inputs.find(i => i !== from && /todate|to_date|to-date|\bto\b|end\s*date|enddate/.test(desc(i)));
    if (!from || !to) {
      const dated = inputs.filter(i => /^\d{1,2}[-\/.]\d{1,2}[-\/.]\d{4}$|^\d{4}-\d{2}-\d{2}$/.test((i.value || '').trim()) || /date/.test(desc(i)));
      if (!from) from = dated[0] || null;
      if (!to) to = dated.find(i => i !== from) || null;
    }
    if ((!from || !to) && scope !== document) return findDateInputsIn(document);
    return { from: from || null, to: to || null };
  }
  function setInputValue(el, date) {
    let v;
    if ((el.type || '').toLowerCase() === 'date') v = PJ.isoOf(date);
    else {
      v = PJ.dmyOf(date);
      if (/^\d{2}\/\d{2}\/\d{4}$/.test((el.value || '').trim())) v = v.replace(/-/g, '/');
    }
    try { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); } catch (e) { el.value = v; }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function applyQuickDate(key) {
    const r = PJ.quickRanges().find(x => x.key === key);
    if (!r) return;
    const d = findDateInputs();
    S.sheet = null;
    if (!d.from || !d.to) { renderPanel(); toast('From / To date boxes not found'); return; }
    setInputValue(d.from, r.from);
    setInputValue(d.to, r.to);
    renderPanel();
    const btn = (TR && TR.search && TR.search.isConnected) ? TR.search : findSearchBtn();
    if (btn) { setTimeout(() => btn.click(), 150); toast(r.label + ': searching…'); }
    else toast('SEARCH button not found');
  }
  function refreshNow() {
    const cur = IS_PAY ? S.pay : S.data;
    if (cur && cur.source === 'dom') { cur.domSig = ''; readDom(); }
    else toBridge({ type: 'read' });
    toast('Reading the table again…');
  }

  /* ================= TRACKER: filtering ================= */
  function kLabel(k) {
    if (k === 'claimed') return 'Claimed';
    if (k === 'pending') return 'Pending';
    if (k === 'total') return 'All rows';
    if (k.indexOf('cat:') === 0) return PJ.CATS[k.slice(4)] || k;
    if (k.indexOf('st:') === 0) return S.statusIndex[+k.slice(3)] || 'Status';
    return k;
  }
  function matchK(r, k) {
    if (k === 'claimed') return r.f.claimed;
    if (k === 'pending') return !r.f.claimed;
    if (k === 'total') return true;
    if (k.indexOf('cat:') === 0) return !!r.f[k.slice(4)];
    if (k.indexOf('st:') === 0) return (PJ.clean(r.status) || '(blank)') === S.statusIndex[+k.slice(3)];
    return false;
  }
  function applyFilter(d, k) {
    if (!S.data) return;
    const rows = S.data.rows.filter(r => (d === 'ALL' || r.dept === d) && matchK(r, k));
    const tids = Array.from(new Set(rows.map(r => r.tid).filter(Boolean)));
    S.filter = { label: PJ.DEPT_LABEL[d] + ' · ' + kLabel(k), count: rows.length, d, k };
    if (S.data.source === 'datatable') toBridge({ type: 'filter', tids }); else domFilter(new Set(tids));
    renderPanel();
  }
  function clearFilter() {
    S.filter = null;
    if (S.data && S.data.source === 'datatable') toBridge({ type: 'filter', tids: null }); else domFilter(null);
    renderPanel();
  }

  /* ================= TRACKER: panel ================= */
  const P = { h: null, root: null, rot: 0, rotTimer: null, toastTimer: null };
  const VIEWS = [['compact', 'Compact'], ['columns', 'Columns'], ['table', 'Table'], ['rings', 'Rings'], ['status', 'Status list'], ['bars', 'Bars']];
  const MINI_VIEWS = [['pill', 'Pill'], ['pending', 'Pending only'], ['bars', 'Bars'], ['badge', 'Badge'], ['rotate', 'Rotating'], ['icon', 'Icon only']];

  const PANEL_CSS = `
.pn{position:absolute;inset:0;display:flex;flex-direction:column;border-radius:22px;overflow:hidden;font:12px/1.35 ${FONT}}
.hd{display:flex;align-items:center;gap:8px;padding:7px 8px 5px 10px;flex:none}
.lg{flex:none;display:block;filter:drop-shadow(0 2px 5px rgba(79,70,229,.35))}
.lg svg{display:block}
.tt{display:flex;flex-direction:column;min-width:0}
.tt b{font-size:13px;font-weight:700;white-space:nowrap}
.sub{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--tx2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dot{width:7px;height:7px;border-radius:50%;background:#10b981;flex:none;animation:pulse 2s infinite}
.dot.part{background:#f59e0b;animation:pulseA 2s infinite}
.dot.wait{background:#94a3b8;animation:none}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(16,185,129,.55)}70%{box-shadow:0 0 0 6px rgba(16,185,129,0)}100%{box-shadow:0 0 0 0 rgba(16,185,129,0)}}
@keyframes pulseA{0%{box-shadow:0 0 0 0 rgba(245,158,11,.55)}70%{box-shadow:0 0 0 6px rgba(245,158,11,0)}100%{box-shadow:0 0 0 0 rgba(245,158,11,0)}}
.sp{flex:1;min-width:4px}
.ib{flex:none;width:28px;height:28px;border-radius:10px;display:grid;place-items:center;color:var(--tx2);background:var(--chip);border:1px solid rgba(255,255,255,.5);box-shadow:inset 0 1px 0 rgba(255,255,255,.7)}
.t-dark .ib{border-color:rgba(255,255,255,.14);box-shadow:none}
.ib:hover{background:var(--chiph);color:var(--tx)}
.ib.on{background:rgba(99,102,241,.2);color:#4f46e5}
.t-dark .ib.on{color:#c7d2fe}
.ib.xl{background:linear-gradient(135deg,#10b981,#059669);color:#fff;border-color:transparent;box-shadow:0 3px 9px rgba(16,185,129,.35)}
.ib.xl:hover{filter:brightness(1.08);color:#fff}
.saved{font-size:10.5px;color:var(--ok);font-weight:600;white-space:nowrap}
.tabs{display:flex;gap:5px;padding:0 8px 6px 10px;flex:none;align-items:center;overflow-x:auto;scrollbar-width:none}
.tab{flex:none;display:flex;align-items:baseline;gap:6px;padding:4px 10px;border-radius:999px;background:var(--chip);border:1px solid rgba(255,255,255,.45);font-size:11.5px;font-weight:600;color:var(--tx2)}
.t-dark .tab{border-color:rgba(255,255,255,.12)}
.tab em{font-style:normal;font-size:11px;font-variant-numeric:tabular-nums;color:var(--mut)}
.tab em b{font-weight:700}
.tab.on{background:rgba(255,255,255,.88);color:var(--tx);box-shadow:0 1px 5px rgba(15,23,42,.13)}
.t-dark .tab.on{background:rgba(255,255,255,.2)}
.leg{margin-left:auto;flex:none;font-size:10.5px;color:var(--mut);padding-left:6px}
.bd{flex:1;min-height:0;overflow:auto;padding:0 10px 8px;scrollbar-width:thin}
h4{font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--mut);font-weight:700;margin:1px 0 3px 6px}
.vc{display:grid;grid-template-columns:minmax(165px,1fr) minmax(185px,1.25fr) minmax(185px,1.4fr);gap:10px}
.tiles{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.tile{display:flex;flex-direction:column;align-items:flex-start;padding:4px 9px 5px;border-radius:12px;text-align:left;border:1px solid rgba(255,255,255,.5)}
.t-dark .tile{border-color:rgba(255,255,255,.12)}
.tile span{font-size:10.5px;font-weight:600;color:var(--tx2)}
.tile b{font-size:17px;line-height:1.15;font-weight:750;font-variant-numeric:tabular-nums}
.tile small{font-size:10px;color:var(--mut);white-space:nowrap}
.tile.ok{background:var(--okb)}.tile.ok b{color:var(--ok)}
.tile.wn{background:var(--warnb)}.tile.wn b{color:var(--warn)}
.tile:hover{filter:brightness(1.04);box-shadow:0 2px 8px rgba(15,23,42,.1)}
.pb{height:7px;border-radius:99px;background:var(--warnb);overflow:hidden;margin-top:7px}
.pb.sm{height:5px;margin-top:3px}
.pb i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#10b981,#22d3ee)}
.pl{font-size:10.5px;color:var(--tx2);margin-top:3px}
.li{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:1px 2px 1px 6px;border-radius:8px;font-size:11.5px;min-height:21px}
.li:hover{background:var(--chip)}
.li span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.li.zero{opacity:.55}
.n{flex:none;min-width:30px;padding:1px 7px;border-radius:99px;font-weight:700;font-variant-numeric:tabular-nums;text-align:center;background:var(--chip);border:1px solid rgba(255,255,255,.5);font-size:11.5px}
.t-dark .n{border-color:rgba(255,255,255,.12)}
button.n:hover{background:rgba(99,102,241,.18);color:#4338ca}
.t-dark button.n:hover{color:#e0e7ff}
.n.z{opacity:.65;font-weight:600}
.n.ok{color:var(--ok)}.n.wn{color:var(--warn)}.n.bad{color:var(--bad)}
.vcol{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.card{padding:6px 7px;border-radius:14px;background:var(--chip);border:1px solid rgba(255,255,255,.45)}
.t-dark .card{border-color:rgba(255,255,255,.1)}
.ch{display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:12.5px;padding-left:4px}
.ch span{display:flex;gap:3px;align-items:center;color:var(--mut)}
.pl2{font-size:10.5px;color:var(--tx2);margin:2px 0 3px 4px}
.allok{font-size:11px;color:var(--ok);padding:2px 6px;font-weight:600}
table{width:100%;border-collapse:separate;border-spacing:0;font-size:11.5px}
th,td{padding:2px 6px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}
th:first-child,td:first-child{text-align:left;white-space:normal}
thead th{position:sticky;top:0;z-index:1;background:rgba(255,255,255,.82);font-size:10px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em}
.t-dark thead th{background:rgba(30,41,59,.92)}
tr.sum td{font-weight:700}
.vr{display:flex;gap:8px;flex-wrap:wrap}
.rg{flex:1;min-width:150px;display:flex;align-items:center;gap:8px;padding:5px 9px;border-radius:14px;background:var(--chip)}
.rg svg{flex:none;width:54px;height:54px}
.rt{fill:none;stroke:var(--warnb);stroke-width:6}
.rv{fill:none;stroke:#10b981;stroke-width:6;stroke-linecap:round}
.rg text{font:800 12px ${FONT};fill:var(--tx)}
.rg .rl{display:flex;flex-direction:column;gap:3px;font-size:11.5px}
.rg .rl b{font-size:12.5px}
.vs{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:3px 12px}
.sr{position:relative;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:2px 3px 2px 8px;border-radius:8px;font-size:11.5px;overflow:hidden;min-height:22px}
.sr .fill{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,rgba(99,102,241,.2),rgba(168,85,247,.08));border-radius:8px}
.sr>span:not(.fill),.sr>button{position:relative}
.sr>span:not(.fill){min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vb{display:flex;flex-direction:column;gap:6px}
.br{display:grid;grid-template-columns:62px 1fr auto;gap:4px 8px;align-items:center}
.br>b{font-size:12px}
.stk{display:flex;height:11px;border-radius:99px;overflow:hidden;background:var(--chip)}
.stk i{display:block;height:100%}.stk .c{background:linear-gradient(90deg,#10b981,#34d399)}.stk .p{background:linear-gradient(90deg,#f97316,#fbbf24)}
.bn{display:flex;gap:3px;align-items:center;font-size:11px;color:var(--mut)}
.chips{grid-column:2/4;display:flex;flex-wrap:wrap;gap:4px}
.chip{display:inline-flex;gap:5px;align-items:center;padding:1px 2px 1px 8px;border-radius:99px;background:var(--chip);font-size:11px}
.empty{padding:6px 12px 10px;display:flex;flex-direction:column;gap:8px;font-size:12px;color:var(--tx2)}
.qrow{display:flex;flex-wrap:wrap;gap:5px}
.qb{padding:4px 11px;border-radius:99px;background:var(--chip);border:1px solid var(--line);font-size:11.5px;font-weight:600}
.qb:hover{background:var(--chiph)}
.fb{flex:none;display:flex;align-items:center;gap:8px;margin:0 8px 7px;padding:3px 4px 3px 10px;border-radius:12px;background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.28);font-size:11.5px}
.fb span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fb button{margin-left:auto;flex:none;padding:3px 11px;border-radius:99px;background:rgba(255,255,255,.85);font-weight:700;color:#4338ca;text-shadow:none}
.sh{position:absolute;inset:5px;border-radius:18px;display:flex;flex-direction:column;background:rgba(255,255,255,.95);-webkit-backdrop-filter:blur(24px) saturate(160%);backdrop-filter:blur(24px) saturate(160%);border:1px solid rgba(255,255,255,.85);box-shadow:0 8px 26px rgba(15,23,42,.2);z-index:5;overflow:hidden}
.t-dark .sh{background:rgba(15,23,42,.92);border-color:rgba(255,255,255,.15)}
.shh{flex:none;display:flex;align-items:center;gap:8px;padding:6px 7px 6px 12px;border-bottom:1px solid var(--line)}
.shh b{font-size:13px}
.done{margin-left:auto;padding:4px 14px;border-radius:99px;background:linear-gradient(135deg,#22d3ee,#6366f1 55%,#a855f7);color:#fff;font-weight:700;text-shadow:none}
.shb{flex:1;overflow:auto;padding:8px 12px 12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px 18px;align-content:start}
h5{font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--mut);margin-bottom:5px}
.seg{display:flex;flex-wrap:wrap;gap:4px}
.seg button{padding:3px 10px;border-radius:99px;background:var(--chip);border:1px solid var(--line);font-size:11.5px;font-weight:600}
.seg button.on{background:linear-gradient(135deg,#22d3ee,#6366f1 55%,#a855f7);color:#fff;text-shadow:none;border-color:transparent}
.tg{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:3px 0;font-size:12px;text-align:left}
.sw{width:30px;height:18px;border-radius:99px;background:rgba(100,116,139,.38);position:relative;flex:none;transition:.2s}
.sw::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:.2s}
.tg.on .sw{background:#10b981}.tg.on .sw::after{left:14px}
.note{font-size:11px;color:var(--mut);margin-top:4px;line-height:1.35}
ul.rules{padding-left:15px;font-size:11.5px;color:var(--tx2)}
ul.rules li{margin:2px 0}
.cols div{display:flex;justify-content:space-between;gap:8px;font-size:11.5px;padding:1px 0}
.qd{grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px}
.qd button{display:flex;flex-direction:column;align-items:flex-start;gap:1px;padding:6px 10px;border-radius:12px;background:var(--chip);border:1px solid var(--line);text-align:left}
.qd button:hover{background:rgba(99,102,241,.14)}
.qd b{font-size:12px}.qd small{font-size:10.5px;color:var(--mut)}
.lgp{display:flex;gap:6px}
.lgp button{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;padding:7px 4px 5px;border-radius:14px;background:var(--chip);border:1.5px solid var(--line);font-size:11px;font-weight:600;color:var(--tx2)}
.lgp button.on{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.18);color:var(--tx)}
.toast{position:absolute;left:50%;bottom:10px;transform:translate(-50%,16px);opacity:0;padding:5px 13px;border-radius:99px;background:rgba(15,23,42,.88);color:#fff;text-shadow:none;font-weight:600;transition:.25s;pointer-events:none;z-index:9;white-space:nowrap}
.toast.show{opacity:1;transform:translate(-50%,0)}
.mini{position:relative;display:flex;align-items:center;gap:6px;height:28px;padding:0 3px 0 5px;border-radius:999px;font:12px/1 ${FONT};white-space:nowrap}
.mini.g{--bg:rgba(255,255,255,.8)}
.mini.g.t-dark{--bg:rgba(15,23,42,.66)}
.mini .lg svg{width:20px;height:20px}
.mi{display:inline-flex;align-items:center;gap:4px;font-weight:600}
.mi em{font-style:normal;color:var(--tx2);font-weight:600}
.mi b{font-variant-numeric:tabular-nums}
.sep{color:var(--mut)}
.mb{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600}
.mb .stk{width:42px;height:8px}
.rb{display:inline-flex;align-items:center;height:18px;padding:0 7px;border-radius:99px;background:linear-gradient(135deg,#f43f5e,#dc2626);color:#fff;font-size:10.5px;font-weight:700;text-shadow:none}
.ico{position:relative;display:block}
.ico .rb{position:absolute;top:-5px;right:-8px;height:15px;padding:0 4px;font-size:9.5px}
.mini .ib{width:22px;height:22px;border-radius:99px}
.mini .ib svg.i{width:13px;height:13px}
.rot{animation:fade .45s ease}
@keyframes fade{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
`;

  function btnIcon(act, icon, title, v, on, extra) {
    return '<button class="ib' + (on ? ' on' : '') + (extra ? ' ' + extra : '') + '" data-act="' + act + '"' + (v ? ' data-v="' + v + '"' : '') + ' title="' + esc(title) + '" aria-label="' + esc(title) + '">' + icon + '</button>';
  }
  function cnt(n, d, k, cls) {
    n = n || 0;
    if (n > 0) return '<button class="n ' + (cls || '') + '" data-act="f" data-d="' + d + '" data-k="' + esc(k) + '" title="Show these rows in the table">' + fmt(n) + '</button>';
    return '<span class="n z">0</span>';
  }
  const BADCATS = { query: 'wn', rejected: 'bad', toUpload: 'bad' };
  function attnList(d, onlyNonZero) {
    const x = S.stats[d];
    const keys = PJ.DEPT_CATS[d].filter(k => !onlyNonZero || x.c[k] > 0);
    if (!keys.length) return '<div class="allok">All clear</div>';
    return keys.map(k => '<div class="li' + (x.c[k] ? '' : ' zero') + '"><span>' + esc(PJ.CATS[k]) + '</span>' + cnt(x.c[k], d, 'cat:' + k, BADCATS[k] || '') + '</div>').join('');
  }
  function statusRows(d) {
    const st = S.stats[d].statuses;
    return Object.keys(st).sort((a, b) => st[b] - st[a] || a.localeCompare(b)).map(s => ({ s, n: st[s], i: S.statusIndex.indexOf(s) }));
  }
  function statusList(d) {
    const rows = statusRows(d);
    if (!rows.length) return '<div class="allok">No rows</div>';
    return rows.map(r => '<div class="li"><span title="' + esc(r.s) + '">' + esc(r.s) + '</span>' + cnt(r.n, d, 'st:' + r.i) + '</div>').join('');
  }

  function vCompact(tab) {
    const x = S.stats[tab], p = PJ.pct(x.claimed, x.total);
    return '<div class="vc"><div>' +
      '<div class="tiles"><button class="tile ok" data-act="f" data-d="' + tab + '" data-k="claimed"><span>Claimed</span><b>' + fmt(x.claimed) + '</b><small>₹' + PJ.fmtAmt(x.claimedAmt) + '</small></button>' +
      '<button class="tile wn" data-act="f" data-d="' + tab + '" data-k="pending"><span>Pending</span><b>' + fmt(x.pending) + '</b><small>of ' + fmt(x.total) + '</small></button></div>' +
      '<div class="pb"><i style="width:' + p + '%"></i></div><div class="pl"><b>' + p + '%</b> claimed · ' + fmt(x.total) + ' records</div></div>' +
      '<div><h4>Needs attention</h4>' + attnList(tab) + '</div>' +
      '<div><h4>Last status (count)</h4>' + statusList(tab) + '</div></div>';
  }
  function vColumns() {
    return '<div class="vcol">' + PJ.DEPTS.map(d => {
      const x = S.stats[d], p = PJ.pct(x.claimed, x.total);
      return '<div class="card"><div class="ch"><b>' + PJ.DEPT_LABEL[d] + '</b><span>' + cnt(x.claimed, d, 'claimed', 'ok') + '/' + cnt(x.pending, d, 'pending', 'wn') + '</span></div>' +
        '<div class="pb sm"><i style="width:' + p + '%"></i></div><div class="pl2">' + p + '% claimed · ' + fmt(x.total) + ' records</div>' + attnList(d, true) + '</div>';
    }).join('') + '</div>';
  }
  function vTable() {
    const C = ['OPD', 'IPD', 'DC', 'ALL'];
    let h = '<table><thead><tr><th>Status</th>' + C.map(c => '<th>' + PJ.DEPT_LABEL[c] + '</th>').join('') + '</tr></thead><tbody>';
    h += '<tr class="sum"><td class="ok">Claimed</td>' + C.map(c => '<td>' + cnt(S.stats[c].claimed, c, 'claimed', 'ok') + '</td>').join('') + '</tr>';
    h += '<tr class="sum"><td class="wn">Pending</td>' + C.map(c => '<td>' + cnt(S.stats[c].pending, c, 'pending', 'wn') + '</td>').join('') + '</tr>';
    S.statusIndex.forEach((s, i) => {
      h += '<tr><td>' + esc(s) + '</td>' + C.map(c => '<td>' + cnt(S.stats[c].statuses[s] || 0, c, 'st:' + i) + '</td>').join('') + '</tr>';
    });
    return h + '</tbody></table>';
  }
  function ring(p) {
    const r = 21, C = 2 * Math.PI * r;
    return '<svg viewBox="0 0 54 54"><circle cx="27" cy="27" r="' + r + '" class="rt"/>' +
      (p > 0 ? '<circle cx="27" cy="27" r="' + r + '" class="rv" stroke-dasharray="' + (C * p / 100).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 27 27)"/>' : '') +
      '<text x="27" y="31" text-anchor="middle">' + p + '%</text></svg>';
  }
  function vRings() {
    return '<div class="vr">' + ['ALL', 'OPD', 'IPD', 'DC'].map(d => {
      const x = S.stats[d];
      return '<div class="rg">' + ring(PJ.pct(x.claimed, x.total)) + '<div class="rl"><b>' + PJ.DEPT_LABEL[d] + '</b>' +
        '<span class="ok">Claimed ' + cnt(x.claimed, d, 'claimed', 'ok') + '</span><span class="wn">Pending ' + cnt(x.pending, d, 'pending', 'wn') + '</span></div></div>';
    }).join('') + '</div>';
  }
  function vStatus(tab) {
    const rows = statusRows(tab);
    const max = rows.reduce((m, r) => Math.max(m, r.n), 1);
    if (!rows.length) return '<div class="allok">No rows</div>';
    return '<h4>Last status (count) · ' + PJ.DEPT_LABEL[tab] + '</h4><div class="vs">' + rows.map(r =>
      '<div class="sr"><span class="fill" style="width:' + Math.max(4, Math.round(r.n / max * 100)) + '%"></span><span title="' + esc(r.s) + '">' + esc(r.s) + '</span>' + cnt(r.n, tab, 'st:' + r.i) + '</div>').join('') + '</div>';
  }
  function vBars() {
    const max = Math.max(1, ...PJ.DEPTS.map(d => S.stats[d].total));
    return '<div class="vb">' + PJ.DEPTS.map(d => {
      const x = S.stats[d];
      const cw_ = x.claimed / max * 100, pw = x.pending / max * 100;
      const chips = PJ.DEPT_CATS[d].filter(k => x.c[k] > 0).map(k => '<span class="chip">' + esc(PJ.CATS[k]) + cnt(x.c[k], d, 'cat:' + k, BADCATS[k] || '') + '</span>').join('');
      return '<div class="br"><b>' + PJ.DEPT_LABEL[d] + '</b><div class="stk"><i class="c" style="width:' + cw_ + '%"></i><i class="p" style="width:' + pw + '%"></i></div>' +
        '<span class="bn">' + cnt(x.claimed, d, 'claimed', 'ok') + '/' + cnt(x.pending, d, 'pending', 'wn') + '</span>' +
        (chips ? '<div class="chips">' + chips + '</div>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function viewHTML(view, tab) {
    switch (view) {
      case 'columns': return vColumns();
      case 'table': return vTable();
      case 'rings': return vRings();
      case 'status': return vStatus(tab);
      case 'bars': return vBars();
      default: return vCompact(tab);
    }
  }

  function seg(key, options) {
    return '<div class="seg">' + options.map(o => '<button class="' + (S.settings[key] === o[0] ? 'on' : '') + '" data-act="set" data-k="' + key + '" data-v="' + o[0] + '">' + esc(o[1]) + '</button>').join('') + '</div>';
  }
  function toggle(key, label) {
    return '<button class="tg' + (S.settings[key] ? ' on' : '') + '" data-act="tog" data-k="' + key + '"><span>' + esc(label) + '</span><i class="sw"></i></button>';
  }
  function sheetHTML() {
    if (S.sheet === 'dates') {
      const now = new Date();
      return '<div class="sh"><div class="shh"><b>Quick dates</b><span class="note" style="margin:0">Fills From / To and presses SEARCH</span><button class="done" data-act="sheet-close">Close</button></div><div class="shb"><div class="qd">' +
        PJ.quickRanges(now).map(r => '<button data-act="qd" data-v="' + r.key + '"><b>' + r.label + '</b><small>' + PJ.dmyOf(r.from) + ' to ' + PJ.dmyOf(r.to) + '</small></button>').join('') + '</div></div></div>';
    }
    const cols = S.data ? S.data.cols : null;
    const colsHTML = Object.keys(COL_NAMES).map(k => {
      const i = cols ? cols[k] : -1;
      return '<div><span>' + COL_NAMES[k] + '</span><b class="' + (i >= 0 ? 'ok' : 'bad') + '">' + (i >= 0 ? '✓ column ' + (i + 1) : (S.data ? '✗ not found' : '–')) + '</b></div>';
    }).join('');
    return '<div class="sh"><div class="shh"><b>Views and settings</b><button class="done" data-act="sheet-close">Done</button></div><div class="shb">' +
      '<div><h5>Panel view</h5>' + seg('panelView', VIEWS) + '</div>' +
      '<div><h5>Minimized view</h5>' + seg('miniView', MINI_VIEWS) + '</div>' +
      '<div><h5>Glass</h5>' + seg('glass', [['clear', 'Clear'], ['liquid', 'Liquid glass'], ['frosted', 'Frosted']]) +
      '<h5 style="margin-top:9px">Theme</h5>' + seg('theme', [['light', 'Light'], ['dark', 'Dark']]) + '</div>' +
      '<div><h5>Upload ticker shows</h5>' + seg('tickerScope', [['month', 'This month'], ['all', 'All saved TIDs']]) +
      '<p class="note">Default is this month. On this tracker page the ticker follows the dates you searched. The ticker stays hidden when no TID is waiting.</p>' +
      toggle('hideOtherEmptyBar', 'Hide the empty "No TIDs waiting for upload" bar of other PJ tools') + '</div>' +
      '<div><h5>Tracker dates</h5>' + toggle('autoMonth', 'Open the tracker with this month (1st to today)') +
      '<p class="note">Fills From / To and presses SEARCH when you open this page. Dates you search yourself are kept.</p></div>' +
      '<div><h5>Logo</h5><div class="lgp">' + PJ.LOGO_STYLES.map(o => '<button class="' + (S.settings.logo === o[0] ? 'on' : '') + '" data-act="set" data-k="logo" data-v="' + o[0] + '">' + PJ.logoSVG(34, { style: o[0] }) + '<span>' + esc(o[1]) + '</span></button>').join('') + '</div></div>' +
      '<div><h5>Bottom bar</h5>' + toggle('dockOnScroll', 'Show a small bar at the bottom when I scroll down') +
      '<p class="note">It shows the same numbers as the minimized view. Drag the PJ logo to move it.' + (S.settings.dockPos ? '' : ' It moves up by itself so it never covers the table page buttons.') + '</p>' +
      (S.settings.dockPos ? '<div class="seg" style="margin-top:6px"><button data-act="dockreset">Reset bar position</button></div>' : '') + '</div>' +
      '<div><h5>Alerts</h5>' + toggle('alertTicker', 'Upload ticker in the top bar') + toggle('alertPopup', 'Pop-up when the portal opens') +
      toggle('alertDaily', 'Chrome notification once a day') + toggle('alertBadge', 'Number on the toolbar icon') + '</div>' +
      '<div class="cols"><h5>Columns found</h5>' + colsHTML + (S.data ? '<p class="note">Data source: ' + (S.data.source === 'datatable' ? (S.data.partial ? 'DataTable (server paging, this page only)' : 'DataTable, all pages') : 'visible rows only (this page only)') + '</p>' : '') +
      '<p class="note">Gender, Age and Card No. are needed for the daily sheet. If they show ✗, open the tracker page that has those columns (tmsBisTrack1).</p></div>' +
      '<div style="grid-column:1/-1"><h5>Rules used</h5><ul class="rules">' + PJ.RULES.map(r => '<li>' + esc(r) + '</li>').join('') + '</ul></div>' +
      '</div></div>';
  }
  function emptyHTML() {
    const waiting = !S.data;
    return '<div class="empty"><span>' + (waiting ? 'Reading the Beneficiary Details table…' : 'No records for these dates yet. Pick dates and press SEARCH.') + '</span>' +
      '<div class="qrow">' + PJ.quickRanges().map(r => '<button class="qb" data-act="qd" data-v="' + r.key + '">' + r.label + '</button>').join('') + '</div></div>';
  }

  function panelHTML(cls) {
    const d = S.data, s = S.settings;
    const tab = ['ALL', 'OPD', 'IPD', 'DC'].indexOf(s.tab) >= 0 ? s.tab : 'ALL';
    const dot = !d ? 'wait' : (d.partial ? 'part' : 'live');
    let sub = 'Waiting for the table…';
    if (d) sub = (d.range ? d.range.fromDmy + ' to ' + d.range.toDmy : 'Dates not found') + ' · ' + fmt(d.rows.length) + ' records' + (d.partial ? ' · this page only' : '');
    const has = d && d.rows.length > 0;
    let body = '';
    if (has) {
      body = '<div class="tabs">' + ['ALL', 'OPD', 'IPD', 'DC'].map(k => {
        const x = S.stats[k];
        return '<button class="tab' + (k === tab ? ' on' : '') + '" data-act="tab" data-v="' + k + '"><span>' + PJ.DEPT_LABEL[k] + '</span><em><b class="ok">' + fmt(x.claimed) + '</b> / <b class="wn">' + fmt(x.pending) + '</b></em></button>';
      }).join('') + '<span class="leg"><b class="ok">claimed</b> / <b class="wn">pending</b></span></div>' +
        '<div class="bd">' + viewHTML(s.panelView, tab) + '</div>' +
        (S.filter ? '<div class="fb"><span>Filter: <b>' + esc(S.filter.label) + '</b> · ' + fmt(S.filter.count) + ' rows</span><button data-act="unfilter">Show all</button></div>' : '');
    } else body = emptyHTML();
    const saved = S.saved ? '<span class="saved" title="Saved for the Daily sheet (Excel)">✓ ' + fmt(S.saved.count) + ' saved</span>' : '';
    return '<div class="pn ' + cls + '"><div class="hd"><span class="lg">' + PJ.logoSVG(26) + '</span>' +
      '<div class="tt"><b>RGHS Claim Status</b><span class="sub"><i class="dot ' + dot + '"></i>' + esc(sub) + '</span></div><div class="sp"></div>' + saved +
      btnIcon('report', ICON.sheet, 'Daily sheet / Excel export', null, false, 'xl') +
      btnIcon('sheet', ICON.views, 'Views and settings', 'settings', S.sheet === 'settings') +
      btnIcon('sheet', ICON.cal, 'Quick dates', 'dates', S.sheet === 'dates') +
      btnIcon('refresh', ICON.refresh, 'Refresh') +
      btnIcon('copy', ICON.copy, 'Copy summary (WhatsApp)') +
      btnIcon('min', ICON.min, 'Minimize') + '</div>' +
      body + (S.sheet ? sheetHTML() : '') + '<div class="toast"></div></div>';
  }

  /* The small summary used by the title-bar pill and by the bottom bar.
     size = logo size, rot = which department the Rotating view shows, grip = logo is a drag handle */
  function miniInner(v, size, rot, grip) {
    const st = S.stats;
    const up = tickerList().length;
    const g = grip ? ' grip" title="Drag to move' : '';
    const logo = '<span class="lg' + g + '">' + PJ.logoSVG(size) + '</span>';
    if (!st || !S.data || !S.data.rows.length) return logo + '<span class="mi"><em>Waiting for data</em></span>';
    if (v === 'pending') return logo + '<span class="mi"><em>Pending</em></span>' + PJ.DEPTS.map(d => '<span class="mi"><em>' + PJ.DEPT_LABEL[d] + '</em><b class="wn">' + fmt(st[d].pending) + '</b></span>').join('<span class="sep">·</span>');
    if (v === 'bars') return logo + PJ.DEPTS.map(d => { const x = st[d], t = Math.max(1, x.total); return '<span class="mb">' + PJ.DEPT_LABEL[d] + '<span class="stk"><i class="c" style="width:' + (x.claimed / t * 100) + '%"></i><i class="p" style="width:' + (x.pending / t * 100) + '%"></i></span></span>'; }).join('');
    if (v === 'badge') return logo + '<span class="mi"><b class="wn">' + fmt(st.ALL.pending) + '</b><em>pending</em></span><span class="mi"><b class="ok">' + fmt(st.ALL.claimed) + '</b><em>claimed</em></span>' + (up ? '<span class="rb">' + up + ' to upload</span>' : '');
    if (v === 'rotate') { const d = PJ.DEPTS[rot % 3], x = st[d]; return logo + '<span class="mi rot"><em>' + PJ.DEPT_LABEL[d] + '</em><b class="ok">' + fmt(x.claimed) + '</b> claimed <span class="sep">·</span> <b class="wn">' + fmt(x.pending) + '</b> pending</span>'; }
    if (v === 'icon') return '<span class="ico' + g + '">' + PJ.logoSVG(size + 2) + (st.ALL.pending ? '<span class="rb">' + fmt(st.ALL.pending) + '</span>' : '') + '</span>';
    return logo + PJ.DEPTS.map(d => '<span class="mi"><em>' + PJ.DEPT_LABEL[d] + '</em><b class="ok">' + fmt(st[d].claimed) + '</b>/<b class="wn">' + fmt(st[d].pending) + '</b></span>').join('<span class="sep">·</span>');
  }
  function miniHTML(cls) {
    return '<div class="mini ' + cls + '" title="RGHS Claim Status">' + miniInner(S.settings.miniView, 20, P.rot, false) +
      btnIcon('mcycle', ICON.swap, 'Change minimized view') + btnIcon('expand', ICON.expand, 'Open the panel') + '</div>';
  }

  function renderPanel() {
    if (!IS_TRACKER || DEAD) return;
    if (!P.h) {
      const x = makeHost('panel', 9990);
      P.h = x.host; P.root = x.root;
      P.root.addEventListener('click', onPanelClick);
    }
    const s = S.settings;
    S.statusIndex = S.stats ? Object.keys(S.stats.ALL.statuses).sort((a, b) => S.stats.ALL.statuses[b] - S.stats.ALL.statuses[a] || a.localeCompare(b)) : [];
    const cls = 'g t-' + s.theme + ' gl-' + s.glass;
    const bodyScroll = P.root.querySelector('.bd') ? P.root.querySelector('.bd').scrollTop : 0;
    P.root.innerHTML = '<style>' + GLASS_CSS + PANEL_CSS + '</style>' + (s.minimized ? miniHTML(cls) : panelHTML(cls));
    const bd = P.root.querySelector('.bd');
    if (bd && bodyScroll) bd.scrollTop = bodyScroll;
    positionPanel();
    clearInterval(P.rotTimer);
    if (s.minimized && s.miniView === 'rotate') {
      P.rotTimer = setInterval(() => { P.rot++; renderPanel(); }, 3200);
    }
    renderDock();
  }

  /* ================= PAYMENT TRACKER: summary card ================= */
  const PC = { h: null, root: null, min: false };
  const PAY_CSS = `
.pc{width:330px;max-width:calc(100vw - 24px);border-radius:20px;overflow:hidden;font:12px/1.35 ${FONT};animation:in .3s ease}
@keyframes in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
.pc.g{--bg:rgba(255,255,255,.82)}.pc.g.t-dark{--bg:rgba(15,23,42,.86)}
.ph{display:flex;align-items:center;gap:8px;padding:9px 8px 6px 11px}
.ph .tt{flex:1;min-width:0;display:flex;flex-direction:column}
.ph b{font-size:13px}.ph small{font-size:11px;color:var(--tx2)}
.ib{width:26px;height:26px;border-radius:9px;display:grid;place-items:center;background:var(--chip)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:2px 10px 8px}
.k{padding:6px 9px;border-radius:12px;background:var(--chip);display:flex;flex-direction:column}
.k span{font-size:10.5px;color:var(--tx2);font-weight:600}.k b{font-size:16px;font-variant-numeric:tabular-nums}
.k.ok{background:var(--okb)}.k.ok b{color:var(--ok)}.k.wn{background:var(--warnb)}.k.wn b{color:var(--warn)}
.ft{display:flex;align-items:center;gap:8px;padding:0 10px 10px}
.ft .note{flex:1;font-size:11px;color:var(--mut)}
.go{padding:6px 13px;border-radius:99px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;font-weight:700;text-shadow:none;box-shadow:0 3px 9px rgba(16,185,129,.35)}
.pill{display:flex;align-items:center;gap:7px;height:32px;padding:0 6px 0 5px;border-radius:99px;font:12px ${FONT};cursor:pointer}
.pill.g{--bg:rgba(255,255,255,.85)}.pill.g.t-dark{--bg:rgba(15,23,42,.8)}
.pill b{font-variant-numeric:tabular-nums}
`;
  function renderPayCard() {
    if (!IS_PAY || DEAD) return;
    if (!S.settings.payCard) { if (PC.h) PC.h.style.display = 'none'; return; }
    if (!PC.h) {
      const x = makeHost('paycard', 9991);
      PC.h = x.host; PC.root = x.root;
      PC.h.style.right = '16px'; PC.h.style.top = '76px';
      PC.root.addEventListener('click', e => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const a = b.dataset.act;
        if (a === 'pmin') { PC.min = true; renderPayCard(); }
        else if (a === 'pmax') { PC.min = false; renderPayCard(); }
        else if (a === 'report') PJ.send({ type: 'open:report' });
        else if (a === 'refresh') refreshNow();
        else if (a === 'hide') setSetting({ payCard: false });
      });
    }
    PC.h.style.display = 'block';
    const s = S.settings, p = S.pay;
    const cls = 'g t-' + s.theme + ' gl-' + (s.glass === 'clear' ? 'liquid' : s.glass);
    if (PC.min) {
      PC.root.innerHTML = '<style>' + GLASS_CSS + PAY_CSS + '</style><div class="pill ' + cls + '" data-act="pmax" title="Open the payment summary">' + PJ.logoSVG(22) +
        (p ? '<span>Paid <b class="ok">₹' + PJ.fmtAmt(p.paid) + '</b> · ' + fmt(p.count) + ' TIDs</span>' : '<span>Payment summary</span>') + '</div>';
      return;
    }
    let body;
    if (!p) body = '<div class="ft"><span class="note">Reading the payment table… Press SEARCH on the page if it is empty.</span></div>';
    else body = '<div class="grid"><div class="k"><span>TIDs in table</span><b>' + fmt(p.count) + '</b></div>' +
      '<div class="k ok"><span>Paid</span><b>₹' + PJ.fmtAmt(p.paid) + '</b></div>' +
      '<div class="k"><span>Approved</span><b>₹' + PJ.fmtAmt(p.approved) + '</b></div>' +
      '<div class="k wn"><span>Deduction</span><b>₹' + PJ.fmtAmt(p.deduction) + '</b></div></div>' +
      '<div class="ft"><span class="note">' + (p.saved ? '✓ Saved for the daily sheet' : 'Saving…') + (p.partial ? ' · this page only (set "Show entries" to All)' : '') + '</span>' +
      '<button class="go" data-act="report">Daily sheet</button></div>';
    PC.root.innerHTML = '<style>' + GLASS_CSS + PAY_CSS + '</style><div class="pc ' + cls + '"><div class="ph">' + PJ.logoSVG(26) +
      '<div class="tt"><b>Payment summary</b><small>' + (p ? 'Read ' + esc(PJ.timeText(p.at)) : 'Payment Tracker') + '</small></div>' +
      '<button class="ib" data-act="refresh" title="Read the table again">' + ICON.refresh + '</button>' +
      '<button class="ib" data-act="pmin" title="Minimize">' + ICON.min + '</button></div>' + body + '</div>';
  }

  /* ================= TRACKER: bottom bar when the panel is scrolled out of view ================= */
  const D = { h: null, root: null, el: null, shown: false, rot: 0, timer: null, drag: null, placed: false };
  const DOCK_CSS = `
.dock{position:relative;display:flex;align-items:center;gap:8px;height:40px;padding:0 6px 0 7px;border-radius:999px;font:12.5px/1 ${FONT};white-space:nowrap;user-select:none}
.dock.g{--bg:rgba(255,255,255,.9);--blur:22px;--sat:180%;
box-shadow:inset 0 1px 0 rgba(255,255,255,.95),0 14px 34px rgba(15,23,42,.30),0 3px 10px rgba(15,23,42,.16)}
.dock.g.t-dark{--bg:rgba(15,23,42,.9);box-shadow:inset 0 1px 0 rgba(255,255,255,.14),0 14px 34px rgba(0,0,0,.45),0 3px 10px rgba(0,0,0,.3)}
.dock.g.gl-clear{--bg:rgba(255,255,255,.8)}
.dock.g.t-dark.gl-clear{--bg:rgba(15,23,42,.8)}
.dock::before{content:"";position:absolute;inset:-1px;border-radius:inherit;padding:1.6px;pointer-events:none;
background:linear-gradient(120deg,#22d3ee,#6366f1 45%,#a855f7 75%,#ec4899);
-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}
.dock.in{animation:dockIn .32s cubic-bezier(.2,.9,.3,1.15)}
@keyframes dockIn{from{opacity:0;transform:translateY(18px) scale(.95)}to{opacity:1;transform:none}}
.dock .lg{filter:drop-shadow(0 2px 5px rgba(79,70,229,.4))}
.dock .grip{cursor:grab;touch-action:none}
.dock .grip:active{cursor:grabbing}
.dock .mi{font-size:12.5px;gap:5px}
.dock .mi b{font-size:14px;font-weight:750}
.dock .mb{font-size:12px}
.dock .mb .stk{width:52px;height:9px}
.dock .rb{height:20px;font-size:11px;padding:0 8px}
.dock .ico .rb{height:16px;font-size:10px;padding:0 5px}
.dock .dv{width:1px;height:22px;background:var(--line);flex:none}
.dock .ib{width:28px;height:28px;border-radius:99px}
.dock .ib svg.i{width:14px;height:14px}
.dock .ib.go{background:linear-gradient(135deg,#22d3ee,#6366f1 55%,#a855f7);color:#fff;border-color:transparent;box-shadow:0 3px 9px rgba(99,102,241,.4)}
.dock .ib.go:hover{filter:brightness(1.08)}
`;

  function dockHTML(cls) {
    const v = S.settings.miniView;
    const up = tickerList().length;
    const upBadge = up > 0 && v !== 'badge' ? '<span class="rb" title="TIDs waiting for upload">' + up + ' to upload</span>' : '';
    return '<div class="dock ' + cls + '" title="RGHS Claim Status">' + miniInner(v, 26, D.rot, true) + upBadge +
      '<span class="dv"></span>' + btnIcon('mcycle', ICON.swap, 'Change view') +
      '<button class="ib go" data-act="open" title="Go up and open the panel" aria-label="Go up and open the panel">' + ICON.up + '</button></div>';
  }

  function renderDock() {
    if (!IS_TRACKER || DEAD) return;
    if (!S.settings.dockOnScroll) {
      if (D.h) { D.h.style.display = 'none'; D.shown = false; }
      dockRotation();
      return;
    }
    if (!D.h) {
      const x = makeHost('dock', 2147481000);
      D.h = x.host; D.root = x.root;
      D.h.style.display = 'none';
      D.root.addEventListener('click', onPanelClick);
      D.root.addEventListener('pointerdown', dockDragStart);
      D.root.addEventListener('pointermove', dockDragMove);
      D.root.addEventListener('pointerup', dockDragEnd);
      D.root.addEventListener('pointercancel', dockDragEnd);
    }
    if (D.drag) return;
    const s = S.settings;
    D.root.innerHTML = '<style>' + GLASS_CSS + PANEL_CSS + DOCK_CSS + '</style>' + dockHTML('g t-' + s.theme + ' gl-' + s.glass);
    D.el = D.root.querySelector('.dock');
    positionDock();
    dockRotation();
  }

  function dockRotation() {
    clearInterval(D.timer); D.timer = null;
    if (D.shown && S.settings.dockOnScroll && S.settings.miniView === 'rotate') {
      D.timer = setInterval(() => { D.rot++; renderDock(); }, 3200);
    }
  }

  /* Show the bar when the panel (or the title-bar pill) has gone out of view */
  function dockWanted() {
    if (!S.settings.dockOnScroll || !S.data || !S.data.rows.length) return false;
    const a = trackerAnchors();
    if (!a) return false;
    const vh = document.documentElement.clientHeight || innerHeight;
    if (S.settings.minimized) {
      const tr = a.title.getBoundingClientRect();
      return tr.bottom < 4 || tr.top > vh - 4;
    }
    if (!P.h) return false;
    const r = P.h.getBoundingClientRect();
    if (r.height < 10) return false;
    const vis = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    return vis < Math.min(110, r.height * 0.4);
  }

  /* Portal controls the bar must not cover (table paging, "Showing x to y") */
  function dockObstacles(vw, vh) {
    const out = [];
    const rng = document.createRange();
    for (const el of document.querySelectorAll('.dataTables_paginate,.dataTables_info,.dataTables_length,ul.pagination,.pager')) {
      if (el.closest('[data-pj-rghs]')) continue;
      let r;
      try { rng.selectNodeContents(el); r = rng.getBoundingClientRect(); } catch (e) { r = null; }
      if (!r || r.width < 2 || r.height < 2) r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
      out.push(r);
    }
    return out;
  }

  function positionDock() {
    if (!D.h || D.drag) return;
    if (!dockWanted()) {
      if (D.shown) { D.shown = false; D.h.style.display = 'none'; D.placed = false; dockRotation(); }
      return;
    }
    const H = D.h.style;
    if (!D.shown) {
      D.shown = true;
      H.display = 'block';
      H.transition = 'none';
      D.placed = false;
      if (D.el) { D.el.classList.remove('in'); void D.el.offsetWidth; D.el.classList.add('in'); }
      dockRotation();
    }
    if (!D.el) return;
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = document.documentElement.clientHeight || innerHeight;
    const dw = D.el.offsetWidth, dh = D.el.offsetHeight;
    const clampL = l => Math.max(8, Math.min(vw - dw - 8, l));
    const clampT = t => Math.max(8, Math.min(vh - dh - 8, t));
    let L, Tp;
    const pos = S.settings.dockPos;
    if (pos && isFinite(pos.rx) && isFinite(pos.by)) {
      // the user moved it: keep that spot
      L = clampL(vw - dw - pos.rx); Tp = clampT(vh - dh - pos.by);
    } else {
      L = vw - dw - 20; Tp = vh - dh - 16;
      const obs = dockObstacles(vw, vh);
      const hit = (l, t) => obs.find(r => l < r.right + 8 && l + dw > r.left - 8 && t < r.bottom + 8 && t + dh > r.top - 8);
      let h = hit(L, Tp);
      if (h) {
        const a = trackerAnchors();
        const minL = a ? Math.max(8, a.card.getBoundingClientRect().left + 8) : 8;
        const L2 = h.left - 14 - dw;
        if (L2 >= minL && !hit(L2, Tp)) L = L2;      // room on the left of the paging buttons
        else {                                        // otherwise sit just above them
          let guard = 0;
          while ((h = hit(L, Tp)) && guard++ < 6) Tp = h.top - 12 - dh;
        }
      }
      L = clampL(L); Tp = clampT(Tp);
    }
    H.left = Math.round(L) + 'px';
    H.top = Math.round(Tp) + 'px';
    if (!D.placed) { D.placed = true; requestAnimationFrame(() => { if (D.h && !D.drag) D.h.style.transition = 'top .2s ease, left .2s ease'; }); }
  }

  function dockDragStart(e) {
    const g = e.target.closest('.grip');
    if (!g || e.button > 0) return;
    e.preventDefault();
    const r = D.h.getBoundingClientRect();
    D.drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false, x0: e.clientX, y0: e.clientY };
    try { g.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    D.h.style.transition = 'none';
  }
  function dockDragMove(e) {
    if (!D.drag || !D.el) return;
    if (!D.drag.moved && Math.abs(e.clientX - D.drag.x0) + Math.abs(e.clientY - D.drag.y0) < 4) return;
    D.drag.moved = true;
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = document.documentElement.clientHeight || innerHeight;
    const dw = D.el.offsetWidth, dh = D.el.offsetHeight;
    const L = Math.max(8, Math.min(vw - dw - 8, e.clientX - D.drag.dx));
    const Tp = Math.max(8, Math.min(vh - dh - 8, e.clientY - D.drag.dy));
    D.h.style.left = Math.round(L) + 'px';
    D.h.style.top = Math.round(Tp) + 'px';
  }
  function dockDragEnd() {
    if (!D.drag) return;
    const moved = D.drag.moved;
    D.drag = null;
    D.h.style.transition = 'top .2s ease, left .2s ease';
    if (!moved || !D.el) return;
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = document.documentElement.clientHeight || innerHeight;
    const r = D.h.getBoundingClientRect();
    setSetting({ dockPos: { rx: Math.round(vw - r.left - D.el.offsetWidth), by: Math.round(vh - r.top - D.el.offsetHeight) } });
  }

  function toast(msg) {
    if (!P.root) return;
    const t = P.root.querySelector('.toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(P.toastTimer);
    P.toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  function summaryText() {
    const d = S.data, st = S.stats;
    const L = ['*RGHS Claim Status*'];
    L.push('Date: ' + (d && d.range ? d.range.fromDmy + ' to ' + d.range.toDmy : '-'));
    L.push('Records: ' + fmt(d ? d.rows.length : 0) + (d && d.partial ? ' (this page only)' : ''));
    L.push('');
    PJ.DEPTS.forEach(k => {
      const x = st[k];
      L.push('*' + PJ.DEPT_LABEL[k] + '*: Claimed ' + fmt(x.claimed) + ' | Pending ' + fmt(x.pending));
      const issues = PJ.DEPT_CATS[k].filter(c => x.c[c] > 0).map(c => PJ.CATS[c] + ' ' + fmt(x.c[c]));
      L.push('Issues: ' + (issues.length ? issues.join(', ') : 'None'));
    });
    L.push('');
    const ups = tickerList();
    L.push('*TIDs to upload (' + ups.length + ')*');
    if (ups.length) ups.forEach((u, i) => L.push((i + 1) + '. ' + PJ.uploadLine(u)));
    else L.push('None');
    return L.join('\n');
  }

  function onPanelClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act, v = b.dataset.v;
    switch (act) {
      case 'tab': setSetting({ tab: v }); break;
      case 'sheet': S.sheet = S.sheet === v ? null : v; renderPanel(); break;
      case 'sheet-close': S.sheet = null; renderPanel(); break;
      case 'refresh': refreshNow(); break;
      case 'report': PJ.send({ type: 'open:report' }); break;
      case 'copy':
        if (!S.data || !S.data.rows.length) { toast('No data to copy yet'); break; }
        copyText(summaryText()).then(() => toast('Summary copied'));
        break;
      case 'min': S.sheet = null; setSetting({ minimized: true }); break;
      case 'expand': setSetting({ minimized: false }); break;
      case 'open': {
        // from the bottom bar: go back up to the tracker card and open the panel
        const a = trackerAnchors();
        if (S.settings.minimized) setSetting({ minimized: false });
        const target = a ? (a.card || a.title) : null;
        if (target) { try { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) { target.scrollIntoView(); } }
        else { try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { window.scrollTo(0, 0); } }
        break;
      }
      case 'dockreset': setSetting({ dockPos: null }); break;
      case 'mcycle': {
        const i = MINI_VIEWS.findIndex(m => m[0] === S.settings.miniView);
        setSetting({ miniView: MINI_VIEWS[(i + 1) % MINI_VIEWS.length][0] });
        break;
      }
      case 'set': setSetting({ [b.dataset.k]: v }); break;
      case 'tog': setSetting({ [b.dataset.k]: !S.settings[b.dataset.k] }); break;
      case 'qd': applyQuickDate(v); break;
      case 'f': applyFilter(b.dataset.d, b.dataset.k); break;
      case 'unfilter': clearFilter(); break;
    }
  }

  function positionPanel() {
    if (!P.h) return;
    const H = P.h.style;
    const a = trackerAnchors();
    if (S.settings.minimized) {
      const el = P.root.querySelector('.mini');
      const mh = el ? el.offsetHeight : 28;
      H.width = 'auto'; H.height = 'auto'; H.left = 'auto';
      if (a) {
        const tr = a.title.getBoundingClientRect();
        H.right = Math.round(cw() - tr.right + 8) + 'px';
        H.top = Math.round(tr.top + (tr.height - mh) / 2) + 'px';
      } else { H.right = '18px'; H.top = '72px'; }
      return;
    }
    H.right = 'auto';
    if (a) {
      const tr = a.title.getBoundingClientRect();
      const cr = a.card.getBoundingClientRect();
      if (!a.search || !a.search.isConnected) a.search = findSearchBtn(a.card);
      if ((!a.benef || !a.benef.isConnected) && Date.now() - (a.benefAt || 0) > 1000) { a.benefAt = Date.now(); a.benef = benefHeader(tr.bottom); }
      const sr = a.search ? a.search.getBoundingClientRect() : null;
      const br = a.benef ? a.benef.getBoundingClientRect() : null;
      const right = Math.min(Math.max(cr.right, tr.right), cw()) - 10;
      let left = sr && sr.right < right - 200 ? sr.right + 14 : cr.left + cr.width * 0.45;
      if (right - left < 400) left = Math.max(cr.left + 10, right - 400);
      const top = Math.min(tr.top, cr.top);
      const bottom = (br && br.top > top + 90) ? br.top - 8 : top + 250;
      const h = Math.max(120, bottom - top);
      H.left = Math.round(left) + 'px'; H.top = Math.round(top) + 'px';
      H.width = Math.round(right - left) + 'px'; H.height = Math.round(h) + 'px';
    } else {
      const w = Math.min(680, cw() - 32);
      H.left = Math.round(cw() - w - 16) + 'px'; H.top = '84px'; H.width = w + 'px'; H.height = '300px';
    }
  }

  /* ================= OTHER PAGES: find TIDs waiting for upload ================= */
  function labelValue(rx) {
    for (const el of document.querySelectorAll('td,th,label,span,b,strong,div,p,dt,li')) {
      if (el.closest('[data-pj-rghs]') || el.children.length > 3) continue;
      const t = PJ.clean(el.textContent);
      if (!t || t.length > 80) continue;
      const m = t.match(/^(.{2,40}?)\s*[:：]\s*(.+)$/);
      if (m && rx.test(m[1])) return PJ.clean(m[2]);
      if (rx.test(t.replace(/[:：]\s*$/, ''))) {
        let nx = el.nextElementSibling;
        if (!nx && el.parentElement) nx = el.parentElement.nextElementSibling;
        if (nx) { const v = PJ.clean(nx.textContent).replace(/^[:：]\s*/, ''); if (v && v.length < 80) return v; }
      }
    }
    return '';
  }
  function scanPage() {
    if (IS_TRACKER || DEAD || !document.body) return;
    const found = new Map();
    const src = pageName();
    for (const tb of document.querySelectorAll('table')) {
      if (tb.closest('[data-pj-rghs]')) continue;
      const rows = Array.from(tb.rows);
      if (rows.length < 2) continue;
      let cols = null, hi = -1;
      for (let i = 0; i < Math.min(rows.length, 4); i++) {
        const hs = Array.from(rows[i].cells).map(c => PJ.clean(c.textContent));
        if (hs.some(h => /transaction\s*id|^tid\b/i.test(h))) { cols = detectCols(hs); hi = i; break; }
      }
      for (let i = hi + 1; i < rows.length; i++) {
        const tr = rows[i];
        if (!PJ.RX_UPLOAD.test(tr.textContent || '')) continue;
        const cells = Array.from(tr.cells).map(c => PJ.clean(c.textContent));
        let tid = cols && cols.tid >= 0 ? cells[cols.tid] : '';
        if (!looksTid(tid)) tid = cells.find(looksTid) || '';
        if (!tid) continue;
        const g = (k) => cols && cols[k] >= 0 ? cells[cols[k]] || '' : '';
        found.set(tid, {
          tid, name: g('name'), dept: g('dept') ? PJ.normDept(g('dept')) : PJ.normDept(tr.textContent),
          date: PJ.parseDate(g('created')), dateRaw: g('created'), amount: PJ.parseAmount(g('amount')), source: src
        });
      }
    }
    if (!found.size && PJ.RX_UPLOAD.test(document.body.textContent || '')) {
      const tid = labelValue(/^(transaction\s*id|tid)(\s*no\.?)?$/i);
      if (looksTid(tid)) {
        const created = labelValue(/(transaction\s*id|tid)\s*created\s*on|created\s*on/i);
        found.set(tid, {
          tid, name: labelValue(/^(patient|beneficiary)\s*name$/i), dept: PJ.normDept(labelValue(/^(department|dept|tid\s*type)$/i)),
          date: PJ.parseDate(created), dateRaw: created, amount: PJ.parseAmount(labelValue(/claim\s*amount/i)), source: src
        });
      }
    }
    if (found.size) {
      const add = Array.from(found.values()).filter(a => {
        const ex = S.uploads[a.tid];
        return !ex || (!ex.name && a.name) || (!ex.date && a.date);
      });
      if (add.length) PJ.send({ type: 'uploads:sync', add, remove: [] });
    }
  }
  function highlightRows() {
    if (IS_TRACKER || DEAD || !document.body) return;
    const tids = new Set(Object.keys(S.uploads));
    document.querySelectorAll('tr[data-pj-hl]').forEach(tr => {
      if (!tids.has(tr.getAttribute('data-pj-hl'))) {
        const c = tr.cells[0];
        if (c) c.style.borderLeft = tr.getAttribute('data-pj-bl') || '';
        tr.removeAttribute('data-pj-hl'); tr.removeAttribute('data-pj-bl');
        tr.title = '';
      }
    });
    if (!tids.size) return;
    document.querySelectorAll('table tr').forEach(tr => {
      if (tr.hasAttribute('data-pj-hl') || !tr.cells.length || tr.closest('[data-pj-rghs]')) return;
      for (const c of tr.cells) {
        const t = PJ.clean(c.textContent);
        if (t && tids.has(t)) {
          const first = tr.cells[0];
          tr.setAttribute('data-pj-hl', t);
          tr.setAttribute('data-pj-bl', first.style.borderLeft || '');
          first.style.borderLeft = '4px solid #ef4444';
          tr.title = 'TID ' + t + ' is waiting for upload';
          break;
        }
      }
    });
  }
  let scanTimer = null;
  function watchPage() {
    if (IS_TRACKER || !document.body) return;
    scanPage(); highlightRows();
    new MutationObserver(() => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(() => { scanPage(); highlightRows(); TB = null; }, 700);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  /* ================= PORTAL POP-UP (bottom-right) ================= */
  const POP_CSS = `
.pop{width:340px;max-width:calc(100vw - 24px);border-radius:22px;overflow:hidden;font:12px/1.35 ${FONT};animation:in .35s cubic-bezier(.2,.9,.3,1.2)}
@keyframes in{from{opacity:0;transform:translateY(16px) scale(.97)}to{opacity:1;transform:none}}
.ph{display:flex;align-items:center;gap:9px;padding:10px 8px 6px 12px}
.ph .tt{display:flex;flex-direction:column;min-width:0;flex:1}
.ph b{font-size:13px}
.ph small{font-size:11px;color:var(--tx2)}
.x{width:26px;height:26px;border-radius:9px;display:grid;place-items:center;background:var(--chip)}
table{width:calc(100% - 20px);margin:2px 10px 6px;border-collapse:collapse;font-size:12px}
th,td{padding:3px 4px;text-align:right;font-variant-numeric:tabular-nums}
th{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--mut);font-weight:700}
th:first-child,td:first-child{text-align:left}
td:first-child{font-weight:700}
tbody tr{border-top:1px solid var(--line)}
.z{opacity:.5}
.note{margin:0 12px 6px;font-size:11px;color:var(--mut)}
.pf{display:flex;align-items:center;gap:8px;padding:6px 10px 10px 12px}
.rb{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:99px;background:linear-gradient(135deg,#f43f5e,#dc2626);color:#fff;font-weight:700;font-size:11.5px;text-shadow:none}
.rb i{width:6px;height:6px;border-radius:50%;background:#fff}
.okc{font-size:11.5px;color:var(--ok);font-weight:600}
.go{margin-left:auto;padding:6px 14px;border-radius:99px;background:linear-gradient(135deg,#22d3ee,#6366f1 55%,#a855f7);color:#fff;font-weight:700;text-shadow:none;box-shadow:0 3px 10px rgba(99,102,241,.35)}
.prog{height:3px;background:linear-gradient(90deg,#22d3ee,#6366f1,#a855f7);transform-origin:left;animation:shrink 15s linear forwards}
.pop:hover .prog{animation-play-state:paused}
@keyframes shrink{from{transform:scaleX(1)}to{transform:scaleX(0)}}
`;
  async function maybePortalPopup() {
    // not on the pages that already show a PJ panel at the bottom right
    if (IS_TRACKER || IS_PAY || IS_OPD || DEAD || !S.settings.alertPopup) return;
    const r = await PJ.get(['lastPopupAt', 'trackerUrl']);
    if (Date.now() - (r.lastPopupAt || 0) < 20 * 60 * 1000) return;
    const ms = PJ.monthStats(S.snapshot);
    const ups = PJ.scopeUploads(S.uploads, { scope: S.settings.tickerScope === 'all' ? 'all' : 'month' });
    if (!S.snapshot && !ups.length) return;
    if (!PJ.hasNotice(ms.stats, ups.length)) return; // nothing to tell - stay quiet
    await PJ.set({ lastPopupAt: Date.now() });
    showPopup(ms, ups, r.trackerUrl || PJ.TRACKER_URL);
  }
  function showPopup(ms, ups, trackerUrl) {
    const x = makeHost('popup', 2147482500);
    x.host.style.right = '18px'; x.host.style.bottom = '18px';
    const s = S.settings;
    const st = ms.stats;
    const c = (n, cls) => '<td class="' + (n ? cls : 'z') + '">' + fmt(n) + '</td>';
    const rows = PJ.DEPTS.map(d => { const v = st[d]; return '<tr><td>' + PJ.DEPT_LABEL[d] + '</td>' + c(v.claimed, 'ok') + c(v.pending, 'wn') + c(v.c.query, 'wn') + c(v.c.rejected, 'bad') + '</tr>'; }).join('');
    let note = '';
    if (!S.snapshot) note = 'No tracker check saved yet.';
    else if (!ms.count) note = 'No tracker rows saved for this month yet. Open the tracker and search "This month".';
    else if (!ms.covered && ms.range && ms.range.from) note = 'Based on the tracker check of ' + PJ.isoToDmy(ms.range.from) + ' to ' + PJ.isoToDmy(ms.range.to) + '.';
    x.root.innerHTML = '<style>' + GLASS_CSS + POP_CSS + '</style><div class="pop g t-' + s.theme + ' gl-' + (s.glass === 'clear' ? 'liquid' : s.glass) + '">' +
      '<div class="ph">' + PJ.logoSVG(28) + '<div class="tt"><b>RGHS Claim Status · ' + esc(PJ.monthLabel()) + '</b><small>Last check: ' + esc(PJ.timeText(ms.at) || '-') + '</small></div>' +
      '<button class="x" data-act="close" title="Close">' + ICON.close + '</button></div>' +
      '<table><thead><tr><th></th><th>Claimed</th><th>Pending</th><th>Query</th><th>Rejected</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      (note ? '<div class="note">' + esc(note) + '</div>' : '') +
      '<div class="pf">' + (ups.length ? '<span class="rb"><i></i>' + ups.length + ' TID' + (ups.length > 1 ? 's' : '') + ' to upload</span>' : '<span class="okc">No TIDs to upload</span>') +
      '<button class="go" data-act="open">Open tracker</button></div><div class="prog"></div></div>';
    let remaining = 15000, started = Date.now(), timer = null;
    const close = () => { clearTimeout(timer); x.host.remove(); };
    const start = () => { started = Date.now(); timer = setTimeout(close, remaining); };
    const pop = x.root.querySelector('.pop');
    pop.addEventListener('mouseenter', () => { clearTimeout(timer); remaining -= Date.now() - started; });
    pop.addEventListener('mouseleave', start);
    x.root.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'close') close();
      if (b.dataset.act === 'open') { close(); location.href = trackerUrl; }
    });
    start();
  }

  /* ================= portal menu links (for the toolbar pop-up) ================= */
  function collectLinks() {
    const out = [], seen = new Set();
    for (const a of document.querySelectorAll('a[href]')) {
      let u;
      try { u = new URL(a.getAttribute('href'), location.href); } catch (e) { continue; }
      if (u.origin !== location.origin || !/\/rghs\//i.test(u.pathname)) continue;
      if (/logout|signout|login|\.(pdf|xlsx?|docx?|zip|csv)$/i.test(u.pathname)) continue;
      const t = PJ.clean(a.textContent);
      if (t.length < 3 || t.length > 90 || /^(download|click here|here)$/i.test(t)) continue;
      const url = u.origin + u.pathname + u.search;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ title: t, url });
    }
    if (out.length < 5) return;
    PJ.get('links').then(r => { if (JSON.stringify(r.links || []) !== JSON.stringify(out)) PJ.set({ links: out, linksAt: Date.now() }); });
  }

  /* ================= layout updates ================= */
  let rafPending = false;
  function schedulePos() {
    if (rafPending || DEAD) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; positionPanel(); positionTicker(); if (IS_TRACKER) positionDock(); });
  }
  addEventListener('scroll', schedulePos, true);
  addEventListener('resize', () => { TB = null; TR = null; schedulePos(); });
  every(schedulePos, 900);

  /* ================= the empty "No TIDs waiting for upload" bar from another PJ tool ================= */
  const EMPTY_RX = /^\W*no\s+(pending\s+)?tids?\s+(are\s+)?(waiting|pending)\s+(for|to)\s+(upload|be\s+uploaded)\W*$/i;
  const HIDE_ATTR = 'data-pj-rghs-hidden';
  const HID = { inner: new Set(), style: null, obs: null, timer: null };
  const vtext = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  function shadowOf(el) {
    try {
      if (el.shadowRoot) return el.shadowRoot;
      if (typeof chrome !== 'undefined' && chrome.dom && chrome.dom.openOrClosedShadowRoot) return chrome.dom.openOrClosedShadowRoot(el);
    } catch (e) { /* ignore */ }
    return null;
  }
  // visible text of a node (skips <style> and <script>), stops early when it gets long
  function visText(root, max) {
    let out = '';
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => { const p = n.parentNode; return p && /^(STYLE|SCRIPT|TEMPLATE|NOSCRIPT)$/.test(p.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
    });
    let n;
    while ((n = tw.nextNode())) { out += ' ' + n.nodeValue; if (out.length > (max || 400)) break; }
    return vtext(out);
  }
  // the outermost element (inside root) that holds only the empty-bar text
  function emptyBox(root, stopAt) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => /waiting|pending/i.test(n.nodeValue || '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    });
    const boxes = [];
    let n;
    while ((n = tw.nextNode())) {
      let cur = n.parentElement, best = null;
      while (cur && cur !== stopAt && cur !== document.body && cur !== document.documentElement) {
        if (cur.hasAttribute && cur.hasAttribute('data-pj-own')) break;
        const t = visText(cur, 90);
        if (t.length > 70) break;
        if (EMPTY_RX.test(t)) best = cur;
        cur = cur.parentElement;
      }
      if (best) boxes.push(best);
    }
    return boxes;
  }
  function floatingOrTop(el) {
    const a = findTopBar();
    if (a && a.bar && a.bar.contains(el)) return true;
    for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      const p = getComputedStyle(e).position;
      if (p === 'fixed' || p === 'sticky' || p === 'absolute') return true;
    }
    const r = el.getBoundingClientRect();
    return r.top + scrollY < 220;
  }
  function hideOtherEmptyBars() {
    if (DEAD || !document.body) return;
    const on = S.settings.hideOtherEmptyBar !== false;
    const hosts = new Set(), inner = new Set();
    // an older copy of THIS tool (3.0 / 3.1, which cannot step aside by itself): hide its panels and pills
    document.querySelectorAll('[data-pj-rghs]').forEach(el => { const o = el.getAttribute('data-pj-own'); if (o && o !== OWN) hosts.add(el); });
    if (on) {
      // 1) plain page elements - only a floating pill or one in the top bar, never portal tables
      emptyBox(document.body, null).forEach(el => { if (!el.closest('table') && (el.hasAttribute(HIDE_ATTR) || floatingOrTop(el))) hosts.add(el); });
      // 2) elements drawn inside a shadow root (how extensions usually draw)
      const cands = new Set(Array.from(document.documentElement.children).concat(Array.from(document.body.children)));
      const a = findTopBar();
      if (a && a.bar) a.bar.querySelectorAll('*').forEach(e => cands.add(e));
      cands.forEach(el => {
        if (!el || el.nodeType !== 1 || el.getAttribute('data-pj-own') === OWN || el.id === 'pj-auto-opd') return;
        const sr = shadowOf(el);
        if (!sr) return;
        const t = visText(sr, 200);
        if (!t || t.length > 3000) return;
        if (EMPTY_RX.test(t)) hosts.add(el);                    // the whole thing is just the empty pill
        else if (/waiting|pending/i.test(t)) emptyBox(sr, sr).forEach(x => inner.add(x)); // a bigger widget: hide only the pill part
      });
    }
    // apply
    if (hosts.size && !HID.style) {
      HID.style = document.createElement('style');
      HID.style.setAttribute('data-pj-own', OWN);
      HID.style.textContent = '[' + HIDE_ATTR + ']{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important}';
      (document.head || document.documentElement).appendChild(HID.style);
    }
    document.querySelectorAll('[' + HIDE_ATTR + ']').forEach(el => { if (!hosts.has(el)) el.removeAttribute(HIDE_ATTR); });
    hosts.forEach(el => { if (!el.hasAttribute(HIDE_ATTR)) el.setAttribute(HIDE_ATTR, ''); });
    HID.inner.forEach(el => { if (!inner.has(el) || !el.isConnected) { try { el.style.removeProperty('display'); } catch (e) { /* ignore */ } HID.inner.delete(el); } });
    inner.forEach(el => { if (!HID.inner.has(el)) { el.style.setProperty('display', 'none', 'important'); HID.inner.add(el); } });
  }
  function watchOtherBars() {
    hideOtherEmptyBars();
    if (HID.obs || !document.body) return;
    let t = null;
    HID.obs = new MutationObserver(() => { if (t) return; t = setTimeout(() => { t = null; hideOtherEmptyBars(); }, 60); });
    HID.obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    HID.obs.observe(document.documentElement, { childList: true });
    every(hideOtherEmptyBars, 1500); // changes inside other tools' shadow roots are not seen by the observer
  }

  /* ================= another copy of a PJ tool running? ================= */
  /* Old "PJ RGHS Claim Status" or "PJ Auto OPD Claim" extensions next to this suite draw a second panel.
     Only a real second copy counts here - the empty upload pill of another tool is simply hidden (above). */
  const DUP = { h: null };
  function otherCopyRunning() {
    if ($$('[data-pj-rghs]').some(el => el.getAttribute('data-pj-own') !== OWN && el.getAttribute('data-pj-own'))) return true;
    if (document.querySelectorAll('#pj-auto-opd').length > 1) return true;
    const kids = Array.from(document.documentElement.children).concat(document.body ? Array.from(document.body.children) : []);
    return kids.some(el => {
      if (el.getAttribute('data-pj-own') === OWN || el.hasAttribute(HIDE_ATTR) || el.id === 'pj-auto-opd') return false;
      const sr = shadowOf(el);
      return !!sr && /RGHS\s+Claim\s+Status/i.test(visText(sr, 600));
    });
  }
  function checkOtherCopy() {
    if (DEAD) return;
    const dup = otherCopyRunning();
    let dismissed = false;
    try { dismissed = sessionStorage.getItem('pjRghsDupOk') === '1'; } catch (e) { /* ignore */ }
    if (!dup || dismissed) { if (DUP.h) { DUP.h.remove(); DUP.h = null; } return; }
    if (DUP.h) return;
    const x = makeHost('dupwarn', 2147483200);
    DUP.h = x.host;
    x.host.style.left = '16px'; x.host.style.bottom = '16px';
    const s = S.settings;
    x.root.innerHTML = '<style>' + GLASS_CSS + `
.dw{width:330px;max-width:calc(100vw - 32px);display:flex;gap:10px;align-items:flex-start;padding:11px 12px;border-radius:18px;font:12px/1.4 ${FONT};animation:in .3s ease}
.dw.g{--bg:rgba(255,255,255,.93)}.dw.g.t-dark{--bg:rgba(15,23,42,.93)}
@keyframes in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.dw b{display:block;font-size:12.5px;color:var(--bad);margin-bottom:2px}
.dw p{color:var(--tx2)}
.dw code{font-family:Consolas,monospace;font-size:11.5px;background:var(--chip);padding:0 4px;border-radius:5px}
.dw button{margin-top:7px;padding:4px 13px;border-radius:99px;background:linear-gradient(135deg,#22d3ee,#6366f1 55%,#a855f7);color:#fff;font-weight:700;text-shadow:none}
.dw .lg{flex:none}` + '</style><div class="dw g t-' + s.theme + ' gl-frosted"><span class="lg">' + PJ.logoSVG(30) + '</span><div>' +
      '<b>An older PJ tool is still installed</b><p>Open <code>chrome://extensions</code> and click <b style="display:inline;color:inherit">Remove</b> on the old "PJ RGHS Claim Status" and "PJ Auto OPD Claim". Keep only "PJ RGHS Suite" ' + PJ.VERSION + ' - it has both.</p>' +
      '<button data-act="ok">Got it</button></div></div>';
    x.root.addEventListener('click', e => {
      if (!e.target.closest('[data-act=ok]')) return;
      try { sessionStorage.setItem('pjRghsDupOk', '1'); } catch (_) { /* ignore */ }
      if (DUP.h) { DUP.h.remove(); DUP.h = null; }
    });
  }

  /* ================= tracker opens with this month's dates ================= */
  const SEARCH_KEY = 'pjRghsSearchAt';
  function noteUserSearch() { try { sessionStorage.setItem(SEARCH_KEY, String(Date.now())); } catch (e) { /* ignore */ } }
  function watchSearchClicks() {
    document.addEventListener('click', e => {
      const t = e.target && e.target.closest && e.target.closest('button, input[type=button], input[type=submit], a');
      if (!t || t.closest('[data-pj-rghs]')) return;
      if (/\bsearch\b/i.test(PJ.clean(t.innerText || t.value || t.textContent || ''))) noteUserSearch();
    }, true);
    document.addEventListener('submit', noteUserSearch, true);
  }
  function autoMonth(tries) {
    if (DEAD || !IS_TRACKER || !S.settings.autoMonth) return;
    let last = 0;
    try { last = +sessionStorage.getItem(SEARCH_KEY) || 0; } catch (e) { /* ignore */ }
    if (Date.now() - last < 3 * 60 * 1000) return; // this load came from a SEARCH - keep those dates
    const d = findDateInputs();
    if (!d.from || !d.to) { if ((tries || 0) < 8) setTimeout(() => autoMonth((tries || 0) + 1), 700); return; }
    const r = PJ.quickRanges().find(x => x.key === 'thisMonth');
    if (PJ.parseDate(d.from.value) === PJ.isoOf(r.from) && PJ.parseDate(d.to.value) === PJ.isoOf(r.to)) return; // already this month
    applyQuickDate('thisMonth');
  }

  /* ================= start ================= */
  async function init() {
    await load();
    renderTicker();
    watchOtherBars();
    if (IS_TRACKER) {
      renderPanel();
      PJ.set({ trackerUrl: location.origin + location.pathname });
      setTimeout(() => { if (!S.data) toBridge({ type: 'read' }); }, 1200);
      setTimeout(() => autoMonth(0), 900);
      watchSearchClicks();
    } else {
      watchPage();
      if (IS_PAY) { renderPayCard(); setTimeout(() => { if (!S.pay) toBridge({ type: 'read' }); }, 1200); }
      setTimeout(maybePortalPopup, 1500);
    }
    setTimeout(collectLinks, 2000);
    setTimeout(checkOtherCopy, 3000);
    every(checkOtherCopy, 15000);
    PJ.send({ type: 'portal:opened' });
    // a new month may start while the page is open
    every(() => { T.sig = ''; renderTicker(); }, 10 * 60 * 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
