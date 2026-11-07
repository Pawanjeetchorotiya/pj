// Mobile app test: serves the repo over http, opens app/index.html at phone size (no extension),
// imports a synthetic RGHS tracker Excel + Hospedia report Excel + payment Excel, checks the screen and the downloaded month Excel.
// Usage: node tests/mobile-e2e.js [--shots]
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { chromium, devices } = require('playwright');
const XLSX = require('../lib/xlsx.full.min.js');
const ROOT = path.join(__dirname, '..');
const SHOTS = process.argv.includes('--shots');
const OUT = process.env.PJ_OUT || path.join(os.tmpdir(), 'pj-e2e');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = http.createServer((q, r) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
});
const book = (name, aoa) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1'); const p = path.join(OUT, name); fs.writeFileSync(p, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })); return p; };
const T = ['2026100510112233', '2026100511223344', '2026100612334455'];
const tracker = book('m-tracker.xlsx', [['Transaction Id', 'Patient Name', 'Gender', 'Age', 'RGHS Card No.', 'Department', 'Transaction Id Created On', 'Hospital Claim Amount', 'Transaction Id Status'],
  [T[0], 'Mobile One', 'Female', 41, '12345678901', 'OPD', '05-10-2026', 643, 'Submitted'], [T[1], 'Mobile Two', 'Male', 52, '12345678902', 'OPD', '05-10-2026', 350, 'Submitted'],
  [T[2], 'Mobile Three', 'Male', 63, '12345678903', 'OPD', '06-10-2026', 910, 'Submitted']]);
const hosp = book('m-hospedia.xlsx', [['MR No', 'Patient Name', 'Date', 'Type', 'TID', 'Bill No', 'Item Name', 'Qty', 'Rate', 'Gross', 'Discount', 'Amount'],
  ['M1', 'MOBILE ONE', '10/5/2026', 'APPOINTMENT', T[0], 'B1', 'DR B C KARNAWAT', 1, 350, 350, 0, 350], ['M1', 'MOBILE ONE', '10/5/2026', 'RADIOLOGY', T[0], 'B1', 'X-RAY CHEST PA - 1600', 1, 293, 293, 0, 293],
  ['M2', 'MOBILE TWO', '10/5/2026', 'APPOINTMENT', T[1], 'B2', 'DR DILIP TAK', 1, 350, 350, 0, 350],
  ['M3', 'MOBILE THREE', '10/6/2026', 'APPOINTMENT', T[2], 'B3', 'DR R C SINGHVI', 1, 350, 350, 0, 350], ['M3', 'MOBILE THREE', '10/6/2026', 'RADIOLOGY', T[2], 'B3', 'USG ABDOMEN', 1, 560, 560, 0, 560]]);
const pay = book('m-payment.xlsx', [['TID', 'Paid Amount', 'UTR No', 'Payment Date'], [T[0], 643, 'UTRM1', '20-10-2026']]);
(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const res = []; const ok = (n, p, i = '') => { res.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${p ? '' : '  ' + String(i).slice(0, 400)}`); };
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(base + '/app/index.html');
  await page.waitForSelector('#kpis .kpi');
  ok('M1 mobile mode detected', /Mobile app/.test(await page.locator('#mode').innerText()));
  await page.setInputFiles('#file', [tracker, hosp, pay]);
  await page.waitForFunction(() => /Imported/.test(document.getElementById('toast').textContent), null, { timeout: 10000 });
  const toast = await page.locator('#toast').innerText();
  ok('M2 import message counts all three files', /3 RGHS TIDs/.test(toast) && /3 Hospedia TIDs/.test(toast) && /1 payments/.test(toast), toast);
  await page.waitForFunction(() => /October 2026/i.test(document.getElementById('kpis').textContent));
  const kp = await page.locator('#kpis').innerText();
  ok('M3 jumped to October, 3 TIDs, 100% matched, paid', /\b3\b/.test(kp) && /100%/.test(kp) && /643/.test(kp), kp);
  await page.locator('.day[data-day="5"]').click();
  const cards = await page.locator('.cards').innerText();
  ok('M4 phone shows cards for day 5', /Mobile One/.test(cards) && /X RAY 293/.test(cards) && /Mobile Two/.test(cards), cards);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('M4 no sideways scrolling on the phone', over <= 0, over + 'px too wide');
  if (SHOTS) { await page.screenshot({ path: path.join(OUT, 'm-phone.png') }); await page.screenshot({ path: path.join(OUT, 'm-phone-full.png'), fullPage: true }); }
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#dlMonth').click()]);
  const f = path.join(OUT, 'm-' + dl.suggestedFilename()); await dl.saveAs(f);
  const wb = XLSX.read(fs.readFileSync(f));
  const d5 = XLSX.utils.sheet_to_json(wb.Sheets['5'], { header: 1, defval: '' });
  const r = d5.find((x) => x[7] === T[0]) || [];
  ok('M5 downloaded Excel row correct', r[2] === 'Mobile One' && r[8] === 643 && r[9] === 'DR.B C KARNAWAT' && r[10] === 643 && r[12] === 350 && r[13] === 293 && r[20] === 0, JSON.stringify(r));
  await page.reload(); await page.waitForSelector('#kpis .kpi');
  await page.evaluate(() => { const m = document.getElementById('month'); m.value = '2026-10'; m.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(500);
  ok('M6 data still there after reload (saved on the phone)', /100%/.test(await page.locator('#kpis').innerText()));
  ok('M7 no errors', !errs.length, errs.join(' | '));
  console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
  await browser.close(); server.close();
  process.exit(res.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
