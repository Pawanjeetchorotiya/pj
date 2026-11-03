/* JCNH RGHS OPD Claim Maker - core logic (no browser APIs here, so it can be tested anywhere) */
(function (root) {
  'use strict';

  const TEMPLATE_HEADERS = ['TID', 'Speciality', 'Doctor', 'RMC No', 'RMC Type', 'Doctor Speciality', 'Package Codes',
    'Prescription Date', 'Validity Days', 'Chief Complaints', 'Diagnosis', 'Bill Amount', 'Discount', 'Match Key',
    'Prescription File', 'Investigation File', 'Bill File', 'Diagnosis File'];

  const HOW_TO_FILL = [
    ['Column', 'What to write'],
    ['TID', 'RGHS Transaction ID (required). Keep the cell as Text so the number does not change.'],
    ['Speciality', 'Same as the portal list, e.g. General Medicine, Orthopaedics, ENT'],
    ['Doctor', 'Empaneled doctor name as in the portal list, e.g. DR C. P SINGHAL'],
    ['RMC No', "Doctor's RMC number. Write it once - the tool remembers it for that doctor next time."],
    ['RMC Type', 'UG or PG'],
    ['Doctor Speciality', 'Only if the portal asks for it after RMC verify'],
    ['Package Codes', 'RGHS package codes, separated by ;  e.g. CODE1; CODE2'],
    ['Prescription Date', 'DD-MM-YYYY'],
    ['Validity Days', '15, 30, 45, 60 or 90'],
    ['Chief Complaints / Diagnosis', 'Max 250 characters each'],
    ['Bill Amount / Discount', 'Numbers only'],
    ['Match Key', 'Optional. UHID or OPD No. if your scan file names use that instead of TID'],
    ['Prescription / Investigation / Bill / Diagnosis File', 'Optional. Exact file name in the scan folder. If blank, the tool finds PDFs whose name has the TID (or Match Key) and words like slip, lab, report, bill.']
  ];

  // ---------- helpers ----------
  const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/[,₹\s]/g, '')); return isNaN(n) ? 0 : n; };
  const round2 = n => Math.round(n * 100) / 100;
  const clean = s => String(s == null ? '' : s).replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim();

  // Hospedia header names (screen + Excel export) -> our keys
  const HEADER_MAP = {
    mr: ['mr no', 'mrno', 'uhid'], patient: ['patient name', 'patientname'], date: ['date', 'bill date', 'billdate'],
    type: ['type', 'bill type', 'billtype'], tid: ['tid'], billNo: ['bill no', 'billno'], item: ['item name', 'itemname'],
    qty: ['qty', 'quantity'], rate: ['rate'], gross: ['gross', 'grossamt', 'gross amt'], disc: ['discount', 'discamt', 'disc amt'],
    amount: ['amount', 'amt'], panel: ['panel name', 'panelname']
  };
  const hkey = h => clean(h).toLowerCase().replace(/[.:]/g, '').trim();

  /** rows2d: array of arrays (first matching row with TID + Item Name is the header) */
  function parseRows(rows2d) {
    let hi = -1, map = null;
    for (let i = 0; i < Math.min(rows2d.length, 40); i++) {
      const hs = (rows2d[i] || []).map(hkey);
      if (hs.includes('tid') && (hs.includes('item name') || hs.includes('itemname'))) {
        map = {};
        for (const [k, names] of Object.entries(HEADER_MAP)) {
          const idx = hs.findIndex(h => names.includes(h));
          if (idx >= 0) map[k] = idx;
        }
        hi = i; break;
      }
    }
    if (hi < 0) throw new Error('Could not find the Hospedia report table. It must have the columns TID and Item Name.');
    const items = [];
    for (const r of rows2d.slice(hi + 1)) {
      const g = k => map[k] == null ? '' : clean(r[map[k]]);
      const tid = g('tid').replace(/\.0+$/, '');
      const item = g('item');
      if (!tid && !item) continue;
      if (/^total/i.test(g('panel')) || /^total/i.test(clean(r[0]))) continue;
      items.push({
        mr: g('mr'), patient: g('patient'), date: g('date'), type: g('type').toUpperCase(), tid, billNo: g('billNo'),
        item, qty: num(g('qty')) || 1, rate: num(g('rate')), gross: num(g('gross')), disc: num(g('disc')),
        amount: map.amount != null ? num(g('amount')) : num(g('gross')) - num(g('disc'))
      });
    }
    return items;
  }

  // ---------- name matching ----------
  const ALIASES = [
    [/\bx[\s-]*ray\b/g, ' xray '], [/\busg\b/g, ' ultrasound usg '], [/\bultrasound\b/g, ' ultrasound usg '],
    [/\bsonography\b/g, ' ultrasound usg '], [/\bcomplete blood count\b|\bcbc\b/g, ' cbc haemogram '], [/\bhaemogram\b|\bhemogram\b/g, ' haemogram cbc '],
    [/\bhemoglobin\b|\bhb\b/g, ' haemoglobin '], [/\bliver function\b|\blft\b/g, ' lft liver function '],
    [/\bkidney function\b|\brenal function\b|\bkft\b|\brft\b/g, ' kft rft kidney renal function '],
    [/\bsugar\b|\bglucose\b|\bbsl\b|\bbs\b/g, ' glucose '], [/\brandom\b|\brbs\b/g, ' random '], [/\bpp\b|\bpost prandial\b/g, ' pp '],
    [/\bfbs\b/g, ' glucose fasting '], [/\bbrain\b/g, ' head brain '], [/\bhead\b/g, ' head brain '],
    [/\burine (complete|routine|r ?m|re)\b|\burine r\b/g, ' urine routine '], [/\besr\b|\berythrocyte sedimentation\b/g, ' esr erythrocyte sedimentation '],
    [/\bcrp\b|\bc reactive protein\b/g, ' crp creactive '], [/\bquantitative\b|\bquant\b/g, ' quantitative '],
    [/\bhbsag\b|\bhepatitis b surface antigen\b/g, ' hbsag '], [/\bhcv\b/g, ' hcv '], [/\bhiv\b/g, ' hiv '],
    [/\bbeta hcg\b|\bb ?hcg\b/g, ' hcg chorionic '], [/\bhcg\b|\bchorionic gonadotropin\b/g, ' hcg chorionic '],
    [/\bsgpt\b|\balt\b/g, ' sgpt '], [/\bsgot\b|\bast\b/g, ' sgot '], [/\buric acid\b/g, ' uric '],
    [/\bap ?\/? ?lat\b|\bap ?\/? ?lt\b|\bap lateral\b/g, ' ap lateral '], [/\bopg\b/g, ' opg '],
    [/\bthyroid profile\b|\btft\b/g, ' thyroid tft t3 t4 tsh '], [/\blipid profile\b/g, ' lipid profile '],
    [/\becg\b|\bekg\b/g, ' ecg electrocardiogram '], [/\becho\b|\b2d echo\b/g, ' echocardiography echo '],
    [/\bct\b|\bcect\b|\bncct\b/g, ' ct '], [/\bmri\b/g, ' mri '], [/\bplain\b/g, ' without contrast plain '],
    [/\bpelvis\b|\bpelvic\b/g, ' pelvic pelvis '], [/\babdomen\b|\babdominal\b/g, ' abdomen '],
    [/\bknee\b|\bhand\b|\bankle\b|\bleg\b|\bhip\b|\bthigh\b|\belbow\b|\bwrist\b|\bshoulder\b|\bforearm\b|\bfoot\b|\barm\b/g, ' extremities joints '],
    [/\bcervical\b|\blumbar\b|\bdorsal\b|\bthoracic\b|\bls\b/g, ' spine ']
  ];
  const STOP = new Set(['the', 'of', 'and', 'with', 'for', 'test', 'serum', 'total', 'level', 'levels', 'r', 'etc', 'in', 'a', 'to', 'by', 'or', 'only', 'film', 'films', 'view', 'views', 'one', 'two', 'both', 'first', 'visit']);
  function tokens(s) {
    let t = ' ' + clean(s).toLowerCase().replace(/[^a-z0-9/ ]+/g, ' ').replace(/\//g, ' / ') + ' ';
    t = t.replace(/ \/ /g, ' ');
    for (const [re, rep] of ALIASES) t = t.replace(re, rep);
    return new Set(t.split(/\s+/).filter(w => w && w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w)));
  }
  function nameScore(itemTok, codeTok) {
    if (!itemTok.size || !codeTok.size) return 0;
    let hit = 0; for (const w of itemTok) if (codeTok.has(w)) hit++;
    return hit / itemTok.size - Math.min(0.15, codeTok.size * 0.004);
  }
  const normItem = s => clean(s).toUpperCase().replace(/\s*-\s*[0-9]+[A-Z]?\s*$/, '').replace(/\s+/g, ' ').trim();

  function makeCodeIndex(codes) {
    const byCode = new Map();
    const list = codes.map(c => {
      const o = { code: String(c[0]).trim(), name: c[1], nabh: c[2], non: c[3] };
      o.tok = tokens(o.name); byCode.set(o.code.toUpperCase(), o); return o;
    });
    return { list, byCode };
  }
  function rateOk(c, r, rateType) {
    const n = Math.abs((c.nabh || -9) - r) <= 1, x = Math.abs((c.non || -9) - r) <= 1;
    return rateType === 'NABH' ? n : rateType === 'NON' ? x : (n || x);
  }

  /** returns {code, codeName, codeRate, status: ok|fixed|check|missing|skip, note} */
  function matchItem(it, idx, learned, settings) {
    const rateType = settings.rateType || 'ANY';
    const r = it.rate || (it.qty ? it.gross / it.qty : 0);
    const res = (o, status, note) => ({ code: o ? o.code : '', codeName: o ? o.name : '', codeRate: o ? (rateType === 'NON' ? o.non : o.nabh) : '', status, note: note || '' });

    if (/registration/i.test(it.item) || (it.type === 'CR' && !it.amount)) return res(null, 'skip', 'Registration fee - not claimed');
    const key = normItem(it.item);
    if (learned && learned[key]) {
      const o = idx.byCode.get(String(learned[key]).toUpperCase());
      return res(o || { code: learned[key], name: '(saved by you)', nabh: '', non: '' }, 'ok', 'Your saved code for this item');
    }
    if (/APPOINTMENT|CONSULT/.test(it.type) || /consult|first visit|follow ?up|revisit/i.test(it.item)) {
      const c = idx.list.find(c => /^consultation opd$/i.test(c.name) && rateOk(c, r, rateType));
      if (c) return res(c, 'ok', 'Consultation');
      const d = idx.byCode.get('1A');
      return res(d, 'check', `Consultation rate ₹${r} does not match code 1A (₹${d && d.nabh})`);
    }
    const itok = tokens(it.item.replace(/\s*-\s*[0-9]+[A-Z]?\s*$/, ''));
    const best = (cands) => { let b = null, s = -1; for (const c of cands) { const sc = nameScore(itok, c.tok); if (sc > s) { s = sc; b = c; } } return { c: b, s }; };
    const rateCands = idx.list.filter(c => rateOk(c, r, rateType));

    const m = it.item.match(/-\s*([0-9]+[A-Z]?)\s*$/i);
    if (m) {
      const hc = idx.byCode.get(m[1].toUpperCase());
      if (hc && rateOk(hc, r, rateType)) {
        if (nameScore(itok, hc.tok) < 0.15)
          return res(hc, 'check', `Hospedia code ${hc.code} rate matches, but name is "${hc.name.slice(0, 50)}" - please check`);
        return res(hc, 'ok', 'Hospedia code, rate matches');
      }
      const alt = best(rateCands);
      if (alt.c && alt.s >= 0.5) return res(alt.c, 'fixed', `Hospedia code ${m[1]} ${hc ? 'is ₹' + hc.nabh + ' (' + hc.name.slice(0, 40) + ')' : 'not in master'}; bill rate ₹${r} matches ${alt.c.code}`);
      if (hc) {
        const k = hc.nabh ? r / hc.nabh : 0;
        if (k >= 1.9 && Math.abs(k - Math.round(k)) < 0.02) return res(hc, 'check', `Bill rate ₹${r} = ${Math.round(k)} × code rate ₹${hc.nabh}. Add the code ${Math.round(k)} times or check quantity.`);
        return res(hc, 'check', `Hospedia code ${hc.code} rate is ₹${hc.nabh}, bill rate is ₹${r}`);
      }
    }
    const b = best(rateCands);
    if (b.c && b.c.code === '1444' && /fasting|\bpp\b|post ?prandial/i.test(it.item))
      return res(b.c, 'check', 'Only RGHS code at this rate is 1444 (Blood Glucose Random). If Fasting + PP are billed together, code 1465 (₹54) may apply.');
    if (b.c && b.s >= 0.75) return res(b.c, 'ok', 'Matched by name and rate');
    if (b.c && b.s >= 0.45) return res(b.c, 'check', 'Rate matches, name partly matches - please check');
    // multiple of a code rate (e.g. both knees = 2 films)
    let mb = null, ms = -1, mk = 0;
    for (const c of idx.list) {
      if (!c.nabh) continue; const k = r / c.nabh;
      if (k >= 1.9 && k <= 4.1 && Math.abs(k - Math.round(k)) < 0.01) { const sc = nameScore(itok, c.tok); if (sc > ms) { ms = sc; mb = c; mk = Math.round(k); } }
    }
    if (mb && ms >= 0.45) return res(mb, 'check', `Bill rate ₹${r} = ${mk} × code rate ₹${mb.nabh}. Add the code ${mk} times or check quantity.`);
    const n = best(idx.list);
    if (n.c && n.s >= 0.6) return res(n.c, 'check', `Name matches ${n.c.code} but rate is different (code ₹${n.c.nabh}, bill ₹${r})`);
    return res(null, 'missing', 'No RGHS code found - type the code');
  }

  // ---------- doctors ----------
  const compact = s => clean(s).toUpperCase().replace(/\(.*?\)/g, ' ').replace(/^\s*DR\.?\s+/, ' ').replace(/\bDR\.?\s/g, ' ').replace(/[^A-Z]/g, '');
  function findDoctor(rawName, doctors) {
    const c = compact(rawName); if (!c) return null;
    let d = doctors.find(d => compact(d.name) === c || (d.alias && compact(d.alias) === c));
    if (d) return d;
    const words = clean(rawName).toUpperCase().replace(/\(.*?\)/g, '').replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && w !== 'DR');
    const cands = doctors.filter(d => words.length && words.every(w => compact(d.name).includes(w)));
    return cands.length === 1 ? cands[0] : null;
  }
  function rmcNo(reg, part) {
    const s = String(reg || '').trim(); if (!s.includes('/')) return s;
    const [a, b] = s.split('/').map(x => x.trim());
    return part === 'before' ? a : part === 'full' ? s : b;
  }
  // RMC number: the one you typed (from your RMC list) wins; otherwise taken from the registration number
  const doctorRmc = (d, part) => (d && d.rmc ? String(d.rmc).trim() : rmcNo(d && d.reg, part));
  const doctorFromItem = s => clean(s).replace(/\(.*?\)/g, '').trim();

  function toDMY(s, dayFirst) {
    s = clean(s); let m;
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) { // Hospedia screen = M/D/YYYY; some exports = D/M/YYYY
      const [d, mo] = dayFirst ? [m[1], m[2]] : [m[2], m[1]];
      return `${d.padStart(2, '0')}-${mo.padStart(2, '0')}-${m[3]}`;
    }
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[3]}-${m[2]}-${m[1]}`;
    if ((m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})/))) {
      const mo = 'janfebmaraprmayjunjulaugsepoctnovdec'.indexOf(m[2].toLowerCase()) / 3 + 1;
      return `${m[1].padStart(2, '0')}-${String(mo).padStart(2, '0')}-${m[3]}`;
    }
    if ((m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/))) return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}-${m[3]}`;
    return s;
  }

  function codesFromLines(lines, repeat) {
    const codes = [];
    for (const l of lines) {
      if (l.status === 'skip' || !l.code) continue;
      const mm = /= (\d) × code rate/.exec(l.note || ''); // e.g. both knees = 2 films
      const times = repeat ? (l.times != null ? l.times : (mm ? +mm[1] : 1)) * Math.max(1, Math.round(l.qty || 1)) : 1;
      for (let i = 0; i < times; i++) codes.push(l.code);
    }
    return codes;
  }
  function claimStatus(c) {
    const used = c.lines.filter(l => l.status !== 'skip');
    if (!c.doctor || !c.rmc || used.some(l => !l.code) || c.preAuth) return 'stop';
    if (used.some(l => l.status === 'check' || l.status === 'fixed' || l.qty > 1)) return 'check';
    return 'ready';
  }

  // ---------- build claims ----------
  function buildClaims(items, ctx) {
    const settings = Object.assign({ rateType: 'ANY', rmcPart: 'after', validity: 15, preAuthLimit: 2000, repeatQty: false }, ctx.settings || {});
    const idx = ctx.codeIndex || makeCodeIndex(ctx.codes);
    const doctors = ctx.doctors || [];
    // appointment doctor per MR + date (for lab-only TIDs)
    const apptDoc = {};
    for (const it of items) if (/APPOINTMENT|CONSULT/.test(it.type)) apptDoc[it.mr + '|' + it.date] = doctorFromItem(it.item);

    // Decide date order: if any date has first part > 12 it must be D/M/YYYY
    const dayFirst = items.some(it => { const m = /^(\d{1,2})\/(\d{1,2})\//.exec(it.date); return m && +m[1] > 12; });
    const noTid = items.filter(it => !it.tid && it.amount > 0 && !/registration/i.test(it.item));
    const groups = new Map();
    for (const it of items) { if (!it.tid) continue; if (!groups.has(it.tid)) groups.set(it.tid, []); groups.get(it.tid).push(it); }

    const claims = [];
    for (const [tid, its] of groups) {
      const first = its[0];
      const lines = its.map(it => Object.assign({}, it, matchItem(it, idx, ctx.learned || {}, settings)));
      const used = lines.filter(l => l.status !== 'skip');
      const notes = [];
      // doctor
      const appt = used.find(l => /APPOINTMENT|CONSULT/.test(l.type));
      let rawDoc = appt ? doctorFromItem(appt.item) : apptDoc[first.mr + '|' + first.date] || '';
      let doc = rawDoc ? findDoctor(rawDoc, doctors) : null;
      if (!rawDoc) notes.push('No consultation in this TID - choose the prescribing doctor');
      else if (!doc) notes.push(`Doctor "${rawDoc}" is not in your doctor list`);
      if (!appt && rawDoc) notes.push(`Doctor taken from same-day consultation (${rawDoc})`);
      // codes
      const codes = codesFromLines(used, settings.repeatQty);
      for (const l of used) {
        if (l.status === 'missing') notes.push(`No code for "${l.item}"`);
        else if (l.status === 'check') notes.push(`${l.item}: ${l.note}`);
        else if (l.status === 'fixed') notes.push(`${l.item}: ${l.note}`);
      }
      const multi = used.filter(l => l.qty > 1);
      if (multi.length) notes.push('Quantity more than 1 - check how the portal takes it: ' + multi.map(l => `${l.code || l.item} × ${l.qty}`).join(', '));
      const bill = round2(used.reduce((s, l) => s + l.amount, 0));
      const disc = round2(used.reduce((s, l) => s + l.disc, 0));
      // pre-auth warning
      const inv = used.filter(l => /LAB|INVEST|RADIO|PATH/.test(l.type) || /\b(ct|mri|doppler|usg|x-?ray)\b/i.test(l.item)); // investigations only (not consultation / physio)
      const invAmt = inv.reduce((s, l) => s + l.amount, 0);
      const bigScans = inv.filter(l => /\b(ct|mri|doppler)\b/i.test(l.item + ' ' + l.codeName)).length;
      let preAuth = '';
      if (invAmt > settings.preAuthLimit) preAuth = `Investigations ₹${round2(invAmt)} > ₹${settings.preAuthLimit}`;
      if (bigScans > 1) preAuth = (preAuth ? preAuth + '; ' : '') + `${bigScans} CT/MRI/Doppler`;
      if (preAuth) notes.unshift('PRE-AUTH NEEDED: ' + preAuth);
      const needText = true; // complaints + diagnosis always need a human
      claims.push({
        tid, mr: first.mr, patient: first.patient.replace(/\s+\d{12,}\s*$/, ''), date: first.date, bills: [...new Set(its.map(i => i.billNo))].join(', '),
        doctor: doc ? doc.name : rawDoc, doctorFound: !!doc, rmc: doc ? doctorRmc(doc, settings.rmcPart) : '', rmcType: doc ? doc.type : '',
        speciality: doc ? doc.speciality : '', docSpeciality: doc ? doc.speciality : '', dept: doc ? (doc.dept || '') : '',
        codes: codes.join('; '), prescDate: toDMY(first.date, dayFirst), validity: settings.validity, complaints: '', diagnosis: '',
        bill, discount: disc, matchKey: first.mr, files: ['', '', '', ''],
        lines, notes, preAuth, needText, selected: true
      });
      claims[claims.length - 1].status = claimStatus(claims[claims.length - 1]);
    }
    claims.sort((a, b) => a.tid.localeCompare(b.tid));
    claims.noTid = noTid; // billed RGHS rows that have no TID in Hospedia
    return claims;
  }

  function claimToRow(c) {
    return [c.tid, c.speciality, c.doctor, c.rmc, c.rmcType, c.docSpeciality, c.codes, c.prescDate, String(c.validity),
      c.complaints, c.diagnosis, c.bill, c.discount, c.matchKey, c.files[0], c.files[1], c.files[2], c.files[3]];
  }

  // ---------- claim register (Excel export) ----------
  // Bill heads in the order the register shows them. Lab is always the last column.
  const CATS = [['consult', 'Consult'], ['xray', 'X-Ray'], ['ct', 'CT'], ['usg', 'USG'], ['cbct', 'CBCT'], ['opg', 'OPG'], ['oct', 'OCT'], ['other', 'Other'], ['lab', 'Lab']];
  const LAB_WORDS = /\b(blood|serum|urine|stool|sputum|glucose|sugar|cbc|haemogram|hemogram|haemoglobin|hemoglobin|hb|hba1c|esr|crp|thyroid|tsh|t3|t4|lipid|lft|kft|rft|liver function|kidney function|renal function|creatinine|urea|uric|bilirubin|sgot|sgpt|albumin|protein|calcium|sodium|potassium|electrolyte|vitamin|culture|smear|antigen|antibody|hbsag|hcv|hiv|vdrl|widal|dengue|malaria|typhoid|platelet|prothrombin|pt ?inr|aptt|cholesterol|triglyceride|amylase|lipase|ferritin|iron|b12|d3|psa|hcg|elisa|rapid|test|profile|cell count|grouping|rh typing|peripheral)\b/i;
  function categoryOf(name, type) {
    const n = ' ' + clean(name).toLowerCase() + ' ', t = clean(type).toUpperCase();
    if (/APPOINTMENT|CONSULT/.test(t) || /consult|first visit|follow ?up|revisit/.test(n)) return 'consult';
    if (/\bcbct\b|cone ?beam/.test(n)) return 'cbct';
    if (/\bopg\b|orthopantomo|panoramic/.test(n)) return 'opg';
    if (/\boct\b|optical coherence/.test(n)) return 'oct';
    if (/\b(ct|cect|ncct|hrct|mdct)\b|computed tomo|ct ?scan|ct-/.test(n)) return 'ct';
    if (/\busg\b|ultra ?sound|sonograph|sonography|doppler|\btvs\b/.test(n)) return 'usg';
    if (/x[\s-]*ray|\bxray\b|radiograph|\bskiagram\b|\bfilms?\b|\b(ap|pa|lateral|oblique) views?\b/.test(n)) return 'xray';
    if (/LAB|PATH/.test(t) || LAB_WORDS.test(n)) return 'lab';
    return 'other';
  }
  /** lines: [{item|name, type, amount}] -> {consult, xray, ..., lab} amounts */
  function categorize(lines) {
    const out = {}; for (const [k] of CATS) out[k] = 0;
    for (const l of lines || []) {
      if (l.status === 'skip') continue;
      const k = categoryOf(l.item || l.name || '', l.type || '');
      out[k] = round2(out[k] + num(l.amount));
    }
    return out;
  }
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  /** any date text -> {d, m, y} (portal and sheets write day first) */
  function parseDMY(s) {
    s = clean(s); let m;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return { d: +m[3], m: +m[2], y: +m[1] };
    if ((m = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3})[A-Za-z]*[-/. ,]+(\d{4})/))) {
      const mo = 'janfebmaraprmayjunjulaugsepoctnovdec'.indexOf(m[2].toLowerCase()) / 3 + 1;
      return mo ? { d: +m[1], m: mo, y: +m[3] } : null;
    }
    if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/))) return { d: +m[1], m: +m[2], y: +m[3] };
    return null;
  }
  const dmyText = (o) => o ? `${String(o.d).padStart(2, '0')}-${String(o.m).padStart(2, '0')}-${o.y}` : '';
  /** the day a register record belongs to: TID creation date, else the OPD / bill date */
  const recordDay = (r) => parseDMY(r.tidDate) || parseDMY(r.prescDate) || parseDMY(r.date);
  const REGISTER_HEADERS = ['Month', 'Year', 'Patient Name', 'Age', 'RGHS Card No', 'TID', 'TID Creation Date', 'Treating Doctor',
    'Hospital Claim Amount (RGHS)', 'Hospedia Billing Amount', 'Difference (Hospedia - Claim)'].concat(CATS.map((c) => c[1]));
  /**
   * records: register entries; period: {kind:'day', d,m,y} | {kind:'month', m,y} | {kind:'all'}
   * returns {rows: [[...]] (header + data + total), days: [[...]] day-wise summary, count}
   */
  function registerSheet(records, period) {
    const inP = (r) => {
      if (!period || period.kind === 'all') return true;
      const x = recordDay(r); if (!x) return false;
      return x.y === period.y && x.m === period.m && (period.kind !== 'day' || x.d === period.d);
    };
    const key = (r) => { const x = recordDay(r); return x ? x.y * 10000 + x.m * 100 + x.d : 0; };
    const list = records.filter(inP).sort((a, b) => key(a) - key(b) || String(a.tid).localeCompare(String(b.tid)));
    const val = (v) => (v === '' || v == null ? '' : num(v));
    const rows = [REGISTER_HEADERS.slice()];
    const totals = new Array(REGISTER_HEADERS.length).fill('');
    const byDay = new Map();
    for (const r of list) {
      const x = recordDay(r);
      const claim = val(r.claimAmt), hosp = val(r.hospBill);
      const diff = claim === '' || hosp === '' ? '' : round2(hosp - claim);
      const cat = r.cat || {};
      const line = [x ? MONTHS[x.m - 1] : '', x ? x.y : '', r.patient || '', r.age || '', r.card || '', String(r.tid), dmyText(parseDMY(r.tidDate)) || r.tidDate || '',
        r.doctor || '', claim, hosp, diff].concat(CATS.map(([k]) => (cat[k] ? cat[k] : 0)));
      rows.push(line);
      for (let i = 8; i < line.length; i++) if (line[i] !== '') totals[i] = round2((totals[i] || 0) + line[i]);
      const dk = x ? dmyText(x) : '(no date)';
      const d = byDay.get(dk) || { n: 0, sums: new Array(line.length).fill(0) };
      d.n++; for (let i = 8; i < line.length; i++) d.sums[i] = round2(d.sums[i] + (line[i] || 0));
      byDay.set(dk, d);
    }
    totals[2] = `TOTAL (${list.length} claims)`;
    rows.push(totals);
    const days = [['Date', 'Claims'].concat(REGISTER_HEADERS.slice(8))];
    for (const [dk, d] of byDay) days.push([dk, d.n].concat(d.sums.slice(8)));
    return { rows, days, count: list.length };
  }

  root.ClaimEngine = { TEMPLATE_HEADERS, HOW_TO_FILL, parseRows, buildClaims, claimToRow, makeCodeIndex, codesFromLines, claimStatus, matchItem, findDoctor, rmcNo, doctorRmc, normItem, toDMY, tokens,
    CATS, REGISTER_HEADERS, categoryOf, categorize, parseDMY, registerSheet };
  if (typeof module !== 'undefined') module.exports = root.ClaimEngine;
})(typeof self !== 'undefined' ? self : globalThis);
