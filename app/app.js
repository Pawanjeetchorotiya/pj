/* PJ RGHS Daily Sheet - the page behind the "Daily sheet" button of the extension, and the mobile app.
   Extension: the data comes from chrome.storage (saved while you use the RGHS portal and Hospedia).
   Mobile / browser: the data comes from files you import (RGHS tracker Excel, Hospedia report Excel,
   an older daily sheet, or a backup from the extension). Everything stays on this device. */
(function () {
  'use strict';
  const PJ = self.PJ, DS = self.DailySheet, X = self.XLSX;
  const $ = (id) => document.getElementById(id);
  const esc = PJ.esc, fmt = PJ.fmt, amt = (n) => '₹' + PJ.fmtAmt(n);
  const IS_EXT = !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && chrome.storage && chrome.storage.local);

  /* ---------- storage ---------- */
  function idbKV() {
    let dbp = null;
    const db = () => (dbp = dbp || new Promise((res, rej) => {
      const r = indexedDB.open('pj-rghs-app', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('kv', mode); const req = fn(t.objectStore('kv')); t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); }); };
    return {
      get: (k) => tx('readonly', (o) => o.get(k)),
      set: (k, v) => tx('readwrite', (o) => o.put(v, k)),
      keys: () => tx('readonly', (o) => o.getAllKeys())
    };
  }
  const chromeKV = {
    get: (k) => new Promise((res) => chrome.storage.local.get(k, (r) => res(r && r[k]))),
    set: (k, v) => new Promise((res) => chrome.storage.local.set({ [k]: v }, () => res())),
    keys: () => new Promise((res) => chrome.storage.local.get(null, (r) => res(Object.keys(r || {}))))
  };
  const kv = IS_EXT ? chromeKV : idbKV();
  const store = DS.makeStore(kv);
  // In the extension, writes go through the background queue so a portal tab saving at the same time cannot be lost.
  const send = (msg) => new Promise((res) => { try { chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; res(r); }); } catch (e) { res(null); } });
  const save = {
    records: (list) => IS_EXT ? send({ type: 'records:put', records: list }) : store.saveRecords(list),
    hospedia: (map) => IS_EXT ? send({ type: 'hospedia:putSum', hospedia: map }) : store.saveHospedia(map),
    payments: (map) => IS_EXT ? send({ type: 'payments:put', payments: map }) : store.savePayments(map),
    clear: (ym) => IS_EXT ? send({ type: 'month:clear', month: ym }) : store.clearMonth(ym)
  };

  /* ---------- state ---------- */
  const st = { month: PJ.monthKey(), dept: 'OPD', pending: false, day: null, built: null, q: '', chk: 'All', chkAll: false, theme: '' };
  try { const p = JSON.parse(localStorage.getItem('pjSheetPrefs') || '{}'); Object.assign(st, { dept: p.dept || 'OPD', pending: !!p.pending, theme: p.theme || '' }); } catch (e) { /* ignore */ }
  const savePrefs = () => { try { localStorage.setItem('pjSheetPrefs', JSON.stringify({ dept: st.dept, pending: st.pending, theme: st.theme })); } catch (e) { /* ignore */ } };

  function toast(msg, ms) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms || 2600);
  }

  /* ---------- build + render ---------- */
  async function rebuild(keepDay) {
    const m = await store.loadMonth(st.month);
    st.built = DS.buildMonth({ month: st.month, records: m.records, hospedia: m.hospedia, payments: m.payments, dept: st.dept, includePending: st.pending });
    st.raw = { r: Object.keys(m.records).length, h: Object.keys(m.hospedia).length, p: Object.keys(m.payments).length };
    if (!keepDay || !st.day) {
      // open on today (this month) or the last day that has rows
      const today = PJ.todayISO();
      const days = Object.keys(st.built.days).map(Number).filter((d) => st.built.days[d].length);
      st.day = today.slice(0, 7) === st.month && st.built.days[+today.slice(8, 10)].length ? +today.slice(8, 10) : (days.length ? days[days.length - 1] : 1);
    }
    render();
  }

  function render() {
    const b = st.built, t = b.totals;
    $('month').value = st.month;
    document.querySelectorAll('#dept button').forEach((x) => x.classList.toggle('on', x.dataset.v === st.dept));
    $('pendingTg').classList.toggle('on', st.pending);
    const matchPct = t.count ? Math.round(t.withHospedia / t.count * 100) : 0;
    $('kpis').innerHTML =
      kpi('TIDs · ' + PJ.ymLabel(st.month), fmt(t.count), (st.dept === 'ALL' ? 'All departments' : PJ.DEPT_LABEL[st.dept]) + (st.pending ? ' · with pending' : ' · claimed')) +
      kpi('Hospital claim amount', amt(t.amount), 'PANEL ' + amt(t.panel), 'ok') +
      kpi('Hospedia matched', matchPct + '%', fmt(t.withHospedia) + ' of ' + fmt(t.count), matchPct === 100 ? 'ok' : 'wn') +
      kpi('DIFF rows', fmt(t.diffCount), 'net ' + amt(t.diffAmt), t.diffCount ? 'wn' : 'ok') +
      kpi('Paid', t.paidCount ? amt(t.paid) : '–', t.paidCount ? fmt(t.paidCount) + ' TIDs (Payment Tracker)' : 'open the Payment Tracker', 'ok');
    $('dlMonthSub').textContent = DS.daysIn(st.month) + ' day sheets + Summary + Check · ' + DS.fileName(b);
    $('dlDaySub').textContent = 'Day ' + st.day + ' · ' + fmt((b.days[st.day] || []).length) + ' rows';
    $('dlMonth').disabled = !t.count; $('dlDay').disabled = !(b.days[st.day] || []).length;
    renderCal(); renderDay(); renderCats(); renderDocs(); renderChecks(); renderData();
  }
  function kpi(label, val, sub, cls) { return '<div class="kpi ' + (cls || '') + '"><span>' + esc(label) + '</span><b>' + esc(val) + '</b><small>' + esc(sub || '') + '</small></div>'; }

  function renderCal() {
    const b = st.built;
    const first = new Date(+st.month.slice(0, 4), +st.month.slice(5, 7) - 1, 1).getDay(); // 0 = Sunday
    let h = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => '<div class="wd">' + d + '</div>').join('');
    for (let i = 0; i < first; i++) h += '<div></div>';
    const chkDays = {};
    b.checks.forEach((c) => { chkDays[c.day] = chkDays[c.day] || { no: 0, other: 0 }; if (c.kind === 'No Hospedia bill') chkDays[c.day].no++; else chkDays[c.day].other++; });
    for (let d = 1; d <= DS.daysIn(st.month); d++) {
      const rows = b.days[d] || [];
      const bd = b.totals.byDay[d];
      const c = chkDays[d];
      const dot = !rows.length ? '' : c && c.no ? 'no' : c && c.other ? 'wn' : 'ok';
      h += '<button class="day' + (d === st.day ? ' on' : '') + (rows.length ? '' : ' empty') + '" data-day="' + d + '" title="' + (rows.length ? fmt(rows.length) + ' TIDs · ' + amt(bd.amount) : 'No TIDs') + '">' +
        '<span class="n">' + d + '</span><b>' + (rows.length ? fmt(rows.length) : '–') + '</b><small>' + (rows.length ? amt(bd.amount) : '') + '</small>' + (dot ? '<i class="d ' + dot + '"></i>' : '') + '</button>';
    }
    $('cal').innerHTML = h;
  }

  function rowState(r) {
    if (r.panel == null) return 'bad';
    if (Math.abs(r.diff) > 0.009 || r.lab < -0.009 || !r.claimed) return 'wn';
    return 'ok';
  }
  function catChips(r) {
    if (!r.cats) return '<span class="pill bad">No Hospedia bill</span>';
    return DS.CATS.filter((k) => r.cats[k]).map((k) => '<span class="chip">' + esc(k) + ' ' + PJ.fmtAmt(r.cats[k]) + '</span>').join('') +
      (r.lab ? '<span class="chip">LAB ' + PJ.fmtAmt(r.lab) + '</span>' : '');
  }
  function renderDay() {
    const all = st.built.days[st.day] || [];
    const q = st.q.toLowerCase();
    const rows = q ? all.filter((r) => (r.name + ' ' + r.tid + ' ' + r.doctor + ' ' + r.card).toLowerCase().indexOf(q) !== -1) : all;
    $('dayTitle').textContent = 'Day ' + st.day + ' · ' + PJ.isoToDmy(st.month + '-' + String(st.day).padStart(2, '0')) + ' · ' + fmt(all.length) + ' TIDs';
    if (!all.length) {
      $('dayBox').innerHTML = '<div class="empty">No TIDs on this day.' + (st.raw.r ? '' : '<br>' + esc(howTo())) + '</div>';
      return;
    }
    if (!rows.length) { $('dayBox').innerHTML = '<div class="empty">Nothing matches "' + esc(st.q) + '".</div>'; return; }
    const cols = ['Patient Name', 'Gender', 'Age', 'Transaction Id', 'Claim', 'Doctor', 'PANEL', 'DIFF'].concat(DS.CATS).concat(['LAB']);
    let t = '<div class="tbl"><table><thead><tr>' + cols.map((c, i) => '<th class="' + (i === 0 || i === 1 || i === 3 || i === 5 ? 'l' : '') + '">' + esc(c) + '</th>').join('') + '</tr></thead><tbody>';
    t += rows.map((r) => {
      const s = rowState(r);
      return '<tr class="' + (s === 'ok' ? '' : s) + '"><td class="l">' + esc(r.name) + '</td><td class="l">' + esc(r.gender) + '</td><td>' + esc(r.age) + '</td><td class="l mono">' + esc(r.tid) + '</td>' +
        '<td>' + PJ.fmtAmt(r.amount) + '</td><td class="l">' + esc(r.doctor) + '</td><td>' + (r.panel == null ? '–' : PJ.fmtAmt(r.panel)) + '</td>' +
        '<td>' + (r.diff == null ? '–' : r.diff ? '<span class="pill wn">' + PJ.fmtAmt(r.diff) + '</span>' : '0') + '</td>' +
        DS.CATS.map((k) => '<td>' + (r.cats && r.cats[k] ? PJ.fmtAmt(r.cats[k]) : '') + '</td>').join('') + '<td>' + PJ.fmtAmt(r.lab) + '</td></tr>';
    }).join('');
    t += '</tbody></table></div>';
    const cards = '<div class="cards">' + rows.map((r) => {
      const s = rowState(r);
      return '<div class="rc ' + s + '"><div class="a"><b>' + esc(r.name || '-') + '</b><span>' + amt(r.amount) + '</span></div>' +
        '<div class="m"><code>' + esc(r.tid) + '</code> · ' + esc(r.gender || '-') + ' · ' + esc(r.age === '' ? '-' : r.age) + ' yrs</div>' +
        '<div class="m">' + esc(r.doctor || 'no doctor') + (r.panel != null ? ' · PANEL ' + amt(r.panel) + (r.diff ? ' · <b class="wn">DIFF ' + PJ.fmtAmt(r.diff) + '</b>' : '') : '') + '</div>' +
        '<div class="chips">' + catChips(r) + '</div></div>';
    }).join('') + '</div>';
    $('dayBox').innerHTML = t + cards;
  }

  function renderCats() {
    const c = st.built.totals.cats;
    const max = Math.max(1, ...DS.ALL_CATS.map((k) => Math.abs(c[k])));
    $('catSub').textContent = PJ.ymLabel(st.month);
    $('cats').innerHTML = '<div class="bars">' + DS.ALL_CATS.map((k) => '<div class="br"><b>' + esc(k) + '</b><div class="track"><i style="width:' + Math.max(c[k] ? 2 : 0, Math.abs(c[k]) / max * 100) + '%"></i></div><span>' + amt(c[k]) + '</span></div>').join('') + '</div>';
  }
  function renderDocs() {
    const d = st.built.totals.byDoctor;
    const keys = Object.keys(d).sort((a, b) => d[b].count - d[a].count);
    if (!keys.length) { $('docs').innerHTML = '<div class="empty">No data yet.</div>'; return; }
    const max = d[keys[0]].count;
    $('docs').innerHTML = '<div class="bars">' + keys.slice(0, 14).map((k) => '<div class="br" style="grid-template-columns:150px 1fr auto"><b title="' + esc(k) + '" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(k) + '</b><div class="track"><i style="width:' + (d[k].count / max * 100) + '%"></i></div><span>' + fmt(d[k].count) + '</span></div>').join('') + '</div>';
  }
  function renderChecks() {
    const all = st.built.checks;
    const kinds = ['All'].concat(Array.from(new Set(all.map((c) => c.kind))));
    if (kinds.indexOf(st.chk) < 0) st.chk = 'All';
    $('chkCount').textContent = all.length;
    $('chkKind').innerHTML = kinds.map((k) => '<button data-v="' + esc(k) + '" class="' + (k === st.chk ? 'on' : '') + '">' + esc(k) + ' ' + (k === 'All' ? all.length : all.filter((c) => c.kind === k).length) + '</button>').join('');
    const list = all.filter((c) => st.chk === 'All' || c.kind === st.chk);
    if (!list.length) { $('checks').innerHTML = '<div class="empty">' + (st.built.rows.length ? '✓ Everything matches.' : 'No data yet.') + '</div>'; return; }
    const shown = st.chkAll ? list : list.slice(0, 40);
    const cls = (k) => k === 'No Hospedia bill' || k === 'Not in RGHS' ? 'bad' : 'wn';
    $('checks').innerHTML = shown.map((c) => '<div class="ck"><span class="k pill ' + cls(c.kind) + '">' + esc(c.kind) + '</span><span class="t">Day ' + esc(c.day) + ' · <code>' + esc(c.tid) + '</code> · ' + esc(c.name || '') + '</span><span class="s">' + esc(c.detail) + '</span></div>').join('') +
      (list.length > shown.length ? '<button class="more" id="moreChk">Show all ' + fmt(list.length) + '</button>' : '');
  }
  function howTo() {
    return IS_EXT
      ? 'Open the RGHS Transaction ID Tracker (also tmsBisTrack1) and search the month, open the Payment Tracker, and open the Hospedia report (Panel Wise Invoice Summary, RGHS NEW). The data is saved here by itself.'
      : 'Import files: the Transaction ID Tracker Excel from RGHS, the Hospedia report Excel (Panel Wise Invoice Summary), an older daily sheet, or a backup made in the Chrome extension.';
  }
  async function renderData() {
    const idx = await store.index();
    const months = Object.keys(idx).filter((k) => k !== 'misc').sort().reverse();
    $('dataInfo').innerHTML = months.length ? '<div class="di">' + months.map((m) => '<div><b>' + esc(PJ.ymLabel(m)) + '</b>RGHS ' + fmt(idx[m].r) + ' · Hospedia ' + fmt(idx[m].h) + ' · Paid ' + fmt(idx[m].p) + '</div>').join('') + '</div>' : '<div class="empty">Nothing saved yet.</div>';
    $('howto').textContent = howTo();
  }

  /* ---------- Excel ---------- */
  function download(wb, name) {
    X.writeFile(wb, name, { compression: true });
  }
  function dlMonth() {
    if (!st.built.rows.length) return;
    download(DS.monthWorkbook(X, st.built), DS.fileName(st.built));
    toast('Excel ready: ' + DS.fileName(st.built));
  }
  function dlDay() {
    if (!(st.built.days[st.day] || []).length) return;
    download(DS.monthWorkbook(X, st.built, { day: st.day }), DS.fileName(st.built, st.day));
    toast('Excel ready: day ' + st.day);
  }

  /* ---------- import ---------- */
  async function importFiles(files) {
    const done = { tracker: 0, hospedia: 0, payment: 0, daily: 0, backup: 0, unknown: [] };
    let lastMonth = '';
    for (const f of files) {
      try {
        if (/\.json$/i.test(f.name)) {
          const data = JSON.parse(await f.text());
          if (!data || data.app !== 'pj-rghs') throw new Error('not a PJ backup');
          for (const k of Object.keys(data.kv || {})) {
            const v = data.kv[k];
            if (/^r:/.test(k)) await save.records(Object.values(v));
            else if (/^h:/.test(k)) await save.hospedia(v);
            else if (/^p:/.test(k)) await save.payments(v);
          }
          done.backup++;
          continue;
        }
        const wb = X.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
        let used = false;
        for (const name of wb.SheetNames) {
          const rows = X.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true });
          const c = DS.classifySheet(rows);
          if (c.kind === 'daily') {
            await save.records(c.daily.records); await save.hospedia(c.daily.hospedia);
            if (c.daily.records[0]) lastMonth = c.daily.records[0].created.slice(0, 7);
            done.daily++; used = true;
          } else if (c.kind === 'hospedia') {
            const text = c.rows.map((r) => r.map((v) => v instanceof Date ? PJ.isoOf(v) : v));
            const sum = DS.hospediaSummary(ClaimEngine.parseRows(text));
            await save.hospedia(sum); done.hospedia += Object.keys(sum).length; used = true;
            const any = Object.values(sum)[0]; if (any) lastMonth = DS.bucketOf(any.tid, any.date);
          } else if (c.kind === 'tracker') {
            const recs = DS.recordsFromTracker(c.headers, c.rows);
            await save.records(recs); done.tracker += recs.length; used = true;
            if (recs[0]) lastMonth = recs[0].created.slice(0, 7);
          } else if (c.kind === 'payment') {
            const pays = DS.paymentsFromTable(c.headers, c.rows.map((r) => r.map((v) => v instanceof Date ? PJ.isoOf(v) : v)));
            await save.payments(pays); done.payment += Object.keys(pays).length; used = true;
          }
        }
        if (!used) done.unknown.push(f.name);
      } catch (e) { done.unknown.push(f.name + ' (' + e.message + ')'); }
    }
    const parts = [];
    if (done.daily) parts.push(done.daily + ' daily sheet(s)');
    if (done.tracker) parts.push(fmt(done.tracker) + ' RGHS TIDs');
    if (done.hospedia) parts.push(fmt(done.hospedia) + ' Hospedia TIDs');
    if (done.payment) parts.push(fmt(done.payment) + ' payments');
    if (done.backup) parts.push('backup');
    toast((parts.length ? '✓ Imported ' + parts.join(', ') : 'Nothing imported') + (done.unknown.length ? ' · not read: ' + done.unknown.join(', ') : ''), 6000);
    if (lastMonth && /^\d{4}-\d{2}$/.test(lastMonth) && lastMonth !== st.month && parts.length) st.month = lastMonth;
    // the background saves asynchronously in the extension; give it a moment
    setTimeout(() => rebuild(false), IS_EXT ? 400 : 0);
  }

  async function backup() {
    const keys = (await kv.keys()).filter((k) => /^[rhp]:/.test(k) || k === 'dataIndex');
    const out = { app: 'pj-rghs', version: PJ.VERSION, at: new Date().toISOString(), kv: {} };
    for (const k of keys) out.kv[k] = await kv.get(k);
    const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'pj-rghs-backup-' + PJ.todayISO() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Backup saved. Open it in the mobile app with "Import files".');
  }

  /* ---------- theme ---------- */
  function applyTheme() {
    if (st.theme) document.documentElement.setAttribute('data-theme', st.theme); else document.documentElement.removeAttribute('data-theme');
  }

  /* ---------- events ---------- */
  $('logo').innerHTML = PJ.logoSVG(38);
  $('mode').textContent = IS_EXT ? 'Chrome extension · data saved while you use RGHS and Hospedia' : 'Mobile app · import RGHS / Hospedia Excel · works offline';
  $('foot').textContent = 'PJ RGHS Suite v' + PJ.VERSION + ' · all data stays on this device';
  $('month').addEventListener('change', (e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) { st.month = e.target.value; rebuild(false); } });
  $('dept').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; st.dept = b.dataset.v; savePrefs(); rebuild(true); });
  $('pendingTg').addEventListener('click', () => { st.pending = !st.pending; savePrefs(); rebuild(true); });
  $('cal').addEventListener('click', (e) => { const b = e.target.closest('[data-day]'); if (!b) return; st.day = +b.dataset.day; render(); });
  $('q').addEventListener('input', (e) => { st.q = e.target.value.trim(); renderDay(); });
  $('chkKind').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; st.chk = b.dataset.v; st.chkAll = false; renderChecks(); });
  $('checks').addEventListener('click', (e) => { if (e.target.id === 'moreChk') { st.chkAll = true; renderChecks(); } });
  $('dlMonth').addEventListener('click', dlMonth);
  $('dlDay').addEventListener('click', dlDay);
  $('file').addEventListener('change', (e) => { const f = Array.from(e.target.files || []); e.target.value = ''; if (f.length) { toast('Reading ' + f.length + ' file(s)…'); importFiles(f); } });
  $('backup').addEventListener('click', backup);
  $('clearMonth').addEventListener('click', async () => {
    if (!confirm('Delete the saved RGHS, Hospedia and payment data of ' + PJ.ymLabel(st.month) + ' from this device?')) return;
    await save.clear(st.month); setTimeout(() => rebuild(false), 200); toast('Cleared ' + PJ.ymLabel(st.month));
  });
  $('themeBtn').addEventListener('click', () => {
    const dark = st.theme ? st.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    st.theme = dark ? 'light' : 'dark'; savePrefs(); applyTheme();
  });
  if (IS_EXT) {
    try {
      let t = null;
      chrome.storage.onChanged.addListener((ch, area) => {
        if (area !== 'local') return;
        if (Object.keys(ch).some((k) => k === 'r:' + st.month || k === 'h:' + st.month || k === 'p:' + st.month)) { clearTimeout(t); t = setTimeout(() => rebuild(true), 500); }
      });
    } catch (e) { /* ignore */ }
  } else if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  applyTheme();
  rebuild(false);
})();
