// Unit test for sheet.js (daily sheet logic). No browser needed: node tests/sheet-test.js
// Optional: PJ_REAL_SHEET=/path/RGHS_OCT_26_OPD.xlsx also round-trips a real hand-made month sheet
// (read it -> build the month again -> every cell must come back the same). The real file is never committed.
const fs = require('fs');
const X = require('../lib/xlsx.full.min.js');
const DS = require('../sheet.js');
const res = [];
const ok = (n, p, i = '') => { res.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${p ? '' : '  ' + String(i).slice(0, 400)}`); };

ok('U1 dates: India D-M-Y, Hospedia M/D/Y, ISO, Excel serial, 15-Oct-2026',
  DS.toISO('01-10-2026') === '2026-10-01' && DS.toISO('10/1/2026', false) === '2026-10-01' && DS.toISO('2026-10-05') === '2026-10-05' &&
  DS.toISO(46296) === '2026-10-01' && DS.toISO('15-Oct-2026') === '2026-10-15' && DS.toISO('13/10/2026', false) === '2026-10-13');
ok('U2 TID date + bucket', DS.tidDate('2026100111464595') === '2026-10-01' && DS.bucketOf('202610011035165') === '2026-10');
const cat = (i, t) => DS.categorize(i, t);
ok('U3 categories', cat('DR X (Ortho)', 'APPOINTMENT') === 'CONSULT' && cat('CT SCAN DENTAL - 1655', 'RADIOLOGY') === 'CBCT' &&
  cat('CBCT MANDIBLE', '') === 'CBCT' && cat('OPG - 1660', 'RADIOLOGY') === 'OPG' && cat('OCT MACULA', '') === 'OCT' &&
  cat('CT SCAN HEAD PLAIN - 1637', 'RADIOLOGY') === 'CT SCAN' && cat('USG WHOLE ABDOMEN', 'RADIOLOGY') === 'USG' &&
  cat('X-RAY CHEST PA', 'RADIOLOGY') === 'X RAY' && cat('CBC - 1400', 'LAB') === 'LAB' && cat('ECG', 'PROCEDURE') === 'OTHERS' &&
  cat('SERUM CREATININE', '') === 'LAB', [cat('CBCT MANDIBLE', ''), cat('ECG', 'PROCEDURE')].join());
ok('U4 doctor style DR.NAME', DS.sheetDoctor('DR MAHAVEER MALI') === 'DR.MAHAVEER MALI' && DS.sheetDoctor('Dr. B C Karnawat') === 'DR.B C KARNAWAT');
ok('U5 PANEL "=1826+350" read as 2176', DS.evalPlus('=1826+350') === 2176 && DS.evalPlus(350) === 350);
const H = ['Transaction Id', 'Patient Name', 'Gender', 'Age', 'RGHS Card No.', 'Department', 'Transaction Id Created On', 'Hospital Claim Amount', 'Transaction Id Status'];
const recs = DS.recordsFromTracker(H, [
  ['2026100110000001', 'A One', 'F', '30', '9900001', 'OPD', '01-10-2026', '350', 'Claim submitted'],
  ['2026100110000002', 'B Two', 'Male', '40', '9900002', 'OPD', '01-10-2026', '0', 'Claim to be submitted by hospital'],
  ['No data available in table', '', '', '', '', '', '', '', '']]);
ok('U6 tracker rows -> records (junk row skipped, gender normalised)', recs.length === 2 && recs[0].gender === 'Female' && recs[0].age === 30 && recs[0].created === '2026-10-01', JSON.stringify(recs));
const items = [
  { mr: 'M1', patient: 'A ONE', date: '10/1/2026', type: 'APPOINTMENT', tid: '2026100110000001', item: 'DR MAHAVEER MALI (Ortho)', amount: 350 },
  { mr: 'M1', patient: 'A ONE', date: '10/1/2026', type: 'REGISTRATION', tid: '2026100110000001', item: 'REGISTRATION', amount: 0 }];
const hos = DS.hospediaSummary(items);
const b = DS.buildMonth({ month: '2026-10', records: recs, hospedia: hos });
ok('U7 month: claimed only by default, doctor from Hospedia', b.rows.length === 1 && b.rows[0].doctor === 'DR.MAHAVEER MALI' && b.rows[0].diff === 0 && b.rows[0].lab === 0, JSON.stringify(b.rows[0]));
const b2 = DS.buildMonth({ month: '2026-10', records: recs, hospedia: hos, includePending: true });
ok('U8 pending TIDs on request + flagged', b2.rows.length === 2 && b2.checks.some((c) => c.kind === 'Not claimed yet'));
const wb = DS.monthWorkbook(X, b);
ok('U9 workbook: 31 day sheets + Summary + Check', wb.SheetNames.length === 33 && wb.Sheets['1'].H2.v === '2026100110000001' && wb.Sheets['1'].L2.f === '+I2-K2');
const mem = new Map(); const kv = { get: async (k) => mem.get(k), set: async (k, v) => { mem.set(k, v); } };
(async () => {
  const s = DS.makeStore(kv);
  await s.saveRecords(recs);
  await s.saveRecords([{ tid: '2026100110000001', name: '', amount: 350, gender: '' }]); // empty values never wipe
  await s.saveHospedia(hos);
  const m = await s.loadMonth('2026-10');
  ok('U10 store: merge keeps known values, index counts', m.records['2026100110000001'].name === 'A One' && (await s.index())['2026-10'].r === 2 && Object.keys(m.hospedia).length === 1);
  const pays = DS.paymentsFromTable(['S.No.', 'TID', 'Paid Amount', 'UTR No', 'Payment Date'], [['1', '2026100110000001', '350', 'UTR1', '15-10-2026']]);
  ok('U11 payments parsed', DS.paymentFields(pays['2026100110000001']).paid === 350 && DS.paymentFields(pays['2026100110000001']).utr === 'UTR1');
  const real = process.env.PJ_REAL_SHEET;
  if (real && fs.existsSync(real)) {
    const src = X.read(fs.readFileSync(real), { cellDates: true });
    let records = [], hospedia = {};
    for (const n of src.SheetNames) { const r = DS.readDailySheet(X.utils.sheet_to_json(src.Sheets[n], { header: 1, defval: '', raw: true })); if (r) { records = records.concat(r.records); Object.assign(hospedia, r.hospedia); } }
    const month = records[0].created.slice(0, 7);
    const back = X.read(X.write(DS.monthWorkbook(X, DS.buildMonth({ month, records, hospedia })), { type: 'buffer', bookType: 'xlsx' }));
    let cells = 0, bad = 0; const why = [];
    const norm = (v) => String(v).replace(/\s+/g, ' ').trim();
    for (const n of src.SheetNames) {
      const a = X.utils.sheet_to_json(src.Sheets[n], { header: 1, defval: '', raw: false });
      const m2 = new Map(X.utils.sheet_to_json(back.Sheets[n], { header: 1, defval: '', raw: false }).slice(1).map((r) => [r[7], r]));
      for (const r of a.slice(1)) {
        if (!r[7]) continue;
        const o = m2.get(r[7]);
        if (!o) { bad++; why.push('missing ' + r[7]); continue; }
        for (const c of [0, 1, 2, 3, 4, 5, 8, 9, 12, 13, 14, 15, 16, 17, 18, 19]) { cells++; if (norm(r[c]) !== norm(o[c])) { bad++; if (why.length < 5) why.push(n + ' ' + r[7] + ' col ' + c); } }
      }
    }
    ok('U12 real month sheet round-trip: ' + cells + ' cells', bad === 0, why.join('; '));
  }
  console.log(`\n${res.filter(Boolean).length}/${res.length} passed`);
  process.exit(res.every(Boolean) ? 0 : 1);
})();
