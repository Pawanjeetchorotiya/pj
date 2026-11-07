// Hospedia side: report table -> button -> background (engine) -> claim rows in storage.
// Usage: node tests/hospedia-e2e.js [--shots]
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.argv.includes('--shots');
const OUT = process.env.PJ_OUT || path.join(os.tmpdir(), 'pj-e2e');
fs.mkdirSync(OUT, { recursive: true });

const H = ['MR No', 'Patient Name', 'Date', 'Type', 'TID', 'Bill No', 'Item Name', 'Qty', 'Rate', 'Gross', 'Discount', 'Amount', 'Panel Name'];
const R = [
  ['MR1', 'BHANU PRATAP TANWAR', '10/30/2026', 'APPOINTMENT', '2026103013724771', 'B1', 'DR MAHAVEER MALI (Orthopedic)', '1', '350', '350', '0', '350', 'RGHS NEW'],
  ['MR1', 'BHANU PRATAP TANWAR', '10/30/2026', 'LAB', '2026103013724771', 'B2', 'BLOOD SUGAR RANDOM - 1444', '1', '28', '28', '0', '28', 'RGHS NEW'],
  ['MR1', 'BHANU PRATAP TANWAR', '10/30/2026', 'RADIOLOGY', '2026103013724771', 'B2', 'X-RAY KNEE AP/LAT - 1611', '1', '293', '293', '0', '293', 'RGHS NEW'],
  ['MR2', 'MOHAN SINGH', '10/30/2026', 'APPOINTMENT', '2026103013724774', 'B3', 'DR PRADEEP JAIN (Derma)', '1', '350', '350', '0', '350', 'RGHS NEW'],
  ['MR3', 'GITA', '10/30/2026', 'APPOINTMENT', '2026103013724775', 'B4', 'DR R C SINGHVI', '1', '350', '350', '0', '350', 'RGHS NEW'],
  ['MR3', 'GITA', '10/30/2026', 'RADIOLOGY', '2026103013724775', 'B4', 'CT SCAN HEAD PLAIN - 1637', '1', '1035', '1035', '0', '1035', 'RGHS NEW'],
  ['MR3', 'GITA', '10/30/2026', 'RADIOLOGY', '2026103013724775', 'B4', 'CT SCAN DENTAL - 1655', '1', '1466', '1466', '0', '1466', 'RGHS NEW'],
  ['MR4', 'NO TID PERSON', '10/30/2026', 'LAB', '', 'B5', 'CBC', '1', '100', '100', '0', '100', 'RGHS NEW'],
];
const PAGE = `<!doctype html><meta charset="utf-8"><title>Hospedia report (mock)</title>
<body style="font:13px Arial;margin:0"><div style="background:#334;color:#fff;padding:10px 16px">Hospedia · Reports · Panel Wise Invoice Summary (MOCK)</div>
<table border="1" cellspacing="0" cellpadding="3" style="margin:12px;border-collapse:collapse"><thead><tr>${H.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
<tbody>${R.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></body>`;

const SHIM = `
(() => {
  const K = '__pjstore';
  const read = () => JSON.parse(localStorage.getItem(K) || '{}');
  const get = (keys, cb) => { const all = read(); let out = {}; for (const k of [].concat(keys)) if (k in all) out[k] = all[k]; if (cb) setTimeout(() => cb(out)); return Promise.resolve(out); };
  const set = (o, cb) => { const all = read(); Object.assign(all, JSON.parse(JSON.stringify(o))); localStorage.setItem(K, JSON.stringify(all)); if (cb) setTimeout(cb); return Promise.resolve(); };
  const bg = [], cs = [];
  window.__bgMode = true;
  window.chrome = { storage: { local: { get, set }, onChanged: { addListener() {} } },
    runtime: { id: 'test', lastError: null, getURL: (p) => '/__ext/' + p, onInstalled: { addListener() {} }, onStartup: { addListener() {} },
      onMessage: { addListener: (f) => (window.__bgMode ? bg : cs).push(f) },
      sendMessage: (m, cb) => { let done = false; for (const f of bg) { const r = f(m, {}, (x) => { done = true; cb && cb(x); }); if (r === true || done) return; } } },
    action: { onClicked: { addListener() {} }, setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {}, setIcon: async () => {} },
    notifications: { onClicked: { addListener() {} }, create: async () => {} }, tabs: {}, windows: {} };
  window.importScripts = () => {};
})();`;

(async () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 760 }, deviceScaleFactor: SHOTS ? 2 : 1 });
  await ctx.route('http://117.211.8.251/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/__ext/')) return route.fulfill({ path: path.join(ROOT, u.pathname.slice(7)) });
    return route.fulfill({ body: PAGE, contentType: 'text/html' });
  });
  await ctx.addInitScript(SHIM);
  await ctx.addInitScript(`addEventListener('load', () => { (0, eval)(${JSON.stringify(read('shared.js'))}); (0, eval)(${JSON.stringify(read('engine.js'))}); (0, eval)(${JSON.stringify(read('sheet.js'))}); (0, eval)(${JSON.stringify(read('background.js'))}); window.__bgMode = false; (0, eval)(${JSON.stringify(read('hospedia.js'))}); });`);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://117.211.8.251/hospedia/report');
  await page.locator('#pj-hos button.btn').click();
  await page.locator('#pj-hos .card.on').waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  if (SHOTS) await page.screenshot({ path: path.join(OUT, '6-hospedia.png') });
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('__pjstore') || '{}'));
  const rows = st.pjRows || [];
  const res = [];
  const ok = (n, p, i = '') => { res.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${p ? '' : '  ' + i}`); };
  const by = (t) => rows.find((r) => r.tid === t) || {};
  ok('H1 three claims made (row without TID left out)', rows.length === 3, rows.map((r) => r.tid).join());
  ok('H2 codes 1A,1444,1611 + doctor + RMC', by('2026103013724771').packages?.join() === '1A,1444,1611' && by('2026103013724771').rmcNo === '17569', JSON.stringify(by('2026103013724771')));
  ok('H3 prescription date D-M-Y', by('2026103013724771').prescDate === '30-10-2026', by('2026103013724771').prescDate);
  const d = by('2026103013724774');
  ok('H4 Any Other doctor -> real speciality text', /any other/i.test(d.speciality) && d.otherSpeciality === 'Dermatology' && d.docSpeciality === 'Dermatology', JSON.stringify(d));
  ok('H5 two CT -> PRE-AUTH', /CT/.test(by('2026103013724775').preAuth || ''), by('2026103013724775').preAuth);
  ok('H6 summary card shows counts', /3\s*claims made/.test(await page.locator('#pj-hos .card').innerText()), await page.locator('#pj-hos .card').innerText());
  const hs = st['h:2026-10'] || {};
  ok('H8 daily sheet: Hospedia bills saved with breakdown', Object.keys(hs).length === 3 && hs['2026103013724775'].cats.CBCT === 1466 && hs['2026103013724775'].cats['CT SCAN'] === 1035, JSON.stringify(hs['2026103013724775']));
  ok('H7 no page errors', !errs.length, errs.join('; '));
  console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
  await browser.close();
  process.exit(res.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
