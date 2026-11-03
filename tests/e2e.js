// End-to-end test: runs content.js on a mock of the RGHS OPD page (tests/mock-rghs.html).
// Usage: node tests/e2e.js [--shots]      (needs Playwright + Chromium)
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const URL = 'https://rghs.rajasthan.gov.in/RGHS/tmsOPDDetails';
const SHOTS = process.argv.includes('--shots');
const OUT = process.env.PJ_OUT || path.join(os.tmpdir(), 'pj-e2e');
fs.mkdirSync(OUT, { recursive: true });

const XLSX = require(path.join(ROOT, 'lib/xlsx.full.min.js'));

// ---- fixtures ----
const TIDS = { good: '2026103013724771', badCode: '2026103013724772', paed: '2026102914401495', badDoc: '2026103013724773', other: '2026103013724774' };
function makeSheet(file) {
  const H = ['TID', 'Patient Name', 'Speciality', 'Doctor', 'RMC No', 'RMC Type', 'Doctor Speciality', 'Package Codes', 'Prescription Date', 'Validity Days', 'Chief Complaints', 'Diagnosis', 'Bill Amount', 'Discount'];
  const rows = [
    [TIDS.good, 'BHANU PRATAP TANWAR', 'Orthopaedics', 'DR MAHAVEER MALI', '17569', 'PG', '', '1A; 1611; 1444', '30-10-2026', '15', 'Knee pain', 'OA knee', 671, 0],
    [TIDS.badCode, 'RAM LAL', 'Orthopaedics', 'DR MAHAVEER MALI', '17569', 'PG', '', '1A; 9999; 1444', '30-10-2026', '15', 'Knee pain', 'OA knee', 500, 0],
    [TIDS.paed, 'TANISHKA', 'PAEDIATRICS', 'DR R C SINGHVI', '2217', 'PG', '', '1A', '29-10-2026', '15', 'Fever', 'Viral fever', 135, 0],
    [TIDS.badDoc, 'SITA DEVI', 'Orthopaedics', 'DR NOBODY HERE', '17569', 'PG', '', '1A; 1444', '30-10-2026', '15', 'Pain', 'Myalgia', 300, 0],
    [TIDS.other, 'MOHAN SINGH', 'Any Other Speciality not mentioned above', 'DR PRADEEP JAIN', '3208', 'PG', 'Dermatology', '1A', '30-10-2026', '15', 'Itching', 'Eczema', 135, 0],
  ];
  const ws = XLSX.utils.aoa_to_sheet([H, ...rows]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'OPD Claims');
  fs.writeFileSync(file, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
function makeScans(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const pdf = '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n';
  const names = [`${TIDS.good}_slip.pdf`, `${TIDS.good}_lab.pdf`, `${TIDS.good}_bill.pdf`, 'TANSHIKA SLIP.pdf', 'TANSHIKA BILL.pdf', 'unrelated_person_bill.pdf'];
  for (const n of names) fs.writeFileSync(path.join(dir, n), pdf);
  return names.map((n) => path.join(dir, n));
}

// chrome.* shim backed by localStorage (survives the portal's page reloads)
const SHIM = `
(() => {
  const K = '__pjstore';
  const read = () => JSON.parse(localStorage.getItem(K) || '{}');
  const write = (o) => localStorage.setItem(K, JSON.stringify(o));
  const listeners = [];
  const get = (keys, cb) => {
    const all = read(); let out = {};
    if (keys == null) out = all;
    else for (const k of [].concat(keys)) if (k in all) out[k] = all[k];
    out = JSON.parse(JSON.stringify(out));
    if (cb) setTimeout(() => cb(out)); return Promise.resolve(out);
  };
  const set = (obj, cb) => { const all = read(); Object.assign(all, JSON.parse(JSON.stringify(obj))); write(all); if (cb) setTimeout(cb); return Promise.resolve(); };
  window.chrome = window.chrome || {};
  window.chrome.storage = { local: { get, set }, onChanged: { addListener() {} } };
  window.chrome.runtime = { onMessage: { addListener: (f) => listeners.push(f) }, sendMessage() {}, getURL: (p) => '/__ext/' + p, lastError: null };
  window.__pjSend = (m) => listeners.forEach((f) => f(m, {}, () => {}));
  try { delete window.showDirectoryPicker; window.showDirectoryPicker = undefined; } catch (e) {}
  window.__pageErrors = [];
  addEventListener('error', (e) => window.__pageErrors.push(String(e.message)));
})();`;

async function main() {
  const sheet = path.join(OUT, 'claims.xlsx'); makeSheet(sheet);
  const scans = makeScans(path.join(OUT, 'scans'));
  const lib = fs.readFileSync(path.join(ROOT, 'lib/xlsx.full.min.js'), 'utf8');
  const content = fs.readFileSync(path.join(ROOT, 'engine.js'), 'utf8') + '\n;' + fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: SHOTS ? 2 : 1, acceptDownloads: true });
  await ctx.route('https://rghs.rajasthan.gov.in/**', (route) => {
    const u = new globalThis.URL(route.request().url());
    if (u.pathname.startsWith('/__mock/')) return route.fulfill({ path: path.join(ROOT, 'data', path.basename(u.pathname)) });
    if (u.pathname.startsWith('/__ext/')) return route.fulfill({ path: path.join(ROOT, u.pathname.slice(7)) });
    return route.fulfill({ path: path.join(__dirname, 'mock-rghs.html'), contentType: 'text/html' });
  });
  await ctx.addInitScript(SHIM);
  // the content scripts, run at document idle like Chrome does
  await ctx.addInitScript(`addEventListener('load', () => { (0, eval)(${JSON.stringify(lib)}); (0, eval)(${JSON.stringify(content)}); });`);

  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message, (e.stack || '').split('\n').slice(0, 4).join(' | ')));
  await page.goto(URL);
  await page.waitForSelector('#pj-auto-opd', { state: 'attached' });
  await page.waitForTimeout(500);
  if (SHOTS) await page.screenshot({ path: path.join(OUT, '0-empty.png') });

  await page.locator('#pj-auto-opd input.fs').setInputFiles(sheet);
  await page.locator('#pj-auto-opd input.fd').setInputFiles(path.join(OUT, 'scans'));
  await page.waitForTimeout(1500);
  if (SHOTS) {
    await page.screenshot({ path: path.join(OUT, '1-loaded.png') });
    await page.locator('#pj-auto-opd [aria-label="Type text for ' + TIDS.paed + '"]').click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, '1b-editor.png') });
    await page.locator('#pj-auto-opd [data-a=close]').click();
  }

  const res = [];
  const ok = (n, pass, info = '') => { res.push({ n, pass: !!pass, info }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${pass ? '' : '  ' + info}`); };
  const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('__pjstore') || '{}')).catch(() => ({}));
  const form = () => page.evaluate(() => {
    const v = (id) => document.getElementById(id)?.value ?? '';
    const st = (id) => { const e = document.getElementById(id); return e && e.selectedOptions[0] ? e.selectedOptions[0].text : ''; };
    return {
      tid: v('transid'), spec: st('opddepartment'), other: v('opddepttext'), doc: st('empaneledDocName'), rmc: v('rmcno'), q: v('rmcqual'), tdn: v('opddocname'), dsp: v('opddocspaciality'),
      pk: [...document.querySelectorAll('#packageDetailtable tbody tr')].map((r) => r.cells[0].innerText),
      amt: v('amounttoclaim'), pd: v('prescriptiondate'), val: v('prescriptionvalidity'), cc: v('chiefDiagnosis'), dg: v('diagnosis'),
      bill: v('invoiceAmount'), disc: v('discount'), dec: document.getElementById('checkboxGenStmt').checked,
      files: ['doctorprescription', 'invastigationreport', 'finalbillreport', 'diagnosisreport'].map((x) => v(x + 'path')),
      saved: window.__mock.saved, reloads: window.__mock.reloads, errors: window.__pageErrors,
    };
  }).catch(() => null);
  async function fill(tid) {
    await page.waitForSelector('#pj-auto-opd', { state: 'attached' });
    const nb = page.locator(`#pj-auto-opd [data-fill="${tid}"]`);
    if (await nb.count()) await nb.first().click();
    else await page.locator('#pj-auto-opd tr', { hasText: tid }).locator('button', { hasText: /^(Fill|Redo)$/ }).click();
    const end = Date.now() + 90000;
    let s;
    while (Date.now() < end) {
      await page.waitForTimeout(500);
      s = (await store()).pjStatus?.[tid]?.s;
      if (['Ready', 'Check', 'Error'].includes(s)) break;
    }
    await page.waitForTimeout(400);
    return s;
  }
  const fresh = async () => {   // a new TID starts on a clean page, like the real portal after submission
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(URL); await page.waitForSelector('#pj-auto-opd', { state: 'attached' }); await page.waitForTimeout(800);
  };

  // T1 - the good claim
  let s = await fill(TIDS.good); let f = await form();
  ok('T1 status Ready', s === 'Ready', s + ' ' + JSON.stringify((await store()).pjStatus?.[TIDS.good]));
  ok('T1 speciality/doctor/RMC verified', f.spec === 'Orthopaedics' && f.doc === 'DR MAHAVEER MALI' && f.tdn === 'DR MAHAVEER MALI', JSON.stringify(f));
  ok('T1 packages 1A,1611,1444', f.pk.join() === '1A,1611,1444', f.pk.join());
  ok('T1 prescription+bill+tick', f.pd === '30-10-2026' && f.val === '15' && f.cc === 'Knee pain' && f.dg === 'OA knee' && f.bill === '671' && f.dec, JSON.stringify(f));
  ok('T1 uploads presc/inv/bill', /_slip/.test(f.files[0]) && /_lab/.test(f.files[1]) && /_bill/.test(f.files[2]), f.files.join('|'));
  ok('T1 never pressed save/final', f.saved === '', f.saved);
  ok('T1 resumed after page reload', f.reloads >= 1 && f.tid === TIDS.good, `reloads=${f.reloads}`);
  if (SHOTS) await page.screenshot({ path: path.join(OUT, '2-filled.png') });
  // T7 - user presses FINAL; the tool marks Done
  await page.evaluate(() => confirmSave('2'));
  await page.waitForTimeout(2000);
  ok('T7 marked Done after user submits', (await store()).pjStatus?.[TIDS.good]?.s === 'Done', JSON.stringify((await store()).pjStatus?.[TIDS.good]));
  if (SHOTS) await page.screenshot({ path: path.join(OUT, '3-done.png') });
  ok('T1 no page errors', !(f.errors || []).length, (f.errors || []).join('; '));

  // T2 - a bad package code must not stop the rest
  await fresh();
  s = await fill(TIDS.badCode); f = await form();
  ok('T2 other codes still added (1A,1444)', f.pk.join() === '1A,1444', f.pk.join() + ' | ' + s);
  ok('T2 rest of form still filled', f.pd === '30-10-2026' && f.cc === 'Knee pain' && f.bill === '500', JSON.stringify(f));
  ok('T2 bad code 9999 reported', s === 'Check' && /9999/.test((await store()).pjStatus?.[TIDS.badCode]?.msg || ''), s);

  // T3 - Hospedia-style speciality name
  await fresh();
  s = await fill(TIDS.paed); f = await form();
  ok('T3 PAEDIATRICS -> Paediatric Medicine', f.spec === 'Paediatric Medicine' && f.tdn === 'DR R C SINGHVI', s + ' ' + JSON.stringify(f));
  ok('T4 files matched by patient name', /TANSHIKA SLIP/.test(f.files[0]) && /TANSHIKA BILL/.test(f.files[2]), f.files.join('|') + ' ' + s);
  if (SHOTS) await page.screenshot({ path: path.join(OUT, '4-paed.png') });

  // T5 - doctor not in list: rest of the form is still filled, user is told
  await fresh();
  s = await fill(TIDS.badDoc); f = await form();
  ok('T5 doctor missing -> rest still filled', f.pk.join() === '1A,1444' && f.cc === 'Pain' && f.bill === '300', s + ' ' + JSON.stringify(f));
  ok('T5 doctor problem reported', ['Check', 'Error'].includes(s) && /NOBODY/i.test((await store()).pjStatus?.[TIDS.badDoc]?.msg || ''), s);

  // T6 - Any Other speciality gets the free-text speciality
  await fresh();
  s = await fill(TIDS.other); f = await form();
  ok('T6 Any Other -> other speciality text', /Any Other/.test(f.spec) && f.other === 'Dermatology', JSON.stringify(f));
  if (SHOTS) {
    await page.screenshot({ path: path.join(OUT, '5-final.png') });
  }

  // T8 - claim register export (monthly), columns in the asked order
  await page.locator('#pj-auto-opd [data-a=more]').click();
  await page.locator('#pj-auto-opd [data-a=export]').click();
  await page.locator('#pj-auto-opd .seg [data-k=month]').click();
  await page.locator('#pj-auto-opd .exm').fill('2026-10');
  await page.waitForTimeout(500);
  if (SHOTS) await page.screenshot({ path: path.join(OUT, '7-export.png') });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#pj-auto-opd [data-a=exgo]').click()]);
  const xf = path.join(OUT, dl.suggestedFilename()); await dl.saveAs(xf);
  const wb = XLSX.read(fs.readFileSync(xf), { type: 'buffer' });
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets.Register, { header: 1, defval: '' });
  const H = aoa[0].join('|');
  ok('T8 register headers in order (Month ... Lab last)', H === 'Month|Year|Patient Name|Age|RGHS Card No|TID|TID Creation Date|Treating Doctor|Hospital Claim Amount (RGHS)|Hospedia Billing Amount|Difference (Hospedia - Claim)|Consult|X-Ray|CT|USG|CBCT|OPG|OCT|Other|Lab', H);
  const g = aoa.find((r) => String(r[5]) === TIDS.good) || [];
  ok('T8 good TID row: Oct 2026, age, card, TID date, doctor', g[0] === 'October' && g[1] === 2026 && g[2] === 'BHANU PRATAP TANWAR' && String(g[3]) === '34' && g[4] === 'RJ1234567890' && g[6] === '28-10-2026' && g[7] === 'DR MAHAVEER MALI', JSON.stringify(g));
  ok('T8 claim 671 / Hospedia 671 / diff 0 / consult 350 xray 293 lab 28', g[8] === 671 && g[9] === 671 && g[10] === 0 && g[11] === 350 && g[12] === 293 && g[19] === 28, JSON.stringify(g.slice(8)));
  ok('T8 five claims + total row + Day wise sheet', aoa.length === 7 && /TOTAL \(5 claims\)/.test(aoa[6][2]) && !!wb.Sheets['Day wise'], `${aoa.length} ${aoa[aoa.length - 1][2]} ${wb.SheetNames}`);
  // daily export of a day with nothing in it is blocked
  await page.locator('#pj-auto-opd .seg [data-k=day]').click();
  await page.locator('#pj-auto-opd .exd').fill('2026-10-29');
  await page.waitForTimeout(400);
  ok('T8 empty day -> download disabled', await page.locator('#pj-auto-opd [data-a=exgo]').isDisabled(), '');

  const pass = res.filter((r) => r.pass).length;
  console.log(`\n${pass}/${res.length} passed`);
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ pass, total: res.length, res }, null, 1));
  await browser.close();
  process.exit(pass === res.length ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
