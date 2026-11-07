/* PJ RGHS Suite - shared helpers (content scripts, pop-up, report page, mobile app and background) */
(function (root) {
  'use strict';
  if (root.PJ) return;
  const PJ = {};

  PJ.VERSION = '4.0.0';
  PJ.PORTAL = 'https://rghs.rajasthan.gov.in';
  PJ.TRACKER_URL = 'https://rghs.rajasthan.gov.in/RGHS/tmsBisTrack';
  PJ.TRACKER1_URL = 'https://rghs.rajasthan.gov.in/RGHS/tmsBisTrack1';
  PJ.PAYMENT_URL = 'https://rghs.rajasthan.gov.in/RGHS/tmsPaymentTrack';
  PJ.OPD_URL = 'https://rghs.rajasthan.gov.in/RGHS/tmsOPDDetails';

  PJ.DEFAULTS = {
    panelView: 'compact',   // compact | columns | table | rings | status | bars
    miniView: 'pill',       // pill | pending | bars | badge | rotate | icon
    glass: 'liquid',        // clear | liquid | frosted
    theme: 'light',         // light | dark
    minimized: false,
    tab: 'ALL',
    alertTicker: true,      // upload ticker in the top bar
    alertPopup: true,       // glass pop-up when the portal opens
    alertDaily: true,       // Chrome notification once a day
    alertBadge: true,       // number on the toolbar icon
    tickerScope: 'month',   // month = this month only (default) | all = every saved TID
    dockOnScroll: true,     // small bar at the bottom of the screen when the panel is scrolled out of view
    dockPos: null,          // {rx, by} = distance from the right and bottom edges after the user drags the bar
    logo: 'midnight',       // midnight | aurora | care
    autoMonth: true,        // open the Transaction ID Tracker with this month's dates (1st to today)
    hideOtherEmptyBar: true, // hide the empty "No TIDs waiting for upload" bar shown by another PJ tool
    payCard: true,          // small summary card on the Payment Tracker
    sheetDept: 'OPD'        // department of the daily sheet
  };

  PJ.DEPTS = ['OPD', 'IPD', 'DC'];
  PJ.DEPT_LABEL = { ALL: 'All', OPD: 'OPD', IPD: 'IPD', DC: 'Day Care', OTHER: 'Other' };

  PJ.CATS = {
    amt0: 'Claim amount 0',
    bic: 'Beneficiary identification completed',
    paPending: 'Pre-auth pending',
    paApproved: 'Pre-auth approved',
    window: 'Window open',
    query: 'Query',
    rejected: 'Rejected',
    toUpload: 'To upload'
  };
  PJ.CAT_KEYS = Object.keys(PJ.CATS);
  PJ.DEPT_CATS = {
    OPD: ['amt0', 'bic', 'query', 'rejected', 'toUpload'],
    IPD: ['amt0', 'paPending', 'paApproved', 'query', 'rejected', 'toUpload'],
    DC: ['bic', 'paPending', 'paApproved', 'window', 'amt0', 'query', 'rejected', 'toUpload'],
    ALL: ['amt0', 'bic', 'paPending', 'paApproved', 'window', 'query', 'rejected', 'toUpload'],
    OTHER: ['amt0', 'query', 'rejected', 'toUpload']
  };

  PJ.RX_UPLOAD = /claim\s*to\s*be\s*submitted\s*by\s*hospital/i;

  PJ.RULES = [
    'Claimed = Hospital Claim Amount more than 0 (OPD, IPD and Day Care).',
    'Pending = amount is 0, or the status is "Claim to be submitted by hospital" (such a row is not claimed even if it has an amount).',
    'OPD checks: Claim amount 0, Beneficiary identification completed, Query, Rejected, To upload.',
    'IPD checks: Claim amount 0, Pre-auth pending, Pre-auth approved, Query, Rejected, To upload.',
    'Day Care checks: Beneficiary identification completed, Pre-auth pending, Pre-auth approved, Window open, Claim amount 0, Query, Rejected, To upload.',
    'Upload ticker: shows only when a TID is waiting for upload. By default it shows TIDs created this month. On the Transaction ID Tracker page it follows the dates you searched.',
    'Tracker dates: the Transaction ID Tracker opens with this month (1st to today). Dates you search yourself are kept.',
    'Daily sheet: every TID read on the Transaction ID Tracker (also tmsBisTrack1) and the Payment Tracker is saved in this Chrome, with the Hospedia bill of the same TID. The Daily sheet page makes the month Excel from it.'
  ];

  /* ---------- text and number helpers ---------- */
  PJ.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };
  PJ.clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  PJ.fmt = n => (Number(n) || 0).toLocaleString('en-IN');
  PJ.fmtAmt = n => (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

  PJ.normDept = function (s) {
    const t = String(s || '').toLowerCase();
    if (!t) return 'OTHER';
    if (/day\s*-?\s*care|daycare|\bdc\b/.test(t)) return 'DC';
    if (/\bopd\b|out\s*-?\s*patient/.test(t)) return 'OPD';
    if (/\bipd\b|in\s*-?\s*patient/.test(t)) return 'IPD';
    return 'OTHER';
  };

  PJ.parseAmount = function (s) {
    if (typeof s === 'number') return isFinite(s) ? s : 0;
    const t = String(s || '').replace(/[^0-9.\-]/g, '');
    const n = parseFloat(t);
    return isFinite(n) ? n : 0;
  };

  /* ---------- dates ---------- */
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const pad = n => String(n).padStart(2, '0');
  function iso(y, m, d) {
    if (!(y > 1900 && y < 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
    return y + '-' + pad(m) + '-' + pad(d);
  }
  PJ.parseDate = function (s) {
    if (!s) return '';
    s = String(s).trim();
    let m = s.match(/(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if (m) return iso(+m[1], +m[2], +m[3]);
    m = s.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
    if (m) return iso(+m[3], +m[2], +m[1]); // DD-MM-YYYY (India)
    m = s.match(/(\d{1,2})[-\s\/]([A-Za-z]{3,9})[-\s\/,]*(\d{4})/);
    if (m) {
      const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
      if (mi >= 0) return iso(+m[3], mi + 1, +m[1]);
    }
    return '';
  };
  PJ.isoOf = d => iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  PJ.dmyOf = d => pad(d.getDate()) + '-' + pad(d.getMonth() + 1) + '-' + d.getFullYear();
  PJ.isoToDmy = s => (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) ? s.slice(8, 10) + '-' + s.slice(5, 7) + '-' + s.slice(0, 4) : (s || '');
  PJ.todayISO = () => PJ.isoOf(new Date());
  PJ.monthKey = (d) => { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
  PJ.monthLabel = (d) => { d = d || new Date(); return MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear(); };
  PJ.monthStartISO = (d) => { d = d || new Date(); return iso(d.getFullYear(), d.getMonth() + 1, 1); };
  PJ.ymLabel = (ym) => { const m = +String(ym).slice(5, 7); return (MONTH_NAMES[m - 1] || '') + ' ' + String(ym).slice(0, 4); };
  PJ.timeText = function (ts) {
    if (!ts) return '';
    const d = new Date(ts);
    let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
    return PJ.dmyOf(d) + ', ' + h + ':' + pad(d.getMinutes()) + ' ' + ap;
  };

  /* Quick date ranges for the tracker */
  PJ.quickRanges = function (now) {
    now = now || new Date();
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    const D = (yy, mm, dd) => new Date(yy, mm, dd);
    const fyStart = m >= 3 ? D(y, 3, 1) : D(y - 1, 3, 1);
    return [
      { key: 'today', label: 'Today', from: D(y, m, d), to: D(y, m, d) },
      { key: 'yesterday', label: 'Yesterday', from: D(y, m, d - 1), to: D(y, m, d - 1) },
      { key: 'last7', label: 'Last 7 days', from: D(y, m, d - 6), to: D(y, m, d) },
      { key: 'thisMonth', label: 'This month', from: D(y, m, 1), to: D(y, m, d) },
      { key: 'lastMonth', label: 'Last month', from: D(y, m - 1, 1), to: D(y, m, 0) },
      { key: 'last3', label: 'Last 3 months', from: D(y, m - 2, 1), to: D(y, m, d) },
      { key: 'fy', label: 'This financial year', from: fyStart, to: D(y, m, d) }
    ];
  };

  /* ---------- rules ---------- */
  PJ.flags = function (status, amount) {
    const s = String(status || '');
    const up = PJ.RX_UPLOAD.test(s);
    const amt = Number(amount) || 0;
    return {
      toUpload: up,
      amt0: !(amt > 0),
      bic: /beneficiary\s*identification\s*(is\s*)?complet/i.test(s),
      paApproved: /pre[\s\-_]*auth\w*.*approv/i.test(s),
      paPending: /pre[\s\-_]*auth/i.test(s) && !/approv|reject|quer|cancel/i.test(s),
      window: /window/i.test(s) && /open/i.test(s),
      query: /quer/i.test(s),
      rejected: /reject/i.test(s),
      claimed: amt > 0 && !up
    };
  };

  function emptyDept() {
    const c = {}; PJ.CAT_KEYS.forEach(k => { c[k] = 0; });
    return { total: 0, claimed: 0, pending: 0, claimedAmt: 0, c, statuses: {} };
  }
  /* rows: [{dept, status, amount, f?}] */
  PJ.computeStats = function (rows) {
    const S = { ALL: emptyDept(), OPD: emptyDept(), IPD: emptyDept(), DC: emptyDept(), OTHER: emptyDept() };
    (rows || []).forEach(r => {
      const f = r.f || PJ.flags(r.status, r.amount);
      const st = PJ.clean(r.status) || '(blank)';
      [S.ALL, S[r.dept] || S.OTHER].forEach(x => {
        x.total++;
        if (f.claimed) { x.claimed++; x.claimedAmt += Number(r.amount) || 0; } else x.pending++;
        PJ.CAT_KEYS.forEach(k => { if (f[k]) x.c[k]++; });
        x.statuses[st] = (x.statuses[st] || 0) + 1;
      });
    });
    return S;
  };

  PJ.pct = (a, b) => b > 0 ? Math.round((a / b) * 100) : 0;

  /* ---------- snapshot ---------- */
  PJ.snapshotRows = function (snap) {
    if (!snap || !Array.isArray(snap.rows)) return [];
    const st = snap.statuses || [];
    return snap.rows.map(r => ({ tid: r[0], dept: r[1], status: st[r[2]] || '', amount: r[3], date: r[4] }));
  };

  /* Stats for the current month taken from the last saved tracker check */
  PJ.monthStats = function (snap, now) {
    now = now || new Date();
    const mk = PJ.monthKey(now);
    const rows = PJ.snapshotRows(snap).filter(r => (r.date || '').slice(0, 7) === mk);
    const range = (snap && snap.range) || {};
    const covered = !!(snap && range.from && range.to && range.from <= PJ.monthStartISO(now) && range.to >= PJ.isoOf(new Date(snap.at || Date.now())));
    return { stats: PJ.computeStats(rows), count: rows.length, covered, range, at: snap && snap.at };
  };

  /* ---------- upload list ---------- */
  PJ.uploadDate = function (u) {
    if (!u) return '';
    if (u.date) return u.date;
    return u.addedAt ? PJ.isoOf(new Date(u.addedAt)) : '';
  };
  /* opt: {scope: 'month' | 'all' | 'range', from, to, now} */
  PJ.scopeUploads = function (uploads, opt) {
    opt = opt || {};
    const list = Object.values(uploads || {}).filter(u => u && u.tid);
    let out = list;
    if (opt.scope === 'range' && opt.from && opt.to) {
      out = list.filter(u => { const d = PJ.uploadDate(u); return d && d >= opt.from && d <= opt.to; });
    } else if (opt.scope !== 'all') {
      const mk = PJ.monthKey(opt.now || new Date());
      out = list.filter(u => PJ.uploadDate(u).slice(0, 7) === mk);
    }
    return out.sort((a, b) => (PJ.uploadDate(b)).localeCompare(PJ.uploadDate(a)) || String(a.tid).localeCompare(String(b.tid)));
  };
  PJ.scopeLabel = function (opt) {
    opt = opt || {};
    if (opt.scope === 'range' && opt.from && opt.to) return 'Tracker dates: ' + PJ.isoToDmy(opt.from) + ' to ' + PJ.isoToDmy(opt.to);
    if (opt.scope === 'all') return 'All saved TIDs';
    return 'This month (' + PJ.monthLabel(opt.now) + ')';
  };
  PJ.uploadLine = function (u) {
    return 'TID ' + u.tid + ' · ' + (u.name || '-') + ' · ' + (PJ.DEPT_LABEL[u.dept] || u.dept || '-') + ' · ' +
      (PJ.isoToDmy(u.date) || u.dateRaw || '-') + ' · ₹' + PJ.fmtAmt(u.amount);
  };
  PJ.uploadsText = function (list, title) {
    const L = [(title || 'TIDs to upload') + ' (' + list.length + '):'];
    list.forEach((u, i) => L.push((i + 1) + '. ' + PJ.uploadLine(u)));
    return L.join('\n');
  };

  /* Something worth showing in a pop-up or notification? */
  PJ.hasNotice = function (stats, uploadCount) {
    const a = stats && stats.ALL;
    return (uploadCount || 0) > 0 || !!(a && (a.pending > 0 || a.c.query > 0 || a.c.rejected > 0));
  };

  /* ---------- chrome.* wrappers (safe after the extension reloads) ---------- */
  PJ.alive = function () {
    try { return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
  };
  PJ.get = function (keys) {
    return new Promise(res => {
      try {
        if (!PJ.alive()) return res({});
        chrome.storage.local.get(keys, r => {
          try { if (chrome.runtime.lastError) return res({}); } catch (e) { /* ignore */ }
          res(r || {});
        });
      } catch (e) { res({}); }
    });
  };
  PJ.set = function (obj) {
    return new Promise(res => {
      try {
        if (!PJ.alive()) return res(false);
        chrome.storage.local.set(obj, () => {
          try { void chrome.runtime.lastError; } catch (e) { /* ignore */ }
          res(true);
        });
      } catch (e) { res(false); }
    });
  };
  PJ.send = function (msg) {
    return new Promise(res => {
      try {
        if (!PJ.alive()) return res(null);
        chrome.runtime.sendMessage(msg, r => {
          try { if (chrome.runtime.lastError) return res(null); } catch (e) { /* ignore */ }
          res(r);
        });
      } catch (e) { res(null); }
    });
  };
  PJ.getSettings = async function () {
    const r = await PJ.get('settings');
    return Object.assign({}, PJ.DEFAULTS, (r && r.settings) || {});
  };
  PJ.saveSettings = async function (patch) {
    const s = Object.assign(await PJ.getSettings(), patch || {});
    await PJ.set({ settings: s });
    return s;
  };

  /* ---------- logo ---------- */
  /* "PJ" monogram in a squircle (letters: Sora ExtraBold, turned into paths).
     Styles: midnight (default) = dark jewel with an aurora glow, gradient rim and glowing white letters
             aurora = bright cyan -> blue -> violet -> pink glass
             care   = teal glass with a red medical cross badge */
  const SQ = 'M124 64L123.9 86.6L123.6 93.8L123.2 98.9L122.5 103.1L121.7 106.5L120.6 109.5L119.4 112L117.9 114.3L116.2 116.2L114.3 117.9L112 119.4L109.5 120.6L106.5 121.7L103.1 122.5L98.9 123.2L93.8 123.6L86.6 123.9L64 124L41.4 123.9L34.2 123.6L29.1 123.2L24.9 122.5L21.5 121.7L18.5 120.6L16 119.4L13.7 117.9L11.8 116.2L10.1 114.3L8.6 112L7.4 109.5L6.3 106.5L5.5 103.1L4.8 98.9L4.4 93.8L4.1 86.6L4 64L4.1 41.4L4.4 34.2L4.8 29.1L5.5 24.9L6.3 21.5L7.4 18.5L8.6 16L10.1 13.7L11.8 11.8L13.7 10.1L16 8.6L18.5 7.4L21.5 6.3L24.9 5.5L29.1 4.8L34.2 4.4L41.4 4.1L64 4L86.6 4.1L93.8 4.4L98.9 4.8L103.1 5.5L106.5 6.3L109.5 7.4L112 8.6L114.3 10.1L116.2 11.8L117.9 13.7L119.4 16L120.6 18.5L121.7 21.5L122.5 24.9L123.2 29.1L123.6 34.2L123.9 41.4Z';
  const SQI = 'M122.4 64L122.3 86L122 93L121.6 98L121 102L120.1 105.4L119.1 108.3L117.9 110.8L116.5 112.9L114.8 114.8L112.9 116.5L110.8 117.9L108.3 119.1L105.4 120.1L102 121L98 121.6L93 122L86 122.3L64 122.4L42 122.3L35 122L30 121.6L26 121L22.6 120.1L19.7 119.1L17.2 117.9L15.1 116.5L13.2 114.8L11.5 112.9L10.1 110.8L8.9 108.3L7.9 105.4L7 102L6.4 98L6 93L5.7 86L5.6 64L5.7 42L6 35L6.4 30L7 26L7.9 22.6L8.9 19.7L10.1 17.2L11.5 15.1L13.2 13.2L15.1 11.5L17.2 10.1L19.7 8.9L22.6 7.9L26 7L30 6.4L35 6L42 5.7L64 5.6L86 5.7L93 6L98 6.4L102 7L105.4 7.9L108.3 8.9L110.8 10.1L112.9 11.5L114.8 13.2L116.5 15.1L117.9 17.2L119.1 19.7L120.1 22.6L121 26L121.6 30L122 35L122.3 42Z';
  const PJ_LG = 'M36.2 91.5L23.5 91.5L23.5 41.1L42.7 41.1Q49.1 41.1 53.8 43.3Q58.5 45.4 61.1 49.5Q63.6 53.5 63.6 59.1L63.6 59.1L63.6 60.2Q63.6 65.8 61.1 69.8Q58.5 73.8 53.8 76.0Q49.1 78.2 42.7 78.2L42.7 78.2L36.2 78.2L36.2 91.5ZM43.0 52.1L36.2 52.1L36.2 67.3L43.0 67.3Q45.4 67.3 47.1 66.3Q48.8 65.4 49.8 63.7Q50.7 62.0 50.7 59.7L50.7 59.7Q50.7 57.3 49.8 55.6Q48.8 53.8 47.1 53.0Q45.4 52.1 43.0 52.1L43.0 52.1ZM85.7 92.9L85.7 92.9Q79.8 92.9 75.5 90.7Q71.3 88.5 69.1 84.4Q66.9 80.2 66.9 74.3L66.9 74.3L66.9 71.6L79.5 71.6L79.5 74.7Q79.5 77.5 81.1 79.2Q82.7 81.0 85.6 81.0Q88.6 81.0 90.2 79.2Q91.8 77.5 91.8 74.7L91.8 74.7L91.8 52.6L72.5 52.6L72.5 41.5L104.5 41.5L104.5 74.3Q104.5 80.2 102.3 84.4Q100.1 88.5 95.9 90.7Q91.7 92.9 85.7 92.9Z';
  const PJ_SM = 'M31.0 93.4L15.8 93.4L15.8 32.9L38.8 32.9Q46.6 32.9 52.2 35.5Q57.8 38.1 60.9 43.0Q63.9 47.8 63.9 54.5L63.9 54.5L63.9 55.9Q63.9 62.5 60.9 67.4Q57.8 72.2 52.2 74.8Q46.6 77.5 38.8 77.5L38.8 77.5L31.0 77.5L31.0 93.4ZM39.3 46.1L31.0 46.1L31.0 64.3L39.3 64.3Q42.1 64.3 44.1 63.2Q46.2 62.1 47.3 60.1Q48.5 58.0 48.5 55.2L48.5 55.2Q48.5 52.3 47.3 50.3Q46.2 48.2 44.1 47.2Q42.1 46.1 39.3 46.1L39.3 46.1ZM89.6 95.1L89.6 95.1Q82.5 95.1 77.4 92.4Q72.4 89.8 69.7 84.8Q67.0 79.9 67.0 72.8L67.0 72.8L67.0 69.5L82.2 69.5L82.2 73.3Q82.2 76.6 84.1 78.7Q86.0 80.8 89.6 80.8Q93.1 80.8 95.0 78.7Q97.0 76.6 97.0 73.3L97.0 73.3L97.0 46.7L73.8 46.7L73.8 33.4L112.2 33.4L112.2 72.8Q112.2 79.9 109.6 84.8Q106.9 89.8 101.9 92.4Q96.9 95.1 89.6 95.1Z';
  const PLUS = 'M100.5 19.5a2.5 2.5 0 0 1 5 0V22.5H108.5a2.5 2.5 0 0 1 0 5H105.5V30.5a2.5 2.5 0 0 1 -5 0V27.5H97.5a2.5 2.5 0 0 1 0 -5H100.5Z';
  PJ.LOGO_STYLES = [['midnight', 'Midnight'], ['aurora', 'Aurora'], ['care', 'Care']];
  PJ.logoStyle = 'midnight';
  PJ.setLogoStyle = function (s) { if (PJ.LOGO_STYLES.some(x => x[0] === s)) PJ.logoStyle = s; };
  let logoN = 0;
  PJ.logoSVG = function (size, opt) {
    opt = opt || {};
    const style = opt.style || PJ.logoStyle || 'midnight';
    const id = 'pjl' + (++logoN) + Math.random().toString(36).slice(2, 6);
    const small = size <= 20, mid = size <= 34;
    const u = k => 'url(#' + id + k + ')';
    const L = small ? PJ_SM : PJ_LG;
    const lin = (k, stops, x2, y2) => '<linearGradient id="' + id + k + '" x1="0" y1="0" x2="' + (x2 == null ? 1 : x2) + '" y2="' + (y2 == null ? 1 : y2) + '">' +
      stops.map(s => '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' + (s[2] != null ? ' stop-opacity="' + s[2] + '"' : '') + '/>').join('') + '</linearGradient>';
    const rad = (k, cx, cy, r, c, o) => '<radialGradient id="' + id + k + '" cx="' + cx + '" cy="' + cy + '" r="' + r + '"><stop offset="0" stop-color="' + c + '" stop-opacity="' + o + '"/><stop offset="1" stop-color="' + c + '" stop-opacity="0"/></radialGradient>';
    let defs = '<clipPath id="' + id + 'cp"><path d="' + SQ + '"/></clipPath>' + lin('hl', [[0, '#fff', .42], [1, '#fff', 0]], 0, 1);
    let bg, glows, rim, rimW, letters, extra = '';
    if (style === 'aurora') {
      bg = [[0, '#06b6d4'], [.35, '#2563eb'], [.68, '#7c3aed'], [1, '#db2777']];
      glows = [rad('g0', .2, .05, .7, '#a5f3fc', .85), rad('g1', .5, 1.1, .8, '#1e1b4b', .5)];
      rim = [[0, '#fff', .9], [.5, '#fff', .15], [1, '#fff', .4]]; rimW = 2;
      defs += lin('tx', [[0, '#fff'], [1, '#e0e7ff']], 0, 1) +
        '<filter id="' + id + 'sh" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="' + (small ? 1.2 : 3.5) + '" stdDeviation="' + (small ? 1 : 3) + '" flood-color="#1e1b4b" flood-opacity=".55"/></filter>';
      letters = '<path d="' + L + '" fill="' + u('tx') + '" filter="' + u('sh') + '"/>';
      if (!mid && !opt.plain) extra = '<path d="' + PLUS + '" fill="#fff" style="filter:drop-shadow(0 0 4px rgba(255,255,255,.95))"/>';
    } else if (style === 'care') {
      bg = [[0, '#14b8a6'], [.45, '#0891b2'], [1, '#4338ca']];
      glows = [rad('g0', .15, .05, .8, '#99f6e4', .8)];
      rim = [[0, '#fff', .85], [.5, '#fff', .12], [1, '#fff', .35]]; rimW = 2;
      defs += lin('cr', [[0, '#fb7185'], [1, '#e11d48']], 0, 1) +
        '<filter id="' + id + 'sh" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="' + (small ? 1.2 : 3.5) + '" stdDeviation="' + (small ? 1 : 3) + '" flood-color="#082f49" flood-opacity=".5"/></filter>';
      letters = '<path d="' + L + '" fill="#fff" filter="' + u('sh') + '"/>';
      if (!mid && !opt.plain) extra = '<circle cx="103" cy="25" r="13" fill="#fff" style="filter:drop-shadow(0 2px 3px rgba(8,47,73,.35))"/><path d="' + PLUS + '" fill="' + u('cr') + '"/>';
    } else {
      bg = [[0, '#1e1b4b'], [.55, '#1b1446'], [1, '#0b0820']];
      glows = [rad('g0', .08, .02, .78, '#06b6d4', .62), rad('g1', .98, 1, .75, '#db2777', .6), rad('g2', .95, .05, .5, '#7c3aed', .5)];
      rim = [[0, '#67e8f9'], [.5, '#818cf8'], [1, '#f472b6']]; rimW = 3;
      defs += lin('tx', [[0, '#ffffff'], [1, '#ddd6fe']]) + lin('gw', [[0, '#22d3ee'], [.5, '#818cf8'], [1, '#f472b6']]) +
        '<filter id="' + id + 'gl" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="' + (small ? 1.4 : 5.5) + '"/></filter>';
      letters = '<path d="' + L + '" fill="' + u('gw') + '" opacity="' + (small ? .6 : .95) + '" filter="' + u('gl') + '"/><path d="' + L + '" fill="' + u('tx') + '"/>';
      if (!mid && !opt.plain) extra = '<path d="' + PLUS + '" fill="#fff" style="filter:drop-shadow(0 0 4px rgba(165,243,252,.95))"/>';
    }
    defs += lin('bg', bg) + lin('rm', rim) + glows.join('');
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 128 128" aria-hidden="true" style="display:block;overflow:visible">' +
      '<defs>' + defs + '</defs><path d="' + SQ + '" fill="' + u('bg') + '"/>' +
      '<g clip-path="' + u('cp') + '">' + glows.map((g, i) => '<rect width="128" height="128" fill="' + u('g' + i) + '"/>').join('') +
      '<ellipse cx="64" cy="-10" rx="92" ry="50" fill="' + u('hl') + '"/></g>' +
      '<path d="' + SQI + '" fill="none" stroke="' + u('rm') + '" stroke-width="' + (small ? rimW * 1.8 : rimW) + '"/>' +
      letters + extra + '</svg>';
  };

  root.PJ = PJ;
})(typeof self !== 'undefined' ? self : this);
