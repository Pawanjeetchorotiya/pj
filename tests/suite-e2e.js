// Whole-extension test: loads the unpacked PJ RGHS Suite into Chromium and drives mock portal pages.
//   RGHS tmsBisTrack1 (DataTable, 3 pages)  -> records saved for the daily sheet
//   RGHS tmsPaymentTrack (DataTable)        -> payment card + payments saved
//   Hospedia report page                    -> bill breakdown saved by itself
//   app/index.html (Daily sheet)            -> month Excel downloaded and checked cell by cell
//   popup.html, OPD page                    -> render without errors
// Usage: node tests/suite-e2e.js [--shots]      (needs Playwright + Chromium; data is synthetic)
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');
const XLSX = require('../lib/xlsx.full.min.js');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.argv.includes('--shots');
const OUT = process.env.PJ_OUT || path.join(os.tmpdir(), 'pj-e2e');
fs.mkdirSync(OUT, { recursive: true });
const VENDOR = fs.readFileSync(path.join(__dirname, 'vendor/jquery-3.7.1.min.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'vendor/jquery.dataTables-1.13.11.min.js'), 'utf8');

/* ---------- synthetic data (no real patients) ---------- */
const DOCS = ['DR MAHAVEER MALI (Orthopedic)', 'DR B C KARNAWAT (Medicine)', 'DR TEJPAL GHASAL (Dental)'];
const PEOPLE = [];
for (let i = 0; i < 28; i++) {
  const day = i < 16 ? 1 : 2;
  const tid = '202610' + String(day).padStart(2, '0') + String(10 + Math.floor(i / 3)).padStart(2, '0') + String(10 + i).padStart(2, '0') + '4' + (i % 10) + '9' + (i % 7);
  const items = [{ type: 'APPOINTMENT', item: DOCS[i % 3], amount: 350 }];
  if (i % 4 === 1) items.push({ type: 'RADIOLOGY', item: 'X-RAY KNEE AP/LAT - 1611', amount: 293 });
  if (i % 5 === 2) items.push({ type: 'RADIOLOGY', item: 'USG WHOLE ABDOMEN - 1700', amount: 560 });
  if (i % 7 === 3) items.push({ type: 'RADIOLOGY', item: 'CT SCAN DENTAL - 1655', amount: 1466 });
  if (i % 9 === 4) items.push({ type: 'RADIOLOGY', item: 'OPG - 1660', amount: 225 });
  if (i % 3 === 0) items.push({ type: 'LAB', item: 'CBC - 1400', amount: 126 });
  if (i % 6 === 5) items.push({ type: 'PROCEDURE', item: 'ECG', amount: 130 });
  const total = items.reduce((s, x) => s + x.amount, 0);
  PEOPLE.push({ i, day, tid, name: 'Test Patient ' + (i + 1), gender: i % 2 ? 'Male' : 'Female', age: 20 + i, card: '9900' + String(100000000 + i * 7919),
    dept: i === 27 ? 'IPD' : 'OPD', amount: i === 6 ? total + 28 : total, items, inHospedia: i !== 9, mr: 'MR' + (500 + i), doc: DOCS[i % 3] });
}
const EXTRA_HOS = { tid: '2026100211554000', name: 'Only In Hospedia', items: [{ type: 'APPOINTMENT', item: DOCS[0], amount: 350 }] };
const dmyOf = (d) => '0' + d + '-10-2026';

/* ---------- mock pages ---------- */
function trackerPage() {
  const H = ['S.No.', 'Transaction Id', 'Patient Name', 'Gender', 'Age', 'RGHS Card No.', 'Department', 'Transaction Id Created On', 'Hospital Claim Amount', 'Transaction Id Status', 'CLAIMSUBMISSIONYEAR', 'CLAIMSUBMISSIONMONTH'];
  const rows = PEOPLE.map((p, k) => [k + 1, p.tid, p.name, p.gender, p.age, p.card, p.dept, dmyOf(p.day), p.amount, 'Claim submitted by hospital', 2026, 'October']);
  rows.push([99, '2026100217000001', 'Pending Person', 'Male', 40, '99001', 'OPD', '02-10-2026', 0, 'Claim to be submitted by hospital', '', '']);
  return `<!doctype html><meta charset="utf-8"><title>RGHS</title><body style="font:13px Arial;margin:0">
  <div style="background:#0b5;color:#fff;padding:10px 16px;display:flex;gap:20px"><span class="toggle">☰</span><span>RGHS</span><span style="margin-left:auto">Welcome TEST HOSPITAL</span></div>
  <div class="card" style="margin:14px;padding:10px;border:1px solid #ccc"><h4>Transaction ID Tracker</h4>
  From <input id="fromDate" value="01-10-2026"> To <input id="toDate" value="31-10-2026"> <button id="srch" type="button">SEARCH</button></div>
  <div style="margin:14px"><h4>Beneficiary Details</h4><table id="tbl" class="display"><thead><tr>${H.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
  <script>${VENDOR}</script><script>$(function(){ $('#tbl').DataTable({ pageLength: 10 }); });</script></body>`;
}
function paymentPage() {
  const H = ['S.No.', 'TID', 'Patient Name', 'Claim Amount', 'Approved Amount', 'Deduction Amount', 'Paid Amount', 'UTR No', 'Payment Date', 'Payment Status'];
  const rows = PEOPLE.slice(0, 12).map((p, k) => [k + 1, p.tid, p.name, p.amount, p.amount - (k === 3 ? 50 : 0), k === 3 ? 50 : 0, p.amount - (k === 3 ? 50 : 0), 'UTR' + (777000 + k), '15-10-2026', 'Paid']);
  return `<!doctype html><meta charset="utf-8"><title>RGHS</title><body style="font:13px Arial;margin:0">
  <div style="background:#0b5;color:#fff;padding:10px 16px">RGHS <span style="float:right">Welcome TEST HOSPITAL</span></div>
  <div style="margin:14px"><h4>Payment Tracker</h4><table id="pay" class="display"><thead><tr>${H.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
  <script>${VENDOR}</script><script>$(function(){ $('#pay').DataTable({ pageLength: 5 }); });</script></body>`;
}
function hospediaPage() {
  const H = ['MR No', 'Patient Name', 'Date', 'Type', 'TID', 'Bill No', 'Item Name', 'Qty', 'Rate', 'Gross', 'Discount', 'Amount', 'Panel Name'];
  const R = [];
  PEOPLE.filter((p) => p.inHospedia).forEach((p) => p.items.forEach((it, j) => R.push([p.mr, p.name.toUpperCase(), '10/' + p.day + '/2026', it.type, p.tid, 'B' + p.i + j, it.item, 1, it.amount, it.amount, 0, it.amount, 'RGHS NEW'])));
  EXTRA_HOS.items.forEach((it) => R.push(['MR999', EXTRA_HOS.name, '10/2/2026', it.type, EXTRA_HOS.tid, 'BX', it.item, 1, it.amount, it.amount, 0, it.amount, 'RGHS NEW']));
  R.push(['MR1', 'X', '10/1/2026', 'REGISTRATION', '', 'B0', 'REGISTRATION CHARGES', 1, 0, 0, 0, 0, 'RGHS NEW']);
  return `<!doctype html><meta charset="utf-8"><title>Hospedia</title><body style="font:13px Arial;margin:0"><div style="background:#334;color:#fff;padding:10px">Hospedia · Reports</div>
  <table border="1" style="margin:12px;border-collapse:collapse"><thead><tr>${H.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
  <tbody>${R.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></body>`;
}
const otherPage = () => '<!doctype html><meta charset="utf-8"><body><div style="padding:10px">Welcome TEST HOSPITAL</div><p>Home</p></body>';

/* ---------- run ---------- */
(async () => {
  const res = [];
  const ok = (n, p, info = '') => { res.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${p ? '' : '  ' + String(info).slice(0, 600)}`); };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pj-suite-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: true, channel: 'chromium', acceptDownloads: true, viewport: { width: 1360, height: 820 }, deviceScaleFactor: SHOTS ? 2 : 1,
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`]
  });
  const errs = [];
  const watch = (p, name) => { p.on('pageerror', (e) => errs.push(name + ': ' + e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_|Failed to load resource/.test(m.text())) errs.push(name + ' console: ' + m.text()); }); };
  await ctx.route('https://rghs.rajasthan.gov.in/**', (route) => {
    const u = route.request().url();
    const mock = /\/__mock\/([\w.]+)$/.exec(new URL(u).pathname);
    if (mock) return route.fulfill({ path: path.join(ROOT, 'data', mock[1]) });
    const body = /tmsBisTrack/i.test(u) ? trackerPage() : /tmsPaymentTrack/i.test(u) ? paymentPage() : /tmsOPDDetails/i.test(u) ? fs.readFileSync(path.join(__dirname, 'mock-rghs.html'), 'utf8') : otherPage();
    route.fulfill({ body, contentType: 'text/html' });
  });
  await ctx.route('http://117.211.8.251/**', (route) => route.fulfill({ body: hospediaPage(), contentType: 'text/html' }));

  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  ok('S0 extension loaded (service worker running)', !!extId, sw.url());
  const storage = async (keys) => {
    const p = await ctx.newPage();
    await p.goto(`chrome-extension://${extId}/popup.html`);
    const v = await p.evaluate((k) => new Promise((r) => chrome.storage.local.get(k, r)), keys);
    await p.close();
    return v;
  };

  // 1) tracker page (tmsBisTrack1)
  const tr = await ctx.newPage(); watch(tr, 'tracker');
  await tr.goto('https://rghs.rajasthan.gov.in/RGHS/tmsBisTrack1');
  await tr.waitForFunction(() => document.querySelector('[data-pj-rghs="panel"]'), null, { timeout: 15000 });
  await tr.waitForTimeout(3500);
  const panelText = await tr.evaluate(() => document.querySelector('[data-pj-rghs="panel"]').shadowRoot.textContent);
  ok('S1 tracker panel shows all 29 rows (3 DataTable pages read)', /29 records/.test(panelText), panelText.slice(0, 300));
  ok('S1 panel shows "saved" for the daily sheet', /✓ 29 saved/.test(panelText), panelText.slice(0, 300));
  if (SHOTS) await tr.screenshot({ path: path.join(OUT, 's1-tracker.png') });
  let st = await storage(['r:2026-10', 'dataIndex']);
  const recs = st['r:2026-10'] || {};
  const p0 = PEOPLE[0], r0 = recs[p0.tid] || {};
  ok('S2 29 RGHS records saved in r:2026-10', Object.keys(recs).length === 29, Object.keys(recs).length);
  ok('S2 record has gender/age/card/date/amount', r0.gender === 'Female' && r0.age === 20 && r0.card === p0.card && r0.created === '2026-10-01' && r0.amount === p0.amount && r0.dept === 'OPD' && r0.claimMonth === 'October', JSON.stringify(r0));

  // 2) payment tracker
  const pay = await ctx.newPage(); watch(pay, 'payment');
  await pay.goto('https://rghs.rajasthan.gov.in/RGHS/tmsPaymentTrack');
  await pay.waitForFunction(() => { const h = document.querySelector('[data-pj-rghs="paycard"]'); return h && /Saved for the daily sheet/.test(h.shadowRoot.textContent); }, null, { timeout: 15000 });
  const payText = await pay.evaluate(() => document.querySelector('[data-pj-rghs="paycard"]').shadowRoot.textContent);
  const paidExpected = PEOPLE.slice(0, 12).reduce((s, p, k) => s + p.amount - (k === 3 ? 50 : 0), 0);
  ok('S3 payment card: 12 TIDs and paid total', /TIDs in table12/.test(payText) && payText.includes('₹' + paidExpected.toLocaleString('en-IN')), payText);
  if (SHOTS) await pay.screenshot({ path: path.join(OUT, 's3-payment.png') });

  // 3) Hospedia report saves itself
  const hos = await ctx.newPage(); watch(hos, 'hospedia');
  await hos.goto('http://117.211.8.251/hospedia/report');
  await hos.waitForFunction(() => { const h = document.getElementById('pj-hos'); return h && /saved for the daily sheet/.test(h.shadowRoot.textContent); }, null, { timeout: 15000 });
  st = await storage(['h:2026-10', 'p:2026-10']);
  const hsum = st['h:2026-10'] || {};
  ok('S4 Hospedia bills saved (27 + 1 extra TIDs)', Object.keys(hsum).length === 28, Object.keys(hsum).length);
  const h7 = hsum[PEOPLE[3].tid] || {};
  ok('S4 categories: CT SCAN DENTAL -> CBCT, CBC -> LAB, doctor', h7.cats && h7.cats.CBCT === 1466 && h7.cats.LAB === 126 && h7.cats.CONSULT === 350 && /MAHAVEER MALI/.test(h7.doctor), JSON.stringify(h7));
  ok('S4 payments saved (12)', Object.keys(st['p:2026-10'] || {}).length === 12, Object.keys(st['p:2026-10'] || {}).length);
  if (SHOTS) await hos.screenshot({ path: path.join(OUT, 's4-hospedia.png') });

  // 4) the daily sheet page
  const app = await ctx.newPage(); watch(app, 'app');
  await app.goto(`chrome-extension://${extId}/app/index.html`);
  await app.evaluate(() => { const m = document.getElementById('month'); m.value = '2026-10'; m.dispatchEvent(new Event('change')); });
  await app.waitForFunction(() => /27/.test(document.getElementById('kpis').textContent), null, { timeout: 10000 });
  const kp = await app.locator('#kpis').innerText();
  ok('S5 app KPIs: 27 OPD claimed TIDs, 1 DIFF row', /27/.test(kp) && /DIFF ROWS\s*1/i.test(kp), kp);
  const chk = await app.locator('#checks').innerText();
  ok('S5 checks list: no Hospedia bill + amount differs + not in RGHS', /No Hospedia bill/.test(chk) && /Amount differs/.test(chk) && /Not in RGHS/.test(chk), chk);
  await app.locator('.day[data-day="1"]').click();
  const dayTxt = await app.locator('#dayBox').innerText();
  ok('S5 day 1 table lists its patients', /Test Patient 1\b/.test(dayTxt) && /Test Patient 16/.test(dayTxt), dayTxt.slice(0, 200));
  if (SHOTS) await app.screenshot({ path: path.join(OUT, 's5-app.png'), fullPage: true });
  const [dl] = await Promise.all([app.waitForEvent('download'), app.locator('#dlMonth').click()]);
  const file = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(file);
  ok('S6 Excel file name like the hand-made one', dl.suggestedFilename() === 'RGHS_OCT_26_OPD.xlsx', dl.suggestedFilename());
  const wb = XLSX.read(fs.readFileSync(file));
  ok('S6 31 day sheets then Summary, Check, Payments', wb.SheetNames.length === 34 && wb.SheetNames[0] === '1' && wb.SheetNames[30] === '31' && wb.SheetNames.slice(31).join() === 'Summary,Check,Payments', wb.SheetNames.join());
  const s1 = XLSX.utils.sheet_to_json(wb.Sheets['1'], { header: 1, defval: '' });
  const s2 = XLSX.utils.sheet_to_json(wb.Sheets['2'], { header: 1, defval: '' });
  ok('S6 header row identical to the hand-made sheet', s1[0].join('|') === 'CLAIMSUBMISSIONYEAR|CLAIMSUBMISSIONMONTH|Patient Name|Gender|Age|RGHS Card No.|Transaction Id Created On|Transaction Id|Hospital Claim Amount|TREATING DOCTOR NAME|PANEL|DIFF|CONSULT|X RAY|CT SCAN|USG|CBCT|OPG|OCT|OTHERS|LAB', s1[0].join('|'));
  ok('S6 day 1 = 16 rows, day 2 = 11 rows (IPD + pending left out)', s1.length === 17 && s2.length === 12, s1.length + ' / ' + s2.length);
  // every cell against the synthetic truth
  let bad = 0; const msgs = [];
  const cat = (it) => /CT SCAN DENTAL/.test(it.item) ? 'CBCT' : /X-RAY/.test(it.item) ? 'X RAY' : /USG/.test(it.item) ? 'USG' : /OPG/.test(it.item) ? 'OPG' : it.type === 'APPOINTMENT' ? 'CONSULT' : it.type === 'LAB' ? 'LAB' : 'OTHERS';
  const COLS = s1[0];
  for (const p of PEOPLE.filter((x) => x.dept === 'OPD')) {
    const sheet = p.day === 1 ? s1 : s2;
    const row = sheet.find((r) => r[7] === p.tid);
    if (!row) { bad++; msgs.push('missing ' + p.tid); continue; }
    const want = { CLAIMSUBMISSIONYEAR: 2026, CLAIMSUBMISSIONMONTH: 'October', 'Patient Name': p.name, Gender: p.gender, Age: p.age, 'RGHS Card No.': p.card, 'Hospital Claim Amount': p.amount };
    const panel = p.inHospedia ? p.items.reduce((s, x) => s + x.amount, 0) : '';
    want.PANEL = panel;
    want.DIFF = p.inHospedia ? p.amount - panel : p.amount;
    for (const k of ['CONSULT', 'X RAY', 'CT SCAN', 'USG', 'CBCT', 'OPG', 'OCT', 'OTHERS']) { const v = p.inHospedia ? p.items.filter((x) => cat(x) === k).reduce((s, x) => s + x.amount, 0) : 0; want[k] = v || ''; }
    want.LAB = p.amount - ['CONSULT', 'X RAY', 'CT SCAN', 'USG', 'CBCT', 'OPG', 'OCT', 'OTHERS'].reduce((s, k) => s + (Number(want[k]) || 0), 0);
    want['TREATING DOCTOR NAME'] = p.inHospedia ? 'DR.' + p.doc.replace(/^DR /, '').replace(/\s*\(.*\)/, '') : '';
    for (const k of Object.keys(want)) { const got = row[COLS.indexOf(k)]; if (String(got) !== String(want[k])) { bad++; if (msgs.length < 8) msgs.push(p.tid + ' ' + k + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want[k])); } }
  }
  ok('S7 every cell of every row is correct (' + PEOPLE.length + ' TIDs x 18 columns)', bad === 0, msgs.join('; '));
  const ws1 = wb.Sheets['1'];
  ok('S7 DIFF and LAB are Excel formulas like the hand-made sheet', ws1.L2 && ws1.L2.f === '+I2-K2' && ws1.U2 && ws1.U2.f === '+I2-M2-N2-O2-P2-Q2-R2-S2-T2', JSON.stringify([ws1.L2, ws1.U2]));
  ok('S7 TID and Card No. stay text (no 2.0261E+15)', ws1.H2.t === 's' && ws1.F2.t === 's', JSON.stringify([ws1.H2, ws1.F2]));
  ok('S7 created-on is a real date shown dd-mm-yyyy', ws1.G2.t === 'n' && /01-10-2026/.test(XLSX.utils.format_cell(ws1.G2)), JSON.stringify(ws1.G2));
  const pays = XLSX.utils.sheet_to_json(wb.Sheets.Payments, { header: 1, defval: '' });
  ok('S7 Payments sheet: 12 rows, deduction row', pays.length === 13 && pays.some((r) => r[4] === 50 && r[7] === 'UTR777003'), JSON.stringify(pays.slice(0, 5)));

  // 5) pop-up + OPD page
  const pop = await ctx.newPage(); watch(pop, 'popup');
  await pop.setViewportSize({ width: 390, height: 600 });
  await pop.goto(`chrome-extension://${extId}/popup.html`);
  await pop.waitForTimeout(800);
  const popTxt = await pop.locator('body').innerText();
  ok('S8 pop-up shows daily sheet data and actions', /Daily sheet/.test(popTxt) && /OPD claim filler/i.test(popTxt) && /Payments/.test(popTxt), popTxt.slice(0, 200));
  if (SHOTS) await pop.screenshot({ path: path.join(OUT, 's8-popup.png'), fullPage: true });
  const opd = await ctx.newPage(); watch(opd, 'opd');
  await opd.goto('https://rghs.rajasthan.gov.in/RGHS/tmsOPDDetails');
  await opd.waitForFunction(() => document.getElementById('pj-auto-opd'), null, { timeout: 10000 });
  await opd.waitForTimeout(2000);
  const logoSvg = await opd.evaluate(() => !!document.getElementById('pj-auto-opd').shadowRoot.querySelector('.logo svg'));
  ok('S9 OPD claim panel loads with the PJ logo', logoSvg);
  const popupOnOpd = await opd.evaluate(() => !!document.querySelector('[data-pj-rghs="popup"]'));
  ok('S9 no status pop-up on top of the OPD panel', !popupOnOpd);
  if (SHOTS) await opd.screenshot({ path: path.join(OUT, 's9-opd.png') });

  ok('S10 no page or console errors anywhere', !errs.length, errs.join(' | '));
  console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
  await ctx.close();
  process.exit(res.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
