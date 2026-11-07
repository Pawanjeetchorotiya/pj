/* PJ RGHS Suite - page bridge (runs in the MAIN world on the Transaction ID Tracker pages and the Payment Tracker).
   Reads every row of the portal DataTable that has a Transaction Id column through the DataTables API
   (all pages, not only the visible one) and sends it to the content script with window.postMessage.
   Also applies row filters for the panel. */
(function () {
  'use strict';
  if (!/tmsBisTrack|tmsPaymentTrack/i.test(location.href)) return;
  if (window.__pjRghsBridge) return;
  window.__pjRghsBridge = true;

  const OUT = 'PJ_RGHS_BRIDGE';
  const IN = 'PJ_RGHS_CS';
  const MAX_COLS = 80;

  let target = null;      // {node, api}
  let lastSig = '';
  let filterSet = null;   // Set of normalised TIDs, or null
  let filterInstalled = false;
  let tidCol = -1;
  let misses = 0;
  let noDtSent = false;
  const hooked = new WeakSet();

  const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const key = s => String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/\s+/g, '').toLowerCase();
  const ta = document.createElement('textarea');
  function strip(v) {
    if (v == null) return '';
    if (typeof v === 'object') { try { v = v.display != null ? v.display : JSON.stringify(v); } catch (e) { v = ''; } }
    let s = String(v);
    if (s.indexOf('<') !== -1) s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ');
    if (s.indexOf('&') !== -1) { try { ta.innerHTML = s; s = ta.value; } catch (e) { /* keep */ } }
    return s.replace(/\s+/g, ' ').trim();
  }
  function post(msg) {
    msg.src = OUT;
    msg.page = /tmsPaymentTrack/i.test(location.href) ? 'payment' : 'tracker';
    try { window.postMessage(msg, location.origin); } catch (e) { /* ignore */ }
  }
  function jq() {
    const c = [window.jQuery, window.$];
    for (const j of c) { if (j && j.fn && j.fn.dataTable) return j; }
    return null;
  }

  function findTable() {
    const $ = jq();
    if (!$) return null;
    let nodes = [];
    try { nodes = $.fn.dataTable.tables(); } catch (e) { return null; }
    let best = null, bestScore = 0;
    for (const n of nodes) {
      try {
        const api = new $.fn.dataTable.Api(n);
        const heads = api.columns().header().toArray().map(h => norm(h && h.textContent));
        let score = 0;
        if (heads.some(h => h.indexOf('transactionid') !== -1 || h === 'tid' || h === 'tidno')) score += 5;
        if (heads.some(h => h.indexOf('status') !== -1)) score += 2;
        if (heads.some(h => h.indexOf('department') !== -1)) score += 2;
        if (heads.some(h => h.indexOf('amount') !== -1)) score += 1;
        let rows = 0;
        try { rows = api.rows().count(); } catch (e) { /* ignore */ }
        if (rows > 0) score += 0.5;
        if (score > bestScore) { bestScore = score; best = { node: n, api, heads }; }
      } catch (e) { /* skip */ }
    }
    return best && bestScore >= 5 ? best : null;
  }

  function findTidCol(heads) {
    let i = heads.findIndex(h => h === 'transactionid' || h === 'tid' || h === 'transactionidno' || h === 'tidno');
    if (i < 0) i = heads.findIndex(h => h.indexOf('transactionid') !== -1 && h.indexOf('status') === -1 && h.indexOf('created') === -1 && h.indexOf('date') === -1);
    return i;
  }

  function colRaw(api, c) {
    try { return api.column(c, { order: 'index' }).data().toArray(); } catch (e) { return []; }
  }

  function signature(t) {
    const api = t.api;
    let n = 0;
    try { n = api.rows().count(); } catch (e) { return ''; }
    const cols = [];
    t.heads.forEach((h, i) => { if (/transaction|status|amount|paid|utr/.test(h)) cols.push(i); });
    let str = n + '|';
    cols.forEach(c => { const d = colRaw(api, c); str += d.length + ':' + d.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join('\u0001') + '|'; });
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return n + '-' + h;
  }

  function readAll(t) {
    const api = t.api;
    const nCols = Math.min(MAX_COLS, api.columns().count());
    const headers = [];
    for (let c = 0; c < nCols; c++) {
      let h = '';
      try { h = strip(api.column(c).header().textContent); } catch (e) { /* ignore */ }
      headers.push(h);
    }
    const rowIdx = api.rows({ order: 'index' }).indexes().toArray();
    const rows = rowIdx.map(() => new Array(nCols).fill(''));
    for (let c = 0; c < nCols; c++) {
      if (!headers[c] || /^(action|view|select|#)$/i.test(headers[c])) continue;
      let vals = null;
      try { vals = api.cells(null, c, { order: 'index' }).render('display').toArray(); } catch (e) { vals = null; }
      if (!vals || vals.length !== rowIdx.length) vals = colRaw(api, c);
      for (let r = 0; r < rowIdx.length; r++) rows[r][c] = strip(vals[r]);
    }
    let serverSide = false;
    try { serverSide = !!(api.settings()[0].oFeatures.bServerSide); } catch (e) { /* ignore */ }
    return { type: 'data', headers, rows, serverSide, total: rowIdx.length };
  }

  function installFilter($) {
    if (filterInstalled) return;
    filterInstalled = true;
    $.fn.dataTable.ext.search.push(function (settings, data) {
      if (!filterSet || !target || settings.nTable !== target.node) return true;
      if (tidCol >= 0) return filterSet.has(key(data[tidCol]));
      for (const v of data) { if (filterSet.has(key(v))) return true; }
      return false;
    });
  }

  function hook(t) {
    if (hooked.has(t.node)) return;
    hooked.add(t.node);
    try { t.api.on('xhr.dt', () => setTimeout(() => tick(false), 300)); } catch (e) { /* ignore */ }
    try { t.api.on('draw.dt', () => setTimeout(() => tick(false), 150)); } catch (e) { /* ignore */ }
  }

  function tick(force) {
    const t = findTable();
    if (!t) {
      misses++;
      if (misses >= 6 && !noDtSent) { noDtSent = true; post({ type: 'nodt' }); }
      return;
    }
    if (!target || target.node !== t.node) {
      target = t;
      tidCol = findTidCol(t.heads);
      lastSig = '';
      filterSet = null;
      hook(t);
    }
    const $ = jq();
    if ($) installFilter($);
    const sig = signature(t);
    if (force || sig !== lastSig) {
      lastSig = sig;
      try { post(readAll(t)); } catch (e) { post({ type: 'error', message: String(e && e.message || e) }); }
    }
  }

  function applyFilter(tids) {
    if (!target) return post({ type: 'filtered', count: 0, active: false });
    filterSet = tids ? new Set(tids.map(key)) : null;
    try {
      target.api.draw();
      const count = target.api.rows({ search: 'applied' }).count();
      post({ type: 'filtered', count, active: !!filterSet });
    } catch (e) { post({ type: 'filtered', count: 0, active: !!filterSet }); }
  }

  window.addEventListener('message', ev => {
    if (ev.source !== window || !ev.data || ev.data.src !== IN) return;
    const m = ev.data;
    if (m.type === 'read') tick(true);
    else if (m.type === 'filter') applyFilter(m.tids || null);
  });

  setInterval(() => { try { tick(false); } catch (e) { /* ignore */ } }, 1500);
  setTimeout(() => tick(true), 300);
})();
