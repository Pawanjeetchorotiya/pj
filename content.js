/* PJ Auto OPD Claim - content script for RGHS "OPD TID Details - Treatment & Claim Submission".
 * It fills the form from an Excel/CSV row and the scan folder, then STOPS.
 * It never presses SAVE or FINAL CLAIM SUBMISSION. The user checks and submits.
 */
(() => {
  if (window.__pjAutoOpd) return;
  window.__pjAutoOpd = true;

  // ---------- small helpers ----------
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normDoc = (s) => norm(s).replace(/^dr/, '');
  // The portal reloads the page on Search, so the scan folder is kept in IndexedDB:
  // "meta" holds the folder itself (so new scans are picked up on their own),
  // "scans" holds copies of the PDFs, used when the browser cannot keep a folder.
  const ScanDB = (() => {
    let dbp = null;
    const db = () => (dbp = dbp || new Promise((res, rej) => {
      const r = indexedDB.open('pj-auto-opd', 2);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('scans')) d.createObjectStore('scans', { keyPath: 'name' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
      };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const tx = async (name, mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(name, mode); const out = fn(t.objectStore(name)); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); }); };
    return {
      all: () => tx('scans', 'readonly', (o) => o.getAll()),
      put: (list) => tx('scans', 'readwrite', (o) => { for (const f of list) o.put(f); }),
      clear: () => tx('scans', 'readwrite', (o) => o.clear()),
      getMeta: (key) => tx('meta', 'readonly', (o) => o.get(key)),
      setMeta: (key, value) => tx('meta', 'readwrite', (o) => o.put({ key, value })),
      delMeta: (key) => tx('meta', 'readwrite', (o) => o.delete(key)),
    };
  })();
  const store = {
    get: (k) => new Promise((r) => chrome.storage.local.get(k, (v) => r(v[k]))),
    set: (k, v) => new Promise((r) => chrome.storage.local.set({ [k]: v }, r)),
  };

  async function waitFor(fn, ms = 15000, step = 250) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try { const v = fn(); if (v) return v; } catch (e) { /* keep waiting */ }
      await sleep(step);
    }
    return null;
  }
  function fire(el, ...types) {
    for (const t of types) el.dispatchEvent(new Event(t, { bubbles: true }));
  }
  function need(id) {
    const el = $(id);
    if (!el) throw new Error(`Field "${id}" not found on the page. The portal may have changed.`);
    return el;
  }
  function setVal(id, v) {
    const el = need(id);
    el.focus();
    el.value = v;
    fire(el, 'input', 'change', 'keyup', 'blur');
  }
  function setSelect(id, wanted, { byValue = false } = {}) {
    const el = need(id);
    const opts = [...el.options];
    let o;
    if (byValue) o = opts.find((x) => x.value === String(wanted));
    if (!o) o = opts.find((x) => norm(x.text) === norm(wanted));
    if (!o && id === 'empaneledDocName') o = opts.find((x) => normDoc(x.text) === normDoc(wanted));
    if (!o) o = opts.find((x) => norm(wanted) && norm(x.text).includes(norm(wanted)));
    if (!o) throw new Error(`"${wanted}" is not in the ${label(id)} list.`);
    el.value = o.value;
    fire(el, 'change');
    return o.text.trim();
  }
  // Hospedia / everyday names -> the words in the portal's Speciality list
  const SPEC_ALIAS = {
    paediatrics: 'Paediatric Medicine', pediatrics: 'Paediatric Medicine', paediatric: 'Paediatric Medicine', child: 'Paediatric Medicine',
    orthopaedics: 'Orthopaedics', orthopedics: 'Orthopaedics', ortho: 'Orthopaedics',
    'obstetricsgynaecology': 'Obstetrics and Gynaecology', obsgynae: 'Obstetrics and Gynaecology', gynae: 'Obstetrics and Gynaecology', obg: 'Obstetrics and Gynaecology',
    medicine: 'General Medicine', generalmedicine: 'General Medicine', physician: 'General Medicine',
    surgery: 'General Surgery', generalsurgery: 'General Surgery',
    eye: 'Ophthalmology', ophthal: 'Ophthalmology', ophthalmology: 'Ophthalmology',
    dental: 'Dental', dentistry: 'Dental', dentalsurgery: 'Dental',
    ent: 'ENT', otolaryngology: 'ENT', otorhinolaryngology: 'ENT',
    physiotherapy: 'Physical Medicine and Rehabilitation', physio: 'Physical Medicine and Rehabilitation', rehabilitation: 'Physical Medicine and Rehabilitation',
    nephrology: 'Nephrology', urology: 'Urology', cardiology: 'Cardiology', oncology: 'Oncology', gastroenterology: 'Gastroenterology',
  };
  const OTHER_RE = /anyother|notmentioned/;
  // Returns the <option> text to choose, or '' when only "Any Other Speciality" fits.
  function pickSpeciality(wanted) {
    const el = need('opddepartment');
    const opts = [...el.options].filter((o) => o.value);
    const w = norm(wanted);
    if (!w) return '';
    let o = opts.find((x) => norm(x.text) === w);
    if (!o && SPEC_ALIAS[w]) o = opts.find((x) => norm(x.text) === norm(SPEC_ALIAS[w]));
    if (!o) o = opts.find((x) => !OTHER_RE.test(norm(x.text)) && (norm(x.text).includes(w) || w.includes(norm(x.text))));
    if (!o) {   // every word of the portal option appears in what we want (or the other way round)
      const ww = String(wanted).toLowerCase().split(/[^a-z]+/).filter((x) => x.length > 3);
      o = opts.find((x) => { if (OTHER_RE.test(norm(x.text))) return false; const t = x.text.toLowerCase(); return ww.length && ww.every((y) => t.includes(y.slice(0, 6))); });
    }
    return o ? o.text : '';
  }
  const label = (id) => ({
    opddepartment: 'Speciality', empaneledDocName: 'Doctor', rmcqual: 'RMC Type',
    prescriptionvalidity: 'Validity', packagesearch: 'Search Package by', idType: 'Search by',
  }[id] || id);
  function buttonByOnclick(part, root = document) {
    return [...root.querySelectorAll('button,input[type=button]')]
      .find((b) => (b.getAttribute('onclick') || '').replace(/\s/g, '').startsWith(part));
  }
  function modalOpen(id) {
    const m = $(id);
    if (!m) return false;
    const cs = getComputedStyle(m);
    return m.classList.contains('show') || (cs.display !== 'none' && cs.visibility !== 'hidden' && m.offsetHeight > 0);
  }
  function modalText(id) {
    const m = $(id);
    const body = m && (m.querySelector('.modal-body') || m);
    return body ? body.innerText.replace(/\s+/g, ' ').trim() : '';
  }
  async function closeModal(id) {
    const m = $(id);
    if (!m || !modalOpen(id)) return;
    const btn = [...m.querySelectorAll('button')].find((b) => /^(ok|close|×)$/i.test(b.innerText.trim()))
      || m.querySelector('[data-dismiss=modal],[data-bs-dismiss=modal]');
    if (btn) btn.click();
    await waitFor(() => !modalOpen(id), 3000, 100);
  }
  // Collect and close any message pop-ups shown by the portal.
  async function popups() {
    const msgs = [];
    for (const id of ['msgModal', 'saveModal', 'successModal']) {
      if (modalOpen(id)) { msgs.push(modalText(id)); await closeModal(id); }
    }
    return msgs.filter(Boolean);
  }

  // ---------- data from Excel / CSV ----------
  const COLS = {
    tid: ['tid', 'transactionid', 'transactionno'],
    speciality: ['speciality', 'specialty', 'treatmentspeciality', 'department'],
    otherSpeciality: ['otherspeciality'],
    doctor: ['doctor', 'doctorname', 'empaneleddoctor', 'empaneleddoctorname'],
    rmcNo: ['rmcno', 'rmcnumber', 'rmc'],
    rmcType: ['rmctype', 'rmcregistrationtype'],
    docSpeciality: ['doctorspeciality', 'specialityofdoctor', 'doctorspecialty'],
    packages: ['packagecodes', 'packagecode', 'packages', 'tests'],
    prescDate: ['prescriptiondate', 'date', 'opddate'],
    validity: ['validitydays', 'validity', 'prescriptionvalidity'],
    complaints: ['chiefcomplaints', 'complaints', 'chiefcomplaint'],
    diagnosis: ['diagnosis'],
    bill: ['billamount', 'invoiceamount', 'finalbill', 'bill'],
    discount: ['discount', 'discountamount'],
    matchKey: ['matchkey', 'uhid', 'opdno', 'filekey'],
    patient: ['patientname', 'patient', 'name'],
    fPresc: ['prescriptionfile', 'opdslipfile', 'slipfile'],
    fInvest: ['investigationfile', 'labreportfile', 'reportfile'],
    fBill: ['billfile'],
    fDiag: ['diagnosisfile', 'diagnosisreportfile'],
  };
  function toDate(v) {
    if (v instanceof Date && !isNaN(v)) {
      return `${String(v.getDate()).padStart(2, '0')}-${String(v.getMonth() + 1).padStart(2, '0')}-${v.getFullYear()}`;
    }
    const s = String(v ?? '').trim();
    let m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (m) return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}-${m[3]}`;
    m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return `${m[3].padStart(2, '0')}-${m[2].padStart(2, '0')}-${m[1]}`;
    return s;
  }
  function parseSheet(buf, name) {
    const wb = XLSX.read(buf, { type: 'array', cellDates: true, raw: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
    const rows = [];
    for (const r of raw) {
      const keyed = {};
      for (const [k, v] of Object.entries(r)) keyed[norm(k)] = v;
      const o = {};
      for (const [field, names] of Object.entries(COLS)) {
        const k = names.find((n) => keyed[n] !== undefined && keyed[n] !== '');
        o[field] = k ? keyed[k] : '';
      }
      o.tid = String(o.tid).replace(/\s/g, '').replace(/\.0+$/, '');
      if (!/^\d{10,}$/.test(o.tid)) continue; // skip blank / bad rows
      o.prescDate = o.prescDate ? toDate(o.prescDate) : '';
      o.packages = String(o.packages).split(/[;,|\n]+/).map((x) => x.trim()).filter(Boolean);
      for (const f of ['speciality', 'otherSpeciality', 'doctor', 'rmcNo', 'rmcType', 'docSpeciality', 'complaints', 'diagnosis', 'matchKey', 'patient', 'fPresc', 'fInvest', 'fBill', 'fDiag']) {
        o[f] = String(o[f]).trim();
      }
      o.validity = String(o.validity).match(/\d+/)?.[0] || '';
      o.bill = String(o.bill).replace(/[^\d.]/g, '');
      o.discount = String(o.discount).replace(/[^\d.]/g, '');
      rows.push(o);
    }
    if (!rows.length) throw new Error(`No rows with a valid TID found in ${name}. Check the "TID" column.`);
    return rows;
  }

  // ---------- scan folder ----------
  let scanFiles = []; // [{name, file}]
  const UPLOAD_SLOTS = [
    { id: 'doctorprescription', col: 'fPresc', title: 'Prescription / OPD slip', re: /presc|\bpre\b|slip|parchi|\bopd\b|\brx\b/i },
    { id: 'invastigationreport', col: 'fInvest', title: 'Investigation / lab report', re: /\blab\b|invest|report|\btest\b|path/i },
    { id: 'finalbillreport', col: 'fBill', title: 'Final bill', re: /bill|invoice|receipt/i },
    { id: 'diagnosisreport', col: 'fDiag', title: 'Diagnosis report', re: /diag|xray|x-ray|usg|ecg|ct|mri/i },
  ];
  const STOP_NAME = /^(mr|mrs|ms|miss|master|baby|smt|shri|sh|dr|b|o)$/;
  const nameTokens = (s) => String(s || '').toLowerCase().split(/[^a-z]+/).filter((x) => x.length > 2 && !STOP_NAME.test(x));
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 9;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 0; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  // a scanned file name and the portal name of the same person often differ by a letter or two
  const tokenHit = (t, list) => list.some((x) => x === t || (t.length > 4 && x.length > 4 && lev(t, x) <= (Math.min(t.length, x.length) >= 7 ? 2 : 1)));
  // words that name the kind of document, not the person
  const DOC_WORDS = /^(pre|presc|prescription|slip|opd|rx|parchi|bill|bills|invoice|receipt|lab|labs|report|reports|inv|invest|investigation|test|tests|path|xray|ray|usg|sono|ct|mri|ecg|echo|diag|diagnosis|scan|scanned|doc|docs|file|page|copy|final|new)$/;
  // Does this file name carry the patient's name?
  //  - every word of the name is in the file name (a letter or two may differ: TANSHIKA = TANISHKA)
  //  - or the name is written joined up (BHANUPRATAPTANWAR_BILL)
  //  - a one-word name (HETANSH) must be the whole name part of the file
  function fileIsPatient(fileName, patient) {
    const want = nameTokens(patient);
    if (!want.length) return false;
    const have = nameTokens(fileName.replace(/\.[a-z0-9]+$/i, '')).filter((t) => !DOC_WORDS.test(t));
    if (!have.length) return false;
    if (want.length === 1) return want[0].length >= 4 && have.length === 1 && tokenHit(want[0], have);
    if (want.every((t) => tokenHit(t, have))) return true;
    const a = want.join(''), b = have.join('');
    return a.length >= 8 && (a === b || lev(a, b) <= 2);
  }
  function filesForRow(row) {
    const ok = scanFiles.filter((f) => /\.(pdf|zip)$/i.test(f.name));
    const out = {};
    const used = new Set();
    for (const s of UPLOAD_SLOTS) {
      const want = row[s.col];
      if (want) {
        const f = ok.find((x) => x.name.toLowerCase() === want.toLowerCase())
          || ok.find((x) => x.name.toLowerCase().replace(/\.(pdf|zip)$/, '') === want.toLowerCase());
        if (f) { out[s.id] = f; used.add(f); }
      }
    }
    const keys = [row.tid, row.matchKey].filter(Boolean).map((k) => String(k).toLowerCase());
    const cands = ok.filter((f) => !used.has(f) && (keys.some((k) => f.name.toLowerCase().includes(k)) || fileIsPatient(f.name, row.patient)));
    const strip = (n) => { let x = ' ' + n + ' '; for (const k of keys) x = x.split(new RegExp(k, 'ig')).join(' '); for (const t of nameTokens(row.patient)) x = x.split(new RegExp(t.slice(0, Math.max(4, t.length - 1)), 'ig')).join(' '); return x.replace(/[^a-zA-Z0-9]+/g, ' '); };
    for (const s of UPLOAD_SLOTS) {
      if (out[s.id]) continue;
      const f = cands.find((x) => !used.has(x) && s.re.test(strip(x.name)));
      if (f) { out[s.id] = f; used.add(f); }
    }
    const left = cands.filter((x) => !used.has(x));
    if (!out.doctorprescription && left.length === 1 && !Object.keys(out).length) out.doctorprescription = left[0];
    return out;
  }

  // ---------- the form filling steps ----------
  async function searchTid(row, log) {
    const idType = $('idType');
    if (idType) { try { setSelect('idType', 'Transaction'); } catch (e) { /* keep default */ } }
    if ($('transid')?.value === row.tid && $('opddepartment')) {
      log('TID already open on the page.');
      return;
    }
    setVal('transactionid', row.tid);
    const btn = buttonByOnclick('Search(');
    if (!btn) throw new Error('SEARCH button not found.');
    await store.set('pjPending', { tid: row.tid, at: Date.now() }); // in case the page reloads
    btn.click();
    const ok = await waitFor(() => ($('transid')?.value === row.tid) || modalOpen('msgModal'), 20000);
    await store.set('pjPending', null);
    if (modalOpen('msgModal')) {
      const m = modalText('msgModal'); await closeModal('msgModal');
      if ($('transid')?.value !== row.tid) throw new Error(`Portal says: ${m}`);
    }
    if (!ok || $('transid')?.value !== row.tid) throw new Error('TID did not load. Check the TID number.');
    await sleep(600);
    log('TID loaded.');
  }

  async function fillDoctor(row, log, memory) {
    if (row.speciality) {
      const want = pickSpeciality(row.speciality);
      if (want) {
        const t = setSelect('opddepartment', want);
        log(`Speciality: ${t}` + (norm(t) === norm(row.speciality) ? '' : ` (for "${row.speciality}")`));
      } else {
        const other = [...need('opddepartment').options].find((o) => OTHER_RE.test(norm(o.text)));
        if (!other) throw new Error(`"${row.speciality}" is not in the Speciality list.`);
        setSelect('opddepartment', other.text);
        log(`Speciality: ${other.text} (for "${row.speciality}")`);
      }
      await sleep(600);
      const otherText = row.otherSpeciality || (want ? '' : row.speciality);
      if (otherText && $('opddepttext') && !$('opddepttext').classList.contains('hide')) setVal('opddepttext', otherText);
    }
    if (row.doctor) {
      await waitFor(() => $('empaneledDocName')?.options.length > 1, 8000);
      const t = setSelect('empaneledDocName', row.doctor);
      log(`Doctor: ${t}`);
      await sleep(500);
    }
    const docKey = normDoc(row.doctor);
    const rmc = row.rmcNo || memory.rmc?.[docKey]?.no || '';
    const rmcType = row.rmcType || memory.rmc?.[docKey]?.type || '';
    if (rmc) {
      if ($('rmcno').value !== rmc) setVal('rmcno', rmc);
      if (rmcType) setSelect('rmcqual', rmcType.toUpperCase(), { byValue: true });
      const v = buttonByOnclick('varifyRmc(');
      if (v && !$('opddocname').value) {
        v.click();
        await waitFor(() => $('opddocname').value || modalOpen('msgModal'), 15000);
        const m = await popups();
        if (!$('opddocname').value) throw new Error(`RMC not verified. ${m.join(' ')}`.trim());
      }
      log(`RMC verified: ${$('opddocname').value}`);
      if (docKey && row.rmcNo) {
        memory.rmc = memory.rmc || {};
        memory.rmc[docKey] = { no: row.rmcNo, type: rmcType };
        await store.set('pjMemory', memory);
      }
    } else if (!$('opddocname').value) {
      log('! No RMC number for this doctor. Fill RMC and press VERIFY yourself.');
    }
    if (row.docSpeciality && $('opddocspaciality') && !$('opddocspaciality').disabled) {
      setVal('opddocspaciality', row.docSpeciality);
    }
  }

  const addedCodes = () => [...document.querySelectorAll('#packageDetailtable tbody tr')]
    .map((tr) => tr.cells[0]?.innerText.trim().toLowerCase()).filter(Boolean);

  async function addPackages(row, log) {
    const failed = [];
    for (const code of row.packages) {
      try {
      if (addedCodes().includes(code.toLowerCase())) { log(`Package ${code} already added.`); continue; }
      setSelect('packagesearch', '0', { byValue: true });
      await sleep(300);
      setVal('pkgcode', code);
      const btn = buttonByOnclick('SearchPackage(');
      if (!btn) throw new Error('Package SEARCH button not found.');
      btn.click();
      const got = await waitFor(() => {
        if (modalOpen('msgModal')) return 'msg';
        const rows = [...document.querySelectorAll('#searchpackagedetailtable tbody tr')].filter((tr) => tr.cells.length > 2);
        return modalOpen('addPackageModal') && rows.length ? rows : null;
      }, 15000);
      if (!got || got === 'msg') {
        const m = await popups();
        throw new Error(`Package ${code} not found. ${m.join(' ')}`.trim());
      }
      const tr = got.find((r) => [...r.cells].some((c) => c.innerText.trim().toLowerCase() === code.toLowerCase()));
      if (!tr) {
        await closeModal('addPackageModal');
        const x = document.querySelector('#addPackageModal .close, #addPackageModal [onclick*="CloseaddPackageModal"]'); if (x) x.click();
        throw new Error(`Package ${code} not in search result.`);
      }
      const pick = tr.querySelector('input[type=checkbox],input[type=radio]');
      if (pick && !pick.checked) pick.click();
      const add = buttonByOnclick('addPackageDiv(');
      if (!add) throw new Error('"Add Package" button not found.');
      add.click();
      await waitFor(() => addedCodes().includes(code.toLowerCase()) || modalOpen('msgModal'), 10000);
      const m = await popups();
      if (!addedCodes().includes(code.toLowerCase())) throw new Error(`Package ${code} was not added. ${m.join(' ')}`.trim());
      log(`Package added: ${code} (${tr.cells[2]?.innerText.trim() || ''})`);
      } catch (e) {
        failed.push(`${code}: ${e.message}`);
        log(`! ${e.message} - carrying on with the other codes.`);
        for (const id of ['addPackageModal', 'msgModal']) { if (modalOpen(id)) await closeModal(id); }
        const x = document.querySelector('#addPackageModal .close, #addPackageModal [onclick*="CloseaddPackageModal"]');
        if (x && modalOpen('addPackageModal')) x.click();
        await sleep(300);
      }
      await sleep(400);
    }
    return failed;
  }

  async function fillPrescription(row, log) {
    if (row.prescDate) { setVal('prescriptiondate', row.prescDate); log(`Prescription date: ${row.prescDate}`); }
    if (row.validity) { setSelect('prescriptionvalidity', row.validity, { byValue: true }); }
    if (row.complaints) setVal('chiefDiagnosis', row.complaints.slice(0, 250));
    else log('! Chief complaints are empty - type them in the panel or on the portal.');
    if (row.diagnosis) setVal('diagnosis', row.diagnosis.slice(0, 250));
    else log('! Diagnosis is empty - type it in the panel or on the portal.');
    if (row.bill) setVal('invoiceAmount', row.bill);
    if (row.discount) setVal('discount', row.discount);
    await sleep(300);
    const c = $('checkboxGenStmt');
    if (c && !c.checked) c.click();
    log('Prescription and bill details filled.');
  }

  async function uploadFiles(row, log) {
    if (dirHandle) await readFolder(true);   // pick up anything scanned since the folder was chosen
    if (folderState === 'locked') { log('! Scan folder needs permission again - press "Reconnect folder".'); return; }
    if (!scanFiles.length) { log('! Scan folder not chosen. Upload documents yourself.'); return { none: 'Scan folder not chosen - upload the documents yourself.' }; }
    const map = filesForRow(row);
    if (!Object.keys(map).length) { log(`! No PDF found in scan folder for TID ${row.tid}. Upload yourself.`); return { none: `No scanned file found for ${row.patient || row.tid} - upload the documents yourself.` }; }
    for (const s of UPLOAD_SLOTS) {
      const f = map[s.id];
      if (!f) continue;
      const input = $(s.id);
      if (!input) continue;
      const pathEl = $(s.id + 'path');
      if (pathEl && pathEl.value) { log(`${s.title}: already uploaded.`); continue; }
      const file = f.file || (await f.handle.getFile());
      const dt = new DataTransfer();
      dt.items.add(new File([file], file.name, { type: file.type || 'application/pdf' }));
      input.files = dt.files;
      fire(input, 'change');
      await waitFor(() => (pathEl && pathEl.value) || modalOpen('msgModal'), 30000);
      const m = await popups();
      if (pathEl && !pathEl.value) log(`! ${s.title} upload failed: ${m.join(' ')}`);
      else log(`${s.title} uploaded: ${f.name}`);
      await sleep(500);
    }
    const needInv = (row.packages || []).some((c) => !/^1a?$/i.test(String(c).trim()));   // only consultation -> no report needed
    const missing = UPLOAD_SLOTS.filter((s) => (s.id === 'doctorprescription' || s.id === 'finalbillreport' || (s.id === 'invastigationreport' && needInv)) && $(s.id) && !($(s.id + 'path') && $(s.id + 'path').value)).map((s) => s.title);
    return missing.length ? { none: 'Not uploaded: ' + missing.join(', ') + ' - check the scan folder or upload yourself.' } : {};
  }

  function checks(row) {
    const warn = [];
    const total = parseFloat(String($('amounttoclaim')?.value || '0').replace(/[^\d.]/g, '')) || 0;
    const trs = [...document.querySelectorAll('#packageDetailtable tbody tr')];
    const names = trs.map((tr) => tr.innerText);
    const bigScans = names.filter((n) => /\b(ct|mri|doppler)\b/i.test(n)).length;
    // RGHS counts the investigations, not the consultation
    const invTotal = trs.filter((tr) => !/consultation/i.test(tr.cells[1]?.innerText || ''))
      .reduce((a, tr) => a + (parseFloat(String(tr.cells[2]?.innerText || '').replace(/[^\d.]/g, '')) || 0), 0);
    if (invTotal > 2000) warn.push(`Investigations come to Rs ${invTotal} (above Rs 2000). Pre-Authorization is needed.`);
    if (bigScans > 1) warn.push('More than one CT / MRI / Doppler. Pre-Authorization is needed.');
    if (row.bill && total && parseFloat(row.bill) < total) warn.push(`Bill amount (${row.bill}) is less than package total (${total}).`);
    if (!$('opddocname')?.value) warn.push('Doctor RMC is not verified.');
    if (!row.complaints) warn.push('Chief complaints are empty.');
    if (!row.diagnosis) warn.push('Diagnosis is empty.');
    return { total, warn };
  }

  function highlightSubmit() {
    const b = buttonByOnclick("confirmSave('2')");
    if (!b) return;
    b.style.outline = '4px solid #f59e0b';
    b.style.outlineOffset = '3px';
    b.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ---------- panel UI ----------
  const host = document.createElement('div');
  host.id = 'pj-auto-opd';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
  <style>
    :host{all:initial}
    .p{position:fixed;right:16px;bottom:16px;width:380px;max-height:78vh;display:flex;flex-direction:column;z-index:2147483646;
      font:13px/1.4 "Segoe UI",system-ui,sans-serif;color:#0f172a;background:rgba(255,255,255,.82);backdrop-filter:blur(14px);
      -webkit-backdrop-filter:blur(14px);border:1px solid rgba(148,163,184,.45);border-radius:16px;box-shadow:0 12px 40px rgba(15,23,42,.25);overflow:hidden}
    .hd{display:flex;align-items:center;gap:8px;padding:10px 12px;background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;cursor:move;user-select:none}
    .logo{width:26px;height:26px;border-radius:8px;background:#fff;color:#4f46e5;font-weight:800;display:grid;place-items:center;font-size:12px}
    .hd b{flex:1;font-size:14px}
    .hd button{background:rgba(255,255,255,.2);border:0;color:#fff;border-radius:6px;width:24px;height:24px;cursor:pointer;font-size:14px}
    .bd{padding:10px 12px;overflow:auto;display:flex;flex-direction:column;gap:8px}
    .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
    .btn{border:0;border-radius:8px;padding:6px 10px;font-weight:600;cursor:pointer;background:#e2e8f0;color:#0f172a;font-size:12px}
    .btn.pri{background:#4f46e5;color:#fff}.btn.go{background:#16a34a;color:#fff}
    .btn:disabled{opacity:.5;cursor:default}
    .muted{color:#475569;font-size:12px}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th,td{padding:4px 6px;border-bottom:1px solid #e2e8f0;text-align:left}
    tr.cur td{background:#eef2ff}
    .st{font-weight:600}.st.Done{color:#16a34a}.st.Error{color:#dc2626}.st.Ready{color:#16a34a}.st.Check{color:#d97706}.st.Filling{color:#4f46e5}
    .pt{font-size:11px;color:#475569}
    .ed{background:#fff;border:1px solid #c7d2fe;border-radius:8px;padding:8px;display:none;flex-direction:column;gap:6px}
    .ed.on{display:flex}
    .ed textarea{width:100%;min-height:38px;font:12px/1.4 inherit;border:1px solid #cbd5e1;border-radius:6px;padding:4px 6px;resize:vertical}
    .ed .lbl{font-size:11px;color:#475569;font-weight:600}
    .ed select{font:11px inherit;border:1px solid #cbd5e1;border-radius:6px;padding:3px 4px;width:100%}
    .tbl{max-height:180px;overflow:auto;border:1px solid #e2e8f0;border-radius:8px;background:#fff}
    .log{background:#0f172a;color:#e2e8f0;border-radius:8px;padding:6px 8px;font:11px/1.45 Consolas,monospace;max-height:150px;overflow:auto;white-space:pre-wrap}
    .warn{background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:6px 8px;font-size:12px}
    .warn:empty{display:none}
    .min .bd{display:none}.min{width:220px}
    input[type=file]{display:none}
    .vw{position:fixed;left:16px;top:60px;width:620px;height:76vh;min-width:320px;min-height:240px;display:none;flex-direction:column;z-index:2147483645;
      background:#fff;border:1px solid rgba(148,163,184,.6);border-radius:14px;box-shadow:0 12px 40px rgba(15,23,42,.3);overflow:hidden;resize:both}
    .vw.on{display:flex}
    .vw .vh{display:flex;align-items:center;gap:8px;padding:8px 10px;background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;cursor:move;user-select:none}
    .vw .vh b{flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .vw .vh button{background:rgba(255,255,255,.2);border:0;color:#fff;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:12px}
    .vw embed,.vw iframe{flex:1;width:100%;border:0;background:#525659}
    .docs .btn.sel{background:#4f46e5;color:#fff}
  </style>
  <div class="vw">
    <div class="vh"><b class="vn">Scanned document</b><button class="vx">Close</button></div>
    <embed class="vf" type="application/pdf">
  </div>
  <div class="p">
    <div class="hd"><span class="logo">PJ</span><b>Auto OPD Claim</b><button class="mn" title="Minimise">–</button></div>
    <div class="bd">
      <div class="row">
        <button class="btn pri" data-a="hospedia">Load from Hospedia</button>
        <button class="btn" data-a="sheet">Load Excel / CSV</button>
        <button class="btn" data-a="folder">Choose scan folder</button>
        <input type="file" class="fs" accept=".xlsx,.xls,.csv">
        <input type="file" class="fd" webkitdirectory multiple>
      </div>
      <div class="muted info">No sheet loaded.</div>
      <div class="tbl"><table><thead><tr><th>TID / Patient</th><th>Pkgs</th><th>Status</th><th></th></tr></thead><tbody></tbody></table></div>
      <div class="ed">
        <div class="row docs"></div>
        <div><span class="lbl">Chief complaints</span><textarea class="ecc" maxlength="250"></textarea>
          <select class="qcc"><option value="">Quick pick...</option></select></div>
        <div><span class="lbl">Diagnosis</span><textarea class="edg" maxlength="250"></textarea>
          <select class="qdg"><option value="">Quick pick...</option></select></div>
        <div class="row"><button class="btn pri" data-a="save">Save &amp; next</button><button class="btn" data-a="saveonly">Save</button><button class="btn" data-a="close">Close</button>
          <span class="muted etid"></span></div>
      </div>
      <div class="row">
        <button class="btn pri" data-a="next">Fill next TID</button>
        <button class="btn" data-a="text">Type text for all ✎</button>
        <button class="btn" data-a="clear">Clear list</button>
      </div>
      <div class="warn"></div>
      <div class="log"></div>
      <div class="muted">The tool only fills the form. Check everything, then press <b>FINAL CLAIM SUBMISSION</b> yourself.</div>
    </div>
  </div>`;
  document.documentElement.appendChild(host);
  const q = (s) => root.querySelector(s);
  const panel = q('.p');

  let rows = [];
  let status = {}; // tid -> {s, msg}
  let memory = {};
  let busy = false;
  let currentTid = null;

  const logEl = q('.log');
  function log(msg) {
    const t = new Date().toLocaleTimeString('en-IN', { hour12: false });
    logEl.textContent += `${t}  ${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }
  function info() {
    const done = rows.filter((r) => status[r.tid]?.s === 'Done').length;
    const fol = folderState === 'locked' ? `"${folderName}" - press Reconnect folder`
      : folderName ? `"${folderName}" · ${pdfCount()} PDF/ZIP`
        : scanFiles.length ? `${pdfCount()} PDF/ZIP files (copied in)` : 'not chosen';
    q('.info').textContent = (rows.length ? `${rows.length} TIDs · ${done} done · ` : 'No claims loaded · ') + 'Scan folder: ' + fol;
    const b = q('[data-a=folder]');
    if (b) b.textContent = folderState === 'locked' ? 'Reconnect folder' : folderName ? 'Change scan folder' : 'Choose scan folder';
  }
  function render() {
    const tb = q('tbody');
    tb.innerHTML = '';
    for (const r of rows) {
      const st = status[r.tid]?.s || 'Waiting';
      const tr = document.createElement('tr');
      if (r.tid === currentTid) tr.className = 'cur';
      const txt = !r.complaints || !r.diagnosis ? ' ✎' : '';
      tr.innerHTML = `<td>${r.tid}<div class="pt">${(r.patient || '').replace(/</g, '')}</div></td><td>${r.packages.length}</td>`
        + `<td class="st ${st}" title="${(status[r.tid]?.msg || '').replace(/"/g, '&quot;')}">${st}${txt}</td><td></td>`;
      const e = document.createElement('button');
      e.className = 'btn'; e.textContent = '✎'; e.title = 'See the scanned slip and type chief complaints / diagnosis';
      e.onclick = () => openEditor(r);
      const b = document.createElement('button');
      b.className = 'btn'; b.textContent = st === 'Done' ? 'Redo' : 'Fill';
      b.disabled = busy;
      b.onclick = () => fillRow(r);
      tr.lastChild.appendChild(e); tr.lastChild.appendChild(b);
      tb.appendChild(tr);
    }
    root.querySelectorAll('[data-a]').forEach((b) => { if (['next'].includes(b.dataset.a)) b.disabled = busy; });
    info();
  }
  async function setStatus(tid, s, msg = '') {
    status[tid] = { s, msg, at: Date.now() };
    await store.set('pjStatus', status);
    render();
  }

  async function fillRow(row) {
    if (busy) return;
    busy = true; currentTid = row.tid;
    q('.warn').textContent = '';
    await store.set('pjCurrent', row.tid);
    await setStatus(row.tid, 'Filling');
    log(`--- TID ${row.tid}${row.patient ? ' - ' + row.patient : ''} ---`);
    try {
      await popups();
      await searchTid(row, log);
      await fillDoctor(row, log, memory);
      const failed = await addPackages(row, log);
      await fillPrescription(row, log);
      const up = (await uploadFiles(row, log)) || {};
      const c = checks(row);
      if (up.none) c.warn.push(up.none);
      if (failed.length) c.warn.unshift(`These package codes were NOT added: ${failed.join(' | ')}. Add them on the portal yourself, or leave them out.`);
      if (row.preAuth) c.warn.unshift(`PRE-AUTH: ${row.preAuth}`);
      for (const n of (row.notes || []).slice(0, 4)) c.warn.push(n);
      log(`Claim amount as per packages: Rs ${c.total}`);
      q('.warn').textContent = c.warn.map((w) => '⚠ ' + w).join('\n');
      await setStatus(row.tid, c.warn.length ? 'Check' : 'Ready', c.warn.join(' '));
      highlightSubmit();
      log('Done. Check the form and press FINAL CLAIM SUBMISSION.');
    } catch (e) {
      log('ERROR: ' + e.message);
      await setStatus(row.tid, 'Error', e.message);
    } finally {
      busy = false;
      render();
    }
  }

  // Mark Done when the portal shows its success pop-up after a submission.
  setInterval(async () => {
    if (!currentTid || !['Ready', 'Check'].includes(status[currentTid]?.s)) return;
    if (modalOpen('successModal')) {
      const t = modalText('successModal');
      if (/success|submitted/i.test(t)) {
        log(`Submitted: ${currentTid}`);
        await setStatus(currentTid, 'Done', t);
      }
    }
  }, 1000);

  // Buttons
  q('.mn').onclick = async () => {
    panel.classList.toggle('min');
    await store.set('pjMin', panel.classList.contains('min'));
  };
  q('[data-a=sheet]').onclick = () => q('.fs').click();
  // The folder itself is remembered, so new scans are picked up without choosing it again.
  let dirHandle = null, folderName = '', folderState = 'none';   // none | ready | locked
  q('[data-a=folder]').onclick = async () => {
    if (folderState === 'locked') return reconnectFolder();
    if (window.showDirectoryPicker) {
      try {
        const dir = await window.showDirectoryPicker({ id: 'pj-scan', mode: 'read' });
        dirHandle = dir; folderName = dir.name;
        try { await ScanDB.setMeta('dir', dir); } catch (e) { log('! This browser will not remember the folder: ' + e.message); }
        await store.set('pjFolderName', folderName);
        await readFolder();
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
        log('! Could not open the folder: ' + e.message);
      }
    }
    q('.fd').click();   // older browsers: copy the files in instead
  };
  async function reconnectFolder() {
    if (!dirHandle) return;
    try {
      const p = dirHandle.requestPermission ? await dirHandle.requestPermission({ mode: 'read' }) : 'granted';
      if (p !== 'granted') { log('! Folder permission not given. Press "Scan folder" again.'); return; }
      await readFolder();
    } catch (e) { log('! Could not reconnect the folder: ' + e.message); }
  }
  // Read the folder again: picks up files scanned after the folder was chosen.
  async function readFolder(silent) {
    if (!dirHandle) return false;
    try {
      const perm = dirHandle.queryPermission ? await dirHandle.queryPermission({ mode: 'read' }) : 'granted';
      if (perm !== 'granted') {
        folderState = 'locked'; info();
        if (!silent) log(`Folder "${folderName}" needs permission again. Press "Reconnect folder".`);
        return false;
      }
      const found = [];
      await walk(dirHandle, 0, found);
      scanFiles = found;
      folderState = 'ready';
      try { await ScanDB.clear(); } catch (e) { /* not needed when a folder is used */ }
      info();
      if (!silent) log(`Scan folder "${folderName}": ${pdfCount()} PDF/ZIP files.`);
      return true;
    } catch (e) {
      folderState = 'locked'; info();
      if (!silent) log('! Could not read the folder: ' + e.message);
      return false;
    }
  }
  const pdfCount = () => scanFiles.filter((f) => /\.(pdf|zip)$/i.test(f.name)).length;
  async function walk(dir, depth, out) {
    for await (const [name, h] of dir.entries()) {
      if (out.length > 8000) return;
      if (h.kind === 'file') { if (/\.(pdf|zip)$/i.test(name)) out.push({ name, handle: h }); }
      else if (depth < 3) await walk(h, depth + 1, out);
    }
  }
  async function keepScans(list) {   // keep the PDFs so the portal's page reloads do not lose them
    scanFiles = list;
    try {
      const pdfs = list.filter((f) => /\.(pdf|zip)$/i.test(f.name));
      const saved = [];
      for (const f of pdfs.slice(0, 400)) {
        const file = f.file || (f.handle && await f.handle.getFile());
        if (file) saved.push({ name: f.name, blob: new Blob([await file.arrayBuffer()], { type: file.type || 'application/pdf' }) });
      }
      await ScanDB.clear(); await ScanDB.put(saved);
      scanFiles = saved.map((x) => ({ name: x.name, file: new File([x.blob], x.name, { type: x.blob.type }) }));
    } catch (err) { log('! Could not keep the scan folder for after a page reload: ' + err.message); }
    info();
  }
  q('.fd').onchange = async (e) => {
    const list = [...e.target.files].map((f) => ({ name: f.name, file: f }));
    log(`Scan folder: ${list.length} files. Keeping the PDFs...`);
    await keepScans(list);
    log(`Scan folder ready: ${scanFiles.length} PDF/ZIP files.`);
  };
  q('.fs').onchange = async (e) => {
    const inp = e.target;
    const f = inp.files[0];
    if (!f) return;
    try {
      rows = parseSheet(new Uint8Array(await f.arrayBuffer()), f.name);
      await store.set('pjRows', rows);
      log(`Loaded ${rows.length} TIDs from ${f.name}.`);
    } catch (err) {
      log('ERROR: ' + err.message);
    }
    inp.value = '';
    render();
  };
  q('[data-a=next]').onclick = () => {
    const r = rows.find((x) => !['Done', 'Ready'].includes(status[x.tid]?.s) && x.tid !== currentTid)
      || rows.find((x) => !['Done'].includes(status[x.tid]?.s) && x.tid !== currentTid);
    if (!r) { log('No pending TID in the list.'); return; }
    fillRow(r);
  };
  q('[data-a=text]').onclick = () => {
    const r = rows.find((x) => !x.complaints || !x.diagnosis);
    if (!r) { log('All claims already have chief complaints and diagnosis.'); return; }
    openEditor(r);
  };
  q('[data-a=clear]').onclick = async () => {
    if (!confirm('Clear the TID list and status?')) return;
    rows = []; status = {}; currentTid = null;
    await store.set('pjRows', rows); await store.set('pjStatus', status);
    try { await ScanDB.clear(); } catch (e) { /* ignore */ }
    scanFiles = [];
    render();
  };

  // ---------- complaints / diagnosis editor ----------
  let editing = null;
  let phrases = { cc: [], dg: [] };
  function fillPicks() {
    for (const [k, sel] of [['cc', q('.qcc')], ['dg', q('.qdg')]]) {
      sel.innerHTML = '<option value="">Quick pick...</option>'
        + [...new Set(phrases[k])].sort().map((t) => `<option>${t.replace(/</g, '')}</option>`).join('');
    }
  }
  // ---------- scanned-document viewer (type the text while looking at the slip) ----------
  let viewUrl = '';
  async function showDoc(f, name) {
    try {
      const file = f.file || (f.handle && await f.handle.getFile());
      if (!file) return;
      if (viewUrl) URL.revokeObjectURL(viewUrl);
      viewUrl = URL.createObjectURL(file);
      // open fitted to the width so the handwriting is readable at once
      q('.vf').setAttribute('src', viewUrl + '#zoom=page-width');
      q('.vn').textContent = name || f.name;
      q('.vw').classList.add('on');
    } catch (e) { log('! Could not open ' + f.name + ': ' + e.message); }
  }
  function closeViewer() {
    q('.vw').classList.remove('on');
    q('.vf').removeAttribute('src');
    if (viewUrl) { URL.revokeObjectURL(viewUrl); viewUrl = ''; }
  }
  q('.vx').onclick = closeViewer;

  async function openEditor(r) {
    editing = r;
    q('.ed').classList.add('on');
    q('.ecc').value = r.complaints || '';
    q('.edg').value = r.diagnosis || '';
    q('.etid').textContent = `${r.tid} ${r.patient || ''}`;
    fillPicks();
    // buttons for this patient's scanned files; the slip opens on its own
    if (dirHandle && folderState === 'ready') await readFolder(true);
    const map = filesForRow(r);
    const list = UPLOAD_SLOTS.filter((s) => map[s.id]).map((s) => ({ slot: s, f: map[s.id] }));
    const box = q('.docs');
    box.innerHTML = '';
    if (!list.length) {
      box.innerHTML = `<span class="muted">${scanFiles.length ? 'No scanned file found for this patient.' : 'Scan folder not chosen - choose it to see the slip here.'}</span>`;
    } else {
      for (const { slot, f } of list) {
        const b = document.createElement('button');
        b.className = 'btn'; b.textContent = slot.title.split(' / ')[0]; b.title = f.name;
        b.onclick = () => { box.querySelectorAll('.btn').forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); showDoc(f, `${r.patient || r.tid} - ${f.name}`); };
        box.appendChild(b);
      }
      const first = list.find((x) => x.slot.id === 'doctorprescription') || list[0];
      box.querySelector('.btn').classList.add('sel');
      await showDoc(first.f, `${r.patient || r.tid} - ${first.f.name}`);
    }
    q('.ecc').focus();
  }
  q('.qcc').onchange = (e) => { if (e.target.value) q('.ecc').value = e.target.value; e.target.value = ''; };
  q('.qdg').onchange = (e) => { if (e.target.value) q('.edg').value = e.target.value; e.target.value = ''; };
  q('[data-a=close]').onclick = () => { q('.ed').classList.remove('on'); editing = null; closeViewer(); };
  async function saveText() {
    if (!editing) return null;
    const r = editing;
    r.complaints = q('.ecc').value.trim();
    r.diagnosis = q('.edg').value.trim();
    for (const [k, v] of [['cc', r.complaints], ['dg', r.diagnosis]]) if (v && !phrases[k].includes(v)) phrases[k].unshift(v);
    phrases.cc = phrases.cc.slice(0, 60); phrases.dg = phrases.dg.slice(0, 60);
    await store.set('pjRows', rows); await store.set('pjPhrases', phrases);
    log(`Saved text for ${r.tid}.`);
    render();
    return r;
  }
  q('[data-a=saveonly]').onclick = async () => {
    if (!await saveText()) return;
    q('.ed').classList.remove('on'); editing = null; closeViewer();
  };
  // Save and move straight to the next claim that still needs text - no extra clicks.
  q('[data-a=save]').onclick = async () => {
    const r = await saveText(); if (!r) return;
    const i = rows.indexOf(r);
    const next = rows.slice(i + 1).find((x) => !x.complaints || !x.diagnosis) || rows.find((x) => x !== r && (!x.complaints || !x.diagnosis));
    if (next) { await openEditor(next); return; }
    q('.ed').classList.remove('on'); editing = null; closeViewer();
    log('All claims have chief complaints and diagnosis.');
  };

  q('[data-a=hospedia]').onclick = async () => {
    const list = (await store.get('pjRows')) || [];
    if (!list.length) { log('Nothing from Hospedia yet. Open the Hospedia report and press the blue "PJ Make RGHS claim list" button there.'); return; }
    rows = list;
    log(`Loaded ${rows.length} claims (${rows.filter((r) => r.source === 'hospedia').length} from Hospedia).`);
    render();
  };

  // Drag (panel and document viewer)
  function draggable(handle, box) {
    let sx, sy, ox, oy;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      const r = box.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      const mv = (ev) => {
        box.style.left = Math.max(0, ox + ev.clientX - sx) + 'px';
        box.style.top = Math.max(0, oy + ev.clientY - sy) + 'px';
        box.style.right = 'auto'; box.style.bottom = 'auto';
      };
      const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
      addEventListener('mousemove', mv); addEventListener('mouseup', up);
    });
  }
  draggable(q('.hd'), panel);
  draggable(q('.vh'), q('.vw'));

  chrome.runtime.onMessage.addListener((m) => {
    if (m?.type === 'PJ_TOGGLE_PANEL') host.style.display = host.style.display === 'none' ? '' : 'none';
  });

  // Load saved state; resume if the page reloaded during a TID search.
  (async () => {
    rows = (await store.get('pjRows')) || [];
    status = (await store.get('pjStatus')) || {};
    phrases = (await store.get('pjPhrases')) || { cc: [], dg: [] };
    folderName = (await store.get('pjFolderName')) || '';
    try {
      const m = await ScanDB.getMeta('dir');
      if (m && m.value) { dirHandle = m.value; folderName = dirHandle.name || folderName; await readFolder(true); }
    } catch (e) { /* no remembered folder */ }
    if (!scanFiles.length) {
      try {
        const saved = await ScanDB.all();
        if (saved.length) { scanFiles = saved.map((x) => ({ name: x.name, file: new File([x.blob], x.name, { type: x.blob.type }) })); }
      } catch (e) { /* no saved scans */ }
    }
    memory = (await store.get('pjMemory')) || {};
    currentTid = (await store.get('pjCurrent')) || null;
    if (await store.get('pjMin')) panel.classList.add('min');
    for (const t of Object.keys(status)) if (status[t].s === 'Filling') status[t].s = 'Waiting';
    render();
    log(folderState === 'locked' ? `Ready. Folder "${folderName}" is remembered - press "Reconnect folder" once.`
      : scanFiles.length ? `Ready. ${pdfCount()} scan files${folderName ? ` from "${folderName}"` : ''}.`
        : 'Ready. Load from Hospedia (or an Excel sheet) and choose the scan folder.');
    const p = await store.get('pjPending');
    if (p && Date.now() - p.at < 60000) {
      await store.set('pjPending', null);
      const r = rows.find((x) => x.tid === p.tid);
      if (r) { log('Page reloaded after search. Continuing...'); fillRow(r); }
    }
  })();
})();
