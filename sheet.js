/* PJ RGHS Suite - daily sheet logic (pure: no browser APIs, so it runs in the extension, the mobile app and Node tests).
 *
 * Builds the month workbook the hospital makes by hand every day:
 *   one sheet per day ("1" .. "31") with the columns
 *   CLAIMSUBMISSIONYEAR | CLAIMSUBMISSIONMONTH | Patient Name | Gender | Age | RGHS Card No. | Transaction Id Created On |
 *   Transaction Id | Hospital Claim Amount | TREATING DOCTOR NAME | PANEL | DIFF | CONSULT | X RAY | CT SCAN | USG | CBCT |
 *   OPG | OCT | OTHERS | LAB
 *   A-J come from the RGHS portal (Transaction ID Tracker), K-T from the Hospedia report (Panel Wise Invoice Summary).
 *   DIFF = I - K and LAB = I - (M..T) are Excel formulas, exactly as in the hand-made sheet.
 */
(function (root) {
  'use strict';

  const HEADERS = ['CLAIMSUBMISSIONYEAR', 'CLAIMSUBMISSIONMONTH', 'Patient Name', 'Gender', 'Age', 'RGHS Card No.',
    'Transaction Id Created On', 'Transaction Id', 'Hospital Claim Amount', 'TREATING DOCTOR NAME', 'PANEL', 'DIFF',
    'CONSULT', 'X RAY', 'CT SCAN', 'USG', 'CBCT', 'OPG', 'OCT', 'OTHERS', 'LAB'];
  // Hospedia breakdown columns (M..T). LAB (U) is the rest of the claim amount.
  const CATS = ['CONSULT', 'X RAY', 'CT SCAN', 'USG', 'CBCT', 'OPG', 'OCT', 'OTHERS'];
  const ALL_CATS = CATS.concat(['LAB']);
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const num = (v) => {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : 0;
  };
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const pad = (n) => String(n).padStart(2, '0');
  const hk = (h) => clean(h).toLowerCase().replace(/[^a-z0-9]/g, '');

  /* ---------- dates ---------- */
  const MON3 = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  function isoOk(y, m, d) { return y > 1900 && y < 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? y + '-' + pad(m) + '-' + pad(d) : ''; }
  /** Any portal / Excel date -> YYYY-MM-DD. dayFirst decides 01/02/2026 (true = 1 Feb, India). Excel serial numbers work too. */
  function toISO(v, dayFirst) {
    if (v == null || v === '') return '';
    if (v instanceof Date) return isNaN(v) ? '' : isoOk(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === 'number') { // Excel serial date
      if (v < 20000 || v > 80000) return '';
      const d = new Date(Math.round((v - 25569) * 86400000));
      return isoOk(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    const s = clean(v);
    let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if (m) return isoOk(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
    if (m) {
      const a = +m[1], b = +m[2];
      if (a > 12) dayFirst = true; else if (b > 12) dayFirst = false;
      return dayFirst === false ? isoOk(+m[3], a, b) : isoOk(+m[3], b, a);
    }
    m = s.match(/^(\d{1,2})[-\s\/]([A-Za-z]{3,9})[-\s\/,]*(\d{4})/);
    if (m) { const mi = MON3.indexOf(m[2].slice(0, 3).toLowerCase()); if (mi >= 0) return isoOk(+m[3], mi + 1, +m[1]); }
    m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/);
    if (m) { const mi = MON3.indexOf(m[1].slice(0, 3).toLowerCase()); if (mi >= 0) return isoOk(+m[3], mi + 1, +m[2]); }
    return '';
  }
  /** RGHS TIDs start with the date they were made: 2026100111464595 -> 2026-10-01 */
  function tidDate(tid) {
    const m = /^(20\d\d)(\d\d)(\d\d)/.exec(String(tid || ''));
    return m ? isoOk(+m[1], +m[2], +m[3]) : '';
  }
  const monthOf = (iso) => (iso || '').slice(0, 7);
  /** Storage bucket for a TID (YYYY-MM from the TID itself, so every source lands in the same bucket) */
  function bucketOf(tid, fallbackIso) { return monthOf(tidDate(tid) || fallbackIso || '') || 'misc'; }
  function monthName(ym) { const m = +String(ym).slice(5, 7); return MONTHS[m - 1] || ''; }
  function daysIn(ym) { const y = +ym.slice(0, 4), m = +ym.slice(5, 7); return new Date(y, m, 0).getDate(); }

  /* ---------- RGHS tracker columns ---------- */
  // header text (lower-case, letters+digits only) -> field
  const RGHS_COLS = [
    ['tid', (h) => h === 'transactionid' || h === 'tid' || h === 'transactionidno' || h === 'tidno' || (h.indexOf('transactionid') !== -1 && !/status|created|date|type/.test(h))],
    ['status', (h) => h === 'transactionidstatus' || h === 'tidstatus' || h === 'laststatus' || (h.indexOf('status') !== -1 && !/created|date|payment|claimsubmission/.test(h))],
    ['dept', (h) => h.indexOf('department') !== -1 || h === 'dept' || h === 'tidtype' || h === 'type'],
    ['amount', (h) => h.indexOf('hospitalclaimamount') !== -1 || h === 'claimamount' || (h.indexOf('claim') !== -1 && h.indexOf('amount') !== -1 && !/approv|paid|sanction|deduct/.test(h))],
    ['name', (h) => h.indexOf('patientname') !== -1 || h.indexOf('beneficiaryname') !== -1 || h === 'name'],
    ['gender', (h) => h === 'gender' || h === 'sex' || h.indexOf('gender') !== -1],
    ['age', (h) => h === 'age' || h.indexOf('ageyear') !== -1 || h === 'ageinyears'],
    ['card', (h) => h.indexOf('cardno') !== -1 || h.indexOf('rghscard') !== -1 || h.indexOf('janaadhaar') !== -1 || h === 'cardnumber'],
    ['created', (h) => h.indexOf('transactionidcreatedon') !== -1 || h.indexOf('tidcreatedon') !== -1 || h === 'createdon' || h === 'createddate' || h === 'tiddate'],
    ['claimYear', (h) => h === 'claimsubmissionyear'],
    ['claimMonth', (h) => h === 'claimsubmissionmonth'],
    ['doctor', (h) => h.indexOf('treatingdoctor') !== -1 || h === 'doctorname' || h === 'doctor']
  ];
  function detectRghsCols(headers) {
    const H = (headers || []).map(hk);
    const out = {};
    const used = new Set();
    for (const [k, test] of RGHS_COLS) {
      let i = -1;
      for (let j = 0; j < H.length; j++) { if (H[j] && !used.has(j) && test(H[j])) { i = j; break; } }
      out[k] = i;
      if (i >= 0) used.add(i);
    }
    if (out.created < 0) out.created = H.findIndex((h, j) => !used.has(j) && h.indexOf('created') !== -1);
    return out;
  }
  function normDept(s) {
    const t = String(s || '').toLowerCase();
    if (!t) return '';
    if (/day\s*-?\s*care|daycare|\bdc\b/.test(t)) return 'DC';
    if (/\bopd\b|out\s*-?\s*patient/.test(t)) return 'OPD';
    if (/\bipd\b|in\s*-?\s*patient/.test(t)) return 'IPD';
    return 'OTHER';
  }
  function normGender(s) {
    const t = clean(s).toLowerCase();
    if (!t) return '';
    if (/^f|female|woman/.test(t)) return 'Female';
    if (/^m|male|man/.test(t)) return 'Male';
    if (/^t|trans|other/.test(t)) return 'Transgender';
    return clean(s);
  }
  const RX_UPLOAD = /claim\s*to\s*be\s*submitted\s*by\s*hospital/i;
  const looksTid = (tid) => /^[A-Za-z0-9][A-Za-z0-9\-\/_]{5,31}$/.test(tid) && /\d{5}/.test(tid);

  /** 2D rows from the RGHS tracker (screen or its Excel export) -> records */
  function recordsFromTracker(headers, rows, opt) {
    opt = opt || {};
    const c = detectRghsCols(headers);
    if (c.tid < 0) return [];
    const out = [];
    const dayFirst = opt.dayFirst !== false;
    for (const cells of rows || []) {
      const g = (k) => (c[k] >= 0 ? cells[c[k]] : '');
      const tid = clean(g('tid')).replace(/\.0+$/, '');
      if (!looksTid(tid)) continue;
      const createdRaw = g('created');
      const created = toISO(createdRaw, dayFirst) || '';
      out.push({
        tid,
        name: clean(g('name')),
        gender: normGender(g('gender')),
        age: clean(g('age')) === '' ? '' : num(g('age')),
        card: clean(g('card')).replace(/\.0+$/, ''),
        created: created || tidDate(tid),
        amount: num(g('amount')),
        status: clean(g('status')),
        dept: normDept(g('dept')) || (opt.dept || ''),
        claimYear: clean(g('claimYear')),
        claimMonth: clean(g('claimMonth')),
        doctor: clean(g('doctor'))
      });
    }
    return out;
  }

  /* ---------- Hospedia ---------- */
  /** Which daily-sheet column an Hospedia bill line goes to */
  function categorize(item, type) {
    const s = ' ' + clean(item).toLowerCase() + ' ';
    const t = clean(type).toUpperCase();
    if (/APPOINTMENT|CONSULT/.test(t) || /consult|first visit|follow ?up|revisit/.test(s)) return 'CONSULT';
    if (/\bcbct\b|cone\s*beam|ct\s*(scan)?\s*dental|dental\s*ct/.test(s)) return 'CBCT';
    if (/\bopg\b|orthopantomo|panoramic/.test(s)) return 'OPG';
    if (/\boct\b|optical\s*coherence/.test(s)) return 'OCT';
    if (/\bct\b|\bcect\b|\bncct\b|\bhrct\b|computed\s*tomo|ct\s*scan|ct\s*angio/.test(s)) return 'CT SCAN';
    if (/\busg\b|ultra\s*sound|sonograph|sonomammo|doppler|\bnt\s*scan|anomaly\s*scan|follicular/.test(s)) return 'USG';
    if (/x[\s\-.]*ray|\bxray\b|radiograph|skiagram|\bxr\b|chest\s*pa\b|mammogra/.test(s)) return 'X RAY';
    if (/LAB|PATH/.test(t)) return 'LAB';
    if (/RADIO/.test(t)) return 'OTHERS';
    // a lab test usually has one of these words; everything else (ECG, physio, procedures, dressing ...) is OTHERS
    if (/\b(blood|serum|urine|stool|culture|cbc|haemogram|hemogram|sugar|glucose|lipid|lft|kft|rft|thyroid|tsh|t3|t4|vitamin|hba1c|esr|crp|widal|dengue|malaria|typhi|hiv|hbsag|hcv|vdrl|uric|creatinine|urea|bilirubin|sgot|sgpt|calcium|electrolyte|sodium|potassium|ferritin|iron|profile|test|panel|count|smear|antigen|antibody|igg|igm|aso|psa|hcg|amylase|lipase|albumin|protein|inr|aptt|biopsy|histo|cyto|fnac|pap)\b/.test(s)) return 'LAB';
    return 'OTHERS';
  }
  function doctorFromConsult(item) {
    return clean(String(item || '').replace(/\(.*?\)/g, ' ')).replace(/\s*-\s*[0-9]+[A-Z]?\s*$/i, '').trim();
  }
  /** "DR MAHAVEER MALI" -> "DR.MAHAVEER MALI" (the style of the hand-made sheet) */
  function sheetDoctor(name) {
    const n = clean(name).toUpperCase();
    if (!n) return '';
    return 'DR.' + n.replace(/^DR\.?\s*/, '');
  }
  /** items: ClaimEngine.parseRows() output. Returns {tid: {tid, mr, patient, date, doctor, total, cats, lines}} */
  function hospediaSummary(items) {
    items = items || [];
    const dayFirst = items.some((it) => { const m = /^(\d{1,2})\/(\d{1,2})\//.exec(it.date || ''); return m && +m[1] > 12; });
    const appt = {};
    for (const it of items) {
      if (/APPOINTMENT|CONSULT/.test(String(it.type).toUpperCase())) appt[it.mr + '|' + it.date] = doctorFromConsult(it.item);
    }
    const out = {};
    for (const it of items) {
      const tid = clean(it.tid).replace(/\.0+$/, '');
      if (!tid) continue;
      const amt = num(it.amount);
      let h = out[tid];
      if (!h) {
        // Hospedia screen dates are M/D/YYYY unless a day > 12 shows they are D/M/YYYY
        h = out[tid] = { tid, mr: clean(it.mr), patient: clean(it.patient).replace(/\s+\d{12,}\s*$/, ''), date: toISO(it.date, dayFirst), doctor: '', total: 0, cats: {}, lines: [] };
        ALL_CATS.forEach((k) => { h.cats[k] = 0; });
      }
      if (/registration/i.test(it.item) && !amt) continue;
      const cat = categorize(it.item, it.type);
      h.cats[cat] = r2(h.cats[cat] + amt);
      h.total = r2(h.total + amt);
      h.lines.push({ item: clean(it.item), type: clean(it.type), amount: amt, cat });
      if (cat === 'CONSULT' && !h.doctor) h.doctor = doctorFromConsult(it.item);
    }
    for (const tid of Object.keys(out)) {
      const h = out[tid];
      if (!h.doctor) {
        const first = items.find((it) => clean(it.tid) === tid);
        if (first && appt[first.mr + '|' + first.date]) { h.doctor = appt[first.mr + '|' + first.date]; h.doctorFrom = 'same-day consultation'; }
      }
    }
    return out;
  }

  /* ---------- reading a hand-made daily workbook (like RGHS_OCT_26_OPD.xlsx) ---------- */
  /** rows: 2D array of one sheet. Returns {records, hospedia} or null when it is not a daily sheet. */
  function readDailySheet(rows) {
    if (!rows || !rows.length) return null;
    let hi = -1;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const H = (rows[i] || []).map(hk);
      if (H.includes('transactionid') && H.includes('panel') && H.includes('consult')) { hi = i; break; }
    }
    if (hi < 0) return null;
    const H = rows[hi].map(hk);
    const col = (name) => H.indexOf(hk(name));
    const at = (r, name) => { const i = col(name); return i >= 0 ? r[i] : ''; };
    const records = [], hospedia = {};
    for (const r of rows.slice(hi + 1)) {
      if (!r) continue;
      const tid = clean(at(r, 'Transaction Id')).replace(/\.0+$/, '');
      if (!tid) continue;
      const age = at(r, 'Age');
      const rec = {
        tid,
        claimYear: clean(at(r, 'CLAIMSUBMISSIONYEAR')),
        claimMonth: clean(at(r, 'CLAIMSUBMISSIONMONTH')),
        name: clean(at(r, 'Patient Name')),
        gender: normGender(at(r, 'Gender')),
        age: age === '' || age == null ? '' : num(age),
        card: clean(at(r, 'RGHS Card No.')).replace(/\.0+$/, ''),
        created: toISO(at(r, 'Transaction Id Created On'), true) || tidDate(tid),
        amount: num(at(r, 'Hospital Claim Amount')),
        doctor: clean(at(r, 'TREATING DOCTOR NAME')),
        dept: 'OPD', status: ''
      };
      records.push(rec);
      const panelRaw = at(r, 'PANEL');
      if (panelRaw !== '' && panelRaw != null) {
        const h = { tid, mr: '', patient: rec.name, date: rec.created, doctor: rec.doctor, total: r2(evalPlus(panelRaw)), cats: {}, lines: [] };
        CATS.forEach((k) => { h.cats[k] = num(at(r, k)); });
        h.cats.LAB = r2(h.total - CATS.reduce((s, k) => s + h.cats[k], 0));
        hospedia[tid] = h;
      }
    }
    return { records, hospedia };
  }
  // the hand-made sheet sometimes has "=1826+350" in PANEL
  function evalPlus(v) {
    if (typeof v === 'number') return v;
    const s = String(v || '').replace(/^=\+?/, '').replace(/\s+/g, '');
    if (/^[0-9.+\-]+$/.test(s)) return s.split(/(?=[+\-])/).reduce((a, x) => a + (parseFloat(x) || 0), 0);
    return num(v);
  }

  /* ---------- building the month ---------- */
  /**
   * opt: {month:'2026-10', records:[...]|{tid:rec}, hospedia:{tid:h}, payments:{tid:p},
   *       dept:'OPD'|'IPD'|'DC'|'ALL', includePending:false}
   * returns {month, dept, days:{1:[row]}, rows:[row], checks:[...], totals}
   */
  function buildMonth(opt) {
    const ym = opt.month;
    const dept = opt.dept || 'OPD';
    const recs = Array.isArray(opt.records) ? opt.records : Object.values(opt.records || {});
    const hos = opt.hospedia || {};
    const pays = opt.payments || {};
    const n = daysIn(ym);
    const days = {};
    for (let d = 1; d <= n; d++) days[d] = [];
    const checks = [];
    const seen = new Set();
    const rows = [];
    for (const rec of recs) {
      if (!rec || !rec.tid) continue;
      const created = rec.created || tidDate(rec.tid);
      if (monthOf(created) !== ym) continue;
      if (dept !== 'ALL' && rec.dept && rec.dept !== dept) continue;
      const claimed = num(rec.amount) > 0 && !RX_UPLOAD.test(rec.status || '');
      if (!claimed && !opt.includePending) continue;
      if (seen.has(rec.tid)) continue;
      seen.add(rec.tid);
      const h = hos[rec.tid] || null;
      const row = {
        tid: rec.tid,
        year: rec.claimYear ? (num(rec.claimYear) || rec.claimYear) : +created.slice(0, 4),
        monthName: rec.claimMonth || monthName(created),
        name: rec.name || (h && h.patient) || '',
        gender: rec.gender || '',
        age: rec.age === '' || rec.age == null ? '' : num(rec.age),
        card: rec.card || '',
        created,
        amount: num(rec.amount),
        doctor: rec.doctor || (h && h.doctor ? sheetDoctor(h.doctor) : ''),
        panel: h ? h.total : null,
        cats: h ? h.cats : null,
        status: rec.status || '',
        pay: pays[rec.tid] || null,
        claimed
      };
      row.diff = row.panel == null ? null : r2(row.amount - row.panel);
      row.lab = r2(row.amount - (row.cats ? CATS.reduce((s, k) => s + (row.cats[k] || 0), 0) : 0));
      const day = +created.slice(8, 10);
      days[day].push(row);
      rows.push(row);
      if (!h) checks.push({ tid: rec.tid, day, name: row.name, kind: 'No Hospedia bill', detail: 'TID is in RGHS but not in the Hospedia report. Open the Hospedia report for ' + isoToDmy(created) + '.' });
      else if (Math.abs(row.diff) > 0.009) checks.push({ tid: rec.tid, day, name: row.name, kind: 'Amount differs', detail: 'RGHS ₹' + row.amount + ' vs Hospedia ₹' + row.panel + ' (DIFF ' + row.diff + ')' });
      if (h && row.lab < -0.009) checks.push({ tid: rec.tid, day, name: row.name, kind: 'LAB below 0', detail: 'Hospedia items add up to more than the RGHS claim amount' });
      if (!row.doctor) checks.push({ tid: rec.tid, day, name: row.name, kind: 'No doctor', detail: 'No treating doctor in RGHS or in Hospedia' });
      if (!claimed) checks.push({ tid: rec.tid, day, name: row.name, kind: 'Not claimed yet', detail: rec.status || 'Claim amount is 0' });
      if (!row.gender || row.age === '' || !row.card) checks.push({ tid: rec.tid, day, name: row.name, kind: 'Patient details missing', detail: 'Gender / Age / Card No. not read. Open the Transaction ID Tracker that shows these columns.' });
    }
    // Hospedia bills of this month that are not in RGHS
    const rghsTids = new Set(recs.map((r) => r && r.tid));
    for (const tid of Object.keys(hos)) {
      const h = hos[tid];
      const d = tidDate(tid) || h.date || '';
      if (monthOf(d) !== ym || rghsTids.has(tid)) continue;
      checks.push({ tid, day: +d.slice(8, 10) || '', name: h.patient, kind: 'Not in RGHS', detail: 'Hospedia bill ₹' + h.total + ' but the TID was not read from the RGHS tracker' });
    }
    // order inside a day: TID creation order (the TID holds the time)
    for (const d of Object.keys(days)) days[d].sort((a, b) => tidKey(a.tid).localeCompare(tidKey(b.tid)));
    rows.sort((a, b) => a.created.localeCompare(b.created) || tidKey(a.tid).localeCompare(tidKey(b.tid)));
    checks.sort((a, b) => (a.day || 0) - (b.day || 0) || a.kind.localeCompare(b.kind));
    return { month: ym, dept, days, rows, checks, totals: summarise(rows) };
  }
  // 2026100111464595 and 202610011035165 have different lengths; compare the time part as HHMMSS
  function tidKey(tid) {
    const s = String(tid);
    const m = /^(\d{8})(\d{1,2})(\d{2})(\d{2})(\d*)$/.exec(s);
    return m ? m[1] + pad(m[2]) + m[3] + m[4] + m[5].padEnd(4, '0') : s;
  }
  function isoToDmy(s) { return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(8, 10) + '-' + s.slice(5, 7) + '-' + s.slice(0, 4) : (s || ''); }

  function summarise(rows) {
    const t = { count: rows.length, amount: 0, panel: 0, withHospedia: 0, diffCount: 0, diffAmt: 0, cats: {}, byDoctor: {}, byDay: {}, paid: 0, paidCount: 0 };
    ALL_CATS.forEach((k) => { t.cats[k] = 0; });
    for (const r of rows) {
      t.amount += r.amount;
      const day = +r.created.slice(8, 10);
      const bd = t.byDay[day] || (t.byDay[day] = { count: 0, amount: 0, panel: 0, diffCount: 0 });
      bd.count++; bd.amount += r.amount;
      if (r.panel != null) {
        t.withHospedia++; t.panel += r.panel; bd.panel += r.panel;
        if (Math.abs(r.diff) > 0.009) { t.diffCount++; t.diffAmt += r.diff; bd.diffCount++; }
        CATS.forEach((k) => { t.cats[k] += r.cats[k] || 0; });
      }
      t.cats.LAB += r.lab;
      const dn = clean(r.doctor) || '(no doctor)';
      const doc = t.byDoctor[dn] || (t.byDoctor[dn] = { count: 0, amount: 0 });
      doc.count++; doc.amount += r.amount;
      const pa = r.pay && paidAmount(r.pay);
      if (pa) { t.paid += pa; t.paidCount++; }
    }
    t.amount = r2(t.amount); t.panel = r2(t.panel); t.diffAmt = r2(t.diffAmt); t.paid = r2(t.paid);
    ALL_CATS.forEach((k) => { t.cats[k] = r2(t.cats[k]); });
    for (const d of Object.keys(t.byDay)) { t.byDay[d].amount = r2(t.byDay[d].amount); t.byDay[d].panel = r2(t.byDay[d].panel); }
    return t;
  }

  /* ---------- payments (Payment Tracker) ---------- */
  function payKey(p, re, not) {
    const keys = Object.keys((p && p.cols) || {});
    return keys.find((k) => re.test(hk(k)) && !(not && not.test(hk(k))));
  }
  /** p: {cols: {header: value}} -> amount paid (0 when not found) */
  function paidAmount(p) {
    if (!p || !p.cols) return 0;
    const k = payKey(p, /netpaid|paidamount|amountpaid|netamount|netpayable|paymentamount|releasedamount|finalamount|amountreleased/) ||
      payKey(p, /paid|payable/, /date|status|utr|mode|on$/);
    return k ? num(p.cols[k]) : 0;
  }
  function paymentFields(p) {
    if (!p || !p.cols) return {};
    const f = (re, not) => { const k = payKey(p, re, not); return k ? p.cols[k] : ''; };
    return {
      paid: paidAmount(p),
      approved: num(f(/approvedamount|sanctionedamount|admissibleamount|passedamount|approvedamt/)),
      deduction: num(f(/deduct/)),
      utr: clean(f(/utr|chequeno|referenceno|transactionref/)),
      date: clean(f(/paymentdate|paidon|paiddate|releasedate|utrdate|releasedon/)),
      status: clean(f(/paymentstatus|status/))
    };
  }
  /** headers + rows of the Payment Tracker -> {tid: {tid, cols:{header:value}}} */
  function paymentsFromTable(headers, rows) {
    const c = detectRghsCols(headers);
    const out = {};
    if (c.tid < 0) return out;
    for (const cells of rows || []) {
      const tid = clean(cells[c.tid]).replace(/\.0+$/, '');
      if (!looksTid(tid)) continue;
      const cols = {};
      headers.forEach((h, i) => { const k = clean(h); if (k && i !== c.tid && clean(cells[i]) !== '' && !/^(s\.?\s*no\.?|sr\.?\s*no\.?|action|view|#)$/i.test(k)) cols[k] = clean(cells[i]); });
      out[tid] = { tid, cols };
    }
    return out;
  }

  /* ---------- Excel ---------- */
  function excelSerial(y, m, d) { return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); }
  /** One day sheet in the exact layout of the hand-made sheet */
  function daySheet(X, rows) {
    const ws = {};
    const at = (r, c) => X.utils.encode_cell({ r, c });
    HEADERS.forEach((h, c) => { ws[at(0, c)] = { t: 's', v: h }; });
    rows.forEach((row, i) => {
      const r = i + 1, R = r + 1; // R = Excel row number
      const put = (c, cell) => { ws[at(r, c)] = cell; };
      put(0, typeof row.year === 'number' ? { t: 'n', v: row.year } : { t: 's', v: String(row.year) });
      put(1, { t: 's', v: row.monthName });
      put(2, { t: 's', v: row.name });
      put(3, { t: 's', v: row.gender });
      if (row.age !== '') put(4, { t: 'n', v: row.age });
      put(5, { t: 's', v: row.card, z: '@' });
      const [y, m, d] = row.created.split('-').map(Number);
      put(6, { t: 'n', v: excelSerial(y, m, d), z: 'dd-mm-yyyy' });
      put(7, { t: 's', v: row.tid, z: '@' });
      put(8, { t: 'n', v: row.amount });
      put(9, { t: 's', v: row.doctor });
      if (row.panel != null) put(10, { t: 'n', v: row.panel });
      put(11, { t: 'n', f: '+I' + R + '-K' + R, v: row.panel == null ? row.amount : row.diff });
      CATS.forEach((k, j) => { const v = row.cats ? row.cats[k] : 0; if (v) put(12 + j, { t: 'n', v }); });
      put(20, { t: 'n', f: '+I' + R + '-M' + R + '-N' + R + '-O' + R + '-P' + R + '-Q' + R + '-R' + R + '-S' + R + '-T' + R, v: row.lab });
    });
    const ref = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length, 1), c: HEADERS.length - 1 } });
    ws['!ref'] = ref;
    ws['!cols'] = HEADERS.map((h) => ({ wch: /Patient|DOCTOR/.test(h) ? 22 : /Card|Transaction Id$/.test(h) ? 19 : 13 }));
    if (rows.length) ws['!autofilter'] = { ref };
    return ws;
  }

  /** The whole month: sheets 1..31 (same as the hand-made file), then Summary, Check and Payments. opt.day = one day only */
  function monthWorkbook(X, built, opt) {
    opt = opt || {};
    const wb = X.utils.book_new();
    const dayList = opt.day ? [+opt.day] : Object.keys(built.days).map(Number);
    for (const d of dayList) X.utils.book_append_sheet(wb, daySheet(X, built.days[d] || []), String(d));
    if (opt.day) return wb;
    const t = built.totals;
    const sum = [['PJ RGHS daily sheet - ' + monthName(built.month) + ' ' + built.month.slice(0, 4) + ' (' + (built.dept === 'ALL' ? 'All departments' : built.dept) + ')'], [],
      ['Day', 'TIDs', 'Hospital Claim Amount', 'PANEL (Hospedia)', 'DIFF rows']];
    Object.keys(built.days).forEach((d) => { const b = t.byDay[d] || { count: 0, amount: 0, panel: 0, diffCount: 0 }; sum.push([+d, b.count, b.amount, b.panel, b.diffCount]); });
    sum.push(['Total', t.count, t.amount, t.panel, t.diffCount]);
    sum.push([], ['Column', 'Amount']);
    ALL_CATS.forEach((k) => sum.push([k, t.cats[k]]));
    sum.push([], ['Treating doctor', 'TIDs', 'Hospital Claim Amount']);
    Object.keys(t.byDoctor).sort((a, b) => t.byDoctor[b].count - t.byDoctor[a].count).forEach((k) => sum.push([k, t.byDoctor[k].count, r2(t.byDoctor[k].amount)]));
    if (t.paidCount) sum.push([], ['Paid (Payment Tracker)', t.paidCount, t.paid]);
    const ws = X.utils.aoa_to_sheet(sum);
    ws['!cols'] = [{ wch: 28 }, { wch: 10 }, { wch: 22 }, { wch: 18 }, { wch: 10 }];
    X.utils.book_append_sheet(wb, ws, 'Summary');
    const chk = [['Day', 'Transaction Id', 'Patient Name', 'Problem', 'Details']].concat(built.checks.map((c) => [c.day, String(c.tid), c.name || '', c.kind, c.detail]));
    const wc = X.utils.aoa_to_sheet(chk);
    wc['!cols'] = [{ wch: 6 }, { wch: 19 }, { wch: 24 }, { wch: 22 }, { wch: 80 }];
    X.utils.book_append_sheet(wb, wc, 'Check');
    const paid = built.rows.filter((r) => r.pay);
    if (paid.length) {
      const pr = [['Transaction Id', 'Patient Name', 'Hospital Claim Amount', 'Approved', 'Deduction', 'Paid', 'Payment date', 'UTR / Ref', 'Payment status']];
      paid.forEach((r) => { const p = paymentFields(r.pay); pr.push([String(r.tid), r.name, r.amount, p.approved || '', p.deduction || '', p.paid || '', p.date, p.utr, p.status]); });
      const wp = X.utils.aoa_to_sheet(pr);
      wp['!cols'] = [{ wch: 19 }, { wch: 24 }, { wch: 12 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 14 }, { wch: 22 }, { wch: 18 }];
      X.utils.book_append_sheet(wb, wp, 'Payments');
    }
    return wb;
  }
  function fileName(built, day) {
    const mm = monthName(built.month).slice(0, 3).toUpperCase();
    return 'RGHS_' + mm + '_' + built.month.slice(2, 4) + '_' + (built.dept === 'ALL' ? 'ALL' : built.dept) + (day ? '_DAY' + day : '') + '.xlsx';
  }

  /* ---------- merging new data into stored data ---------- */
  /** Newer non-empty values win; empty values never wipe what we already know. */
  function mergeRecord(old, nu) {
    if (!old) return Object.assign({}, nu);
    const out = Object.assign({}, old);
    for (const k of Object.keys(nu)) {
      const v = nu[k];
      if (v === '' || v == null) continue;
      out[k] = v;
    }
    return out;
  }

  /* ---------- storage (same layout in the extension and the mobile app) ----------
     kv: {get(key) -> Promise<value|undefined>, set(key, value) -> Promise}
     r:YYYY-MM = RGHS records {tid: rec}, h:YYYY-MM = Hospedia bills {tid: h}, p:YYYY-MM = payments {tid: {tid, cols}}
     dataIndex = {YYYY-MM: {r, h, p, at}}. The bucket is the month written in the TID itself. */
  function makeStore(kv) {
    const group = (list, fn) => { const g = {}; for (const x of list) { const b = fn(x); (g[b] = g[b] || []).push(x); } return g; };
    async function touch(kind, b, n) {
      const idx = (await kv.get('dataIndex')) || {};
      const m = idx[b] || (idx[b] = { r: 0, h: 0, p: 0 });
      m[kind] = n; m.at = Date.now();
      await kv.set('dataIndex', idx);
    }
    async function put(kind, list, bucketFn, mergeFn) {
      const groups = group(list, bucketFn);
      let count = 0;
      for (const b of Object.keys(groups)) {
        const key = kind + ':' + b;
        const cur = (await kv.get(key)) || {};
        for (const x of groups[b]) { cur[x.tid] = mergeFn(cur[x.tid], x); count++; }
        await kv.set(key, cur);
        await touch(kind, b, Object.keys(cur).length);
      }
      return { ok: true, count };
    }
    return {
      saveRecords: (records) => put('r', (records || []).filter((r) => r && r.tid), (r) => bucketOf(r.tid, r.created),
        (o, n) => mergeRecord(o, Object.assign({}, n, { seenAt: Date.now() }))),
      saveHospedia: (map) => put('h', Object.values(map || {}).filter((h) => h && h.tid), (h) => bucketOf(h.tid, h.date),
        (o, n) => { const c = Object.assign({}, n, { at: Date.now() }); delete c.lines; return c; }),
      savePayments: (map) => put('p', Object.values(map || {}).filter((p) => p && p.tid), (p) => bucketOf(p.tid),
        (o, n) => ({ tid: n.tid, cols: Object.assign({}, o && o.cols, n.cols), at: Date.now() })),
      async loadMonth(ym) {
        return { records: (await kv.get('r:' + ym)) || {}, hospedia: (await kv.get('h:' + ym)) || {}, payments: (await kv.get('p:' + ym)) || {} };
      },
      index: async () => (await kv.get('dataIndex')) || {},
      async clearMonth(ym) {
        for (const k of ['r', 'h', 'p']) await kv.set(k + ':' + ym, {});
        const idx = (await kv.get('dataIndex')) || {};
        delete idx[ym];
        await kv.set('dataIndex', idx);
      }
    };
  }

  /** Any workbook (2D rows per sheet) -> what kind of data it holds. Used by the import in the app. */
  function classifySheet(rows) {
    const daily = readDailySheet(rows);
    if (daily) return { kind: 'daily', daily };
    for (let i = 0; i < Math.min(rows.length, 40); i++) {
      const H = (rows[i] || []).map(hk);
      if (H.includes('tid') && (H.includes('itemname'))) return { kind: 'hospedia', rows: rows.slice(i) };
      const c = detectRghsCols(rows[i] || []);
      if (c.tid >= 0) {
        const isPay = H.some((h) => /utr|paidamount|amountpaid|netpaid|paymentdate|paymentstatus|paidon|netpayable/.test(h));
        return { kind: isPay ? 'payment' : 'tracker', headers: rows[i].map(clean), rows: rows.slice(i + 1) };
      }
    }
    return { kind: 'unknown' };
  }

  const api = { makeStore, classifySheet, HEADERS, CATS, ALL_CATS, toISO, tidDate, bucketOf, monthOf, monthName, daysIn, detectRghsCols, recordsFromTracker,
    categorize, hospediaSummary, sheetDoctor, readDailySheet, buildMonth, monthWorkbook, daySheet, fileName, mergeRecord,
    paymentsFromTable, paidAmount, paymentFields, normDept, normGender, isoToDmy, tidKey, evalPlus, looksTid };
  root.DailySheet = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
