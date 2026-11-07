/* PJ RGHS Suite - toolbar pop-up */
(function () {
  'use strict';
  const PJ = self.PJ;
  const esc = PJ.esc, fmt = PJ.fmt;
  const $ = id => document.getElementById(id);
  const HOSPEDIA = 'http://117.211.8.251/';

  const FAVS = [
    { name: 'Transaction ID Tracker', url: /tmsBisTrack(?!1)/i, title: /^transaction\s*id\s*tracker(?!.*download)/i },
    { name: 'Individual TID Status Tracker', title: /individual\s*tid/i },
    { name: 'Claim Submission', title: /claim\s*submission/i },
    { name: 'Claim Query Panel', title: /query\s*panel/i },
    { name: 'Payment Tracker', url: /tmsPaymentTrack/i, title: /payment\s*tracker/i },
    { name: 'Appeal Against Rejected TIDs', title: /appeal/i },
    { name: 'OPD TID Details', url: /tmsOPDDetails/i, title: /opd\s*tid\s*details/i }
  ];
  const FIXED = { 'Transaction ID Tracker': () => state.trackerUrl || PJ.TRACKER_URL, 'Payment Tracker': () => PJ.PAYMENT_URL, 'OPD TID Details': () => PJ.OPD_URL };

  const state = { settings: Object.assign({}, PJ.DEFAULTS), uploads: {}, snapshot: null, links: [], trackerUrl: '', statScope: 'month', upScope: 'month',
    pjRows: [], pjStatus: {}, sheet: null, tab: null };

  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1500);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (_) { /* ignore */ }
      ta.remove();
    }
    toast('Copied');
  }
  async function openUrl(url) {
    try {
      const tab = state.tab;
      if (tab && tab.url && tab.url.indexOf(PJ.PORTAL + '/') === 0) await chrome.tabs.update(tab.id, { url });
      else await chrome.tabs.create({ url });
    } catch (e) {
      try { await chrome.tabs.create({ url }); } catch (_) { /* ignore */ }
    }
    window.close();
  }
  function setSeg(id, v) {
    $(id).querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  }

  /* ---------- claim status ---------- */
  function renderStats() {
    const snap = state.snapshot;
    setSeg('statScope', state.statScope);
    if (!snap) { $('statBox').innerHTML = '<div class="empty">Open the Transaction ID Tracker and press SEARCH once. The last check is saved here.</div>'; return; }
    let st, note = '';
    if (state.statScope === 'month') {
      const ms = PJ.monthStats(snap);
      st = ms.stats;
      if (!ms.count) note = 'No rows from ' + PJ.monthLabel() + ' in the last check. Search "This month" on the tracker.';
      else if (!ms.covered && ms.range && ms.range.from) note = 'From the check of ' + PJ.isoToDmy(ms.range.from) + ' to ' + PJ.isoToDmy(ms.range.to) + '.';
      else note = PJ.monthLabel() + ' · ' + fmt(ms.count) + ' records';
    } else {
      st = PJ.computeStats(PJ.snapshotRows(snap));
      note = (snap.range ? PJ.isoToDmy(snap.range.from) + ' to ' + PJ.isoToDmy(snap.range.to) + ' · ' : '') + fmt(snap.total) + ' records' + (snap.partial ? ' (this page only)' : '');
    }
    const c = (n, cls) => '<td class="' + (n ? cls : 'z') + '">' + fmt(n) + '</td>';
    const row = (d, cls) => { const x = st[d]; return '<tr class="' + (cls || '') + '"><td>' + PJ.DEPT_LABEL[d] + '</td>' + c(x.claimed, 'ok') + c(x.pending, 'wn') + c(x.c.query, 'wn') + c(x.c.rejected, 'bad') + c(x.c.toUpload, 'bad') + '</tr>'; };
    $('statBox').innerHTML = '<table><thead><tr><th></th><th>Claimed</th><th>Pending</th><th>Query</th><th>Rejected</th><th>Upload</th></tr></thead><tbody>' +
      PJ.DEPTS.map(d => row(d)).join('') + row('ALL', 'tot') + '</tbody></table><p class="note">' + esc(note) + '</p>';
  }

  /* ---------- daily sheet data ---------- */
  function renderSheet() {
    const ym = PJ.monthKey();
    $('sheetMonth').textContent = PJ.ymLabel(ym);
    const m = (state.sheet || {})[ym] || { r: 0, h: 0, p: 0 };
    const k = (label, v, cls) => '<div class="kpi"><span>' + label + '</span><b class="' + (cls || '') + '">' + fmt(v) + '</b></div>';
    $('sheetKpis').innerHTML = k('RGHS TIDs', m.r) + k('Hospedia', m.h) + k('Payments', m.p) + k('Months', Object.keys(state.sheet || {}).filter(x => x !== 'misc').length);
    $('sheetNote').textContent = m.r || m.h ? 'Updated ' + PJ.timeText(m.at) + '. Open to see each day and download the Excel.' :
      'Open the Transaction ID Tracker (and tmsBisTrack1), the Payment Tracker and the Hospedia report once - the data is saved here by itself.';
  }

  /* ---------- OPD claim filler ---------- */
  function renderOpd() {
    const rows = state.pjRows || [];
    if (!rows.length) { $('opdBox').innerHTML = '<div class="empty">No claims loaded. On Hospedia open Panel Wise Invoice Summary (RGHS NEW) and press "Make RGHS claim list".</div>'; return; }
    const n = { Waiting: 0, Ready: 0, Check: 0, Error: 0, Done: 0 };
    rows.forEach(r => { const s = (state.pjStatus[r.tid] || {}).s || 'Waiting'; n[s in n ? s : 'Waiting']++; });
    const t = rows.length;
    const k = (label, v, cls) => '<div class="kpi"><span>' + label + '</span><b class="' + (cls || '') + '">' + fmt(v) + '</b></div>';
    $('opdBox').innerHTML = '<div class="kpis">' + k('Claims', t) + k('Waiting', n.Waiting) + k('Check', n.Check + n.Error, n.Check + n.Error ? 'wn' : '') + k('Done', n.Done, 'ok') + '</div>' +
      '<div class="bar"><i style="width:' + (n.Done / t * 100) + '%;background:#10b981"></i><i style="width:' + ((n.Ready) / t * 100) + '%;background:#22d3ee"></i><i style="width:' + ((n.Check + n.Error) / t * 100) + '%;background:#f59e0b"></i></div>';
  }

  /* ---------- upload list ---------- */
  function upList() { return PJ.scopeUploads(state.uploads, { scope: state.upScope === 'all' ? 'all' : 'month' }); }
  function renderUploads() {
    setSeg('upScope', state.upScope);
    const list = upList();
    const all = Object.keys(state.uploads).length;
    $('upCount').textContent = list.length;
    $('upCount').style.display = list.length ? '' : 'none';
    if (!list.length) {
      $('upList').innerHTML = '<div class="empty">' + (all ? 'No TIDs to upload this month. ' + all + ' older TID' + (all > 1 ? 's are' : ' is') + ' saved — tap "All" to see.' : 'No TIDs waiting for upload.') + '</div>';
      $('upFoot').style.display = 'none';
      return;
    }
    $('upList').innerHTML = list.map(u =>
      '<div class="it"><div class="l1"><b>' + esc(u.tid) + '</b><span class="tag">' + esc(PJ.DEPT_LABEL[u.dept] || u.dept || '-') + '</span><span>₹' + esc(PJ.fmtAmt(u.amount)) + '</span></div>' +
      '<div class="l2">' + esc(u.name || '-') + ' · ' + esc(PJ.isoToDmy(u.date) || u.dateRaw || '-') + '</div>' +
      '<div class="bt"><button class="sbtn" data-act="copy" data-tid="' + esc(u.tid) + '">Copy</button><button class="sbtn" data-act="done" data-tid="' + esc(u.tid) + '">Done</button></div></div>').join('');
    const hidden = all - list.length;
    $('upHint').textContent = hidden > 0 ? hidden + ' from other months hidden' : '';
    $('upFoot').style.display = '';
  }

  /* ---------- portal links ---------- */
  function linkItems() {
    const links = state.links || [];
    const favs = [];
    const used = new Set();
    FAVS.forEach(f => {
      let l = links.find(x => !used.has(x.url) && f.url && f.url.test(x.url)) || links.find(x => !used.has(x.url) && f.title.test(x.title));
      if (!l && FIXED[f.name]) l = { title: f.name, url: FIXED[f.name]() };
      if (l) { used.add(l.url); favs.push({ title: l.title, url: l.url, fav: true }); }
    });
    const rest = links.filter(l => !used.has(l.url)).map(l => ({ title: l.title, url: l.url, fav: false }));
    return favs.concat(rest);
  }
  function renderLinks() {
    const q = ($('q').value || '').trim().toLowerCase();
    const items = linkItems().filter(l => !q || l.title.toLowerCase().indexOf(q) !== -1);
    let html = items.map(l => '<button class="lk" data-url="' + esc(l.url) + '" title="' + esc(l.url) + '"><span class="s' + (l.fav ? '' : ' off') + '">★</span><span>' + esc(l.title) + '</span></button>').join('');
    if (!html) html = '<div class="empty">' + (state.links.length ? 'No page matches.' : 'Open the RGHS portal once to load its menu here.') + '</div>';
    $('links').innerHTML = html;
  }

  /* ---------- alerts ---------- */
  const TOGGLES = [
    ['alertTicker', 'Upload ticker in the top bar'],
    ['alertPopup', 'Pop-up when the portal opens'],
    ['alertDaily', 'Chrome notification once a day'],
    ['alertBadge', 'Number on the toolbar icon'],
    ['payCard', 'Summary card on the Payment Tracker']
  ];
  function renderToggles() {
    $('toggles').innerHTML = TOGGLES.map(t => '<button class="tg' + (state.settings[t[0]] ? ' on' : '') + '" data-k="' + t[0] + '"><span>' + t[1] + '</span><i class="sw"></i></button>').join('');
    setSeg('tickScope', state.settings.tickerScope === 'all' ? 'all' : 'month');
    setSeg('themePick', state.settings.theme === 'dark' ? 'dark' : 'light');
    document.body.classList.toggle('dark', state.settings.theme === 'dark');
    renderLogo();
  }
  function renderLogo() {
    const cur = state.settings.logo || 'midnight';
    PJ.setLogoStyle(cur);
    if ($('logo').dataset.style !== cur) { $('logo').innerHTML = PJ.logoSVG(40); $('logo').dataset.style = cur; }
    $('logoPick').innerHTML = PJ.LOGO_STYLES.map(s => '<button class="lp' + (s[0] === cur ? ' on' : '') + '" data-v="' + s[0] + '">' + PJ.logoSVG(40, { style: s[0] }) + '<span>' + esc(s[1]) + '</span></button>').join('');
  }
  async function saveSettings(patch) {
    state.settings = await PJ.saveSettings(patch);
    renderToggles();
  }

  function renderHeader() {
    $('lastCheck').textContent = state.snapshot ? 'Last tracker check: ' + PJ.timeText(state.snapshot.at) : 'No tracker check saved yet';
    const u = (state.tab && state.tab.url) || '';
    $('opdLabel').textContent = u.indexOf(HOSPEDIA) === 0 ? 'Make claim list' : 'OPD claims';
  }

  async function load() {
    const r = await PJ.get(['settings', 'uploads', 'snapshot', 'links', 'trackerUrl', 'pjRows', 'pjStatus', 'dataIndex']);
    state.settings = Object.assign({}, PJ.DEFAULTS, r.settings || {});
    state.uploads = r.uploads || {};
    state.snapshot = r.snapshot || null;
    state.links = r.links || [];
    state.trackerUrl = r.trackerUrl || '';
    state.pjRows = r.pjRows || [];
    state.pjStatus = r.pjStatus || {};
    state.sheet = r.dataIndex || {};
    state.upScope = state.settings.tickerScope === 'all' ? 'all' : 'month';
    try { const tabs = await chrome.tabs.query({ active: true, currentWindow: true }); state.tab = tabs && tabs[0]; } catch (e) { state.tab = null; }
    renderHeader(); renderStats(); renderSheet(); renderOpd(); renderUploads(); renderLinks(); renderToggles();
  }

  /* OPD panel: on the OPD page show / hide it, on Hospedia make the claim list, anywhere else open the OPD page */
  async function opdAction() {
    const tab = state.tab, u = (tab && tab.url) || '';
    if (tab && (/tmsOPDDetails/i.test(u) || u.indexOf(HOSPEDIA) === 0)) {
      try { await chrome.tabs.sendMessage(tab.id, { type: 'PJ_TOGGLE_PANEL' }); window.close(); return; } catch (e) { /* page not ready: open it */ }
    }
    openUrl(PJ.OPD_URL);
  }
  function openSheet() { PJ.send({ type: 'open:report' }).then(() => window.close()); }

  /* ---------- events ---------- */
  $('logoPick').addEventListener('click', e => { const b = e.target.closest('.lp'); if (b) saveSettings({ logo: b.dataset.v }); });
  $('ver').textContent = 'PJ RGHS Suite · v' + ((chrome.runtime.getManifest && chrome.runtime.getManifest().version) || PJ.VERSION) + ' · data stays in this Chrome';
  $('actSheet').addEventListener('click', openSheet);
  $('openSheet').addEventListener('click', openSheet);
  $('actTracker').addEventListener('click', () => openUrl(state.trackerUrl || PJ.TRACKER_URL));
  $('actPay').addEventListener('click', () => openUrl(PJ.PAYMENT_URL));
  $('actOpd').addEventListener('click', opdAction);
  $('opdToggle').addEventListener('click', opdAction);
  $('statScope').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { state.statScope = b.dataset.v; renderStats(); } });
  $('upScope').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { state.upScope = b.dataset.v; renderUploads(); } });
  $('tickScope').addEventListener('click', e => { const b = e.target.closest('button'); if (b) saveSettings({ tickerScope: b.dataset.v }); });
  $('themePick').addEventListener('click', e => { const b = e.target.closest('button'); if (b) saveSettings({ theme: b.dataset.v }); });
  $('toggles').addEventListener('click', e => { const b = e.target.closest('.tg'); if (b) saveSettings({ [b.dataset.k]: !state.settings[b.dataset.k] }); });
  $('upList').addEventListener('click', async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const tid = b.dataset.tid;
    if (b.dataset.act === 'copy') copy(tid);
    if (b.dataset.act === 'done') {
      delete state.uploads[tid];
      renderUploads();
      await PJ.send({ type: 'uploads:done', tids: [tid] });
      toast('Removed from the list');
    }
  });
  $('copyAll').addEventListener('click', () => copy(PJ.uploadsText(upList())));
  $('q').addEventListener('input', renderLinks);
  $('q').addEventListener('keydown', e => { if (e.key === 'Enter') { const f = $('links').querySelector('.lk'); if (f) openUrl(f.dataset.url); } });
  $('links').addEventListener('click', e => { const b = e.target.closest('.lk'); if (b) openUrl(b.dataset.url); });

  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local') return;
      if (ch.uploads) { state.uploads = ch.uploads.newValue || {}; renderUploads(); }
      if (ch.snapshot) { state.snapshot = ch.snapshot.newValue || null; renderHeader(); renderStats(); }
      if (ch.settings) { state.settings = Object.assign({}, PJ.DEFAULTS, ch.settings.newValue || {}); renderToggles(); }
      if (ch.dataIndex) { state.sheet = ch.dataIndex.newValue || {}; renderSheet(); }
      if (ch.pjRows || ch.pjStatus) { if (ch.pjRows) state.pjRows = ch.pjRows.newValue || []; if (ch.pjStatus) state.pjStatus = ch.pjStatus.newValue || {}; renderOpd(); }
    });
  } catch (e) { /* ignore */ }

  load();
})();
