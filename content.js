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
      // Excel dates can come back a few seconds before midnight; move to midday so the day is right.
      v = new Date(v.getTime() + 12 * 3600e3);
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
    let skipped = 0;
    for (const r of raw) {
      const keyed = {};
      for (const [k, v] of Object.entries(r)) keyed[norm(k)] = v;
      const o = {};
      for (const [field, names] of Object.entries(COLS)) {
        const k = names.find((n) => keyed[n] !== undefined && keyed[n] !== '');
        o[field] = k ? keyed[k] : '';
      }
      const tidWasNumber = typeof o.tid === 'number';
      o.tid = String(o.tid).replace(/\s/g, '').replace(/\.0+$/, '');
      if (!/^\d{10,}$/.test(o.tid)) { if (Object.values(r).some((x) => String(x).trim())) skipped++; continue; } // skip blank / bad rows
      o.notes = [];
      // Excel keeps only 15 digits of a number, so a 16-digit TID typed as a number loses its last digit.
      if (tidWasNumber && o.tid.length >= 16) o.notes.push(`TID ${o.tid} was saved as a number in Excel - the last digit may be wrong. Format the TID column as Text.`);
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
    rows.skipped = skipped;
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
    const isOther = (s) => OTHER_RE.test(norm(s));
    if (row.speciality) {
      const want = pickSpeciality(row.speciality);
      let chosen;
      if (want) {
        chosen = setSelect('opddepartment', want);
        log(`Speciality: ${chosen}` + (norm(chosen) === norm(row.speciality) ? '' : ` (for "${row.speciality}")`));
      } else {
        const other = [...need('opddepartment').options].find((o) => isOther(o.text));
        if (!other) throw new Error(`"${row.speciality}" is not in the Speciality list.`);
        chosen = setSelect('opddepartment', other.text);
        log(`Speciality: ${chosen} (for "${row.speciality}")`);
      }
      await sleep(600);
      // "Any Other Speciality" needs the real speciality typed in the box next to it
      if (isOther(chosen) && $('opddepttext')) {
        const otherText = [row.otherSpeciality, row.docSpeciality, want ? '' : row.speciality].find((x) => x && !isOther(x)) || '';
        if (otherText) { setVal('opddepttext', otherText); log(`Other speciality: ${otherText}`); }
        else log('! Type the speciality in the "Any Other" box yourself.');
      }
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
      const changed = $('rmcno').value !== rmc;   // a Redo with another doctor must verify again
      if (changed) setVal('rmcno', rmc);
      if (rmcType) setSelect('rmcqual', rmcType.toUpperCase(), { byValue: true });
      const v = buttonByOnclick('varifyRmc(');
      if (v && (changed || !$('opddocname').value)) {
        if (changed && $('opddocname').value) $('opddocname').value = '';
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
    if (row.docSpeciality && !isOther(row.docSpeciality) && $('opddocspaciality') && !$('opddocspaciality').disabled) {
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
    if (folderState === 'locked') { log('! Scan folder needs permission again - press "Reconnect folder".'); return { none: 'Scan folder is locked - press "Reconnect folder", then Redo, or upload the documents yourself.' }; }
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
    *{box-sizing:border-box}
    .p,.vw,.toasts{
      --bg:rgba(255,255,255,.9);--card:#fff;--soft:#f1f5f9;--line:#e2e8f0;--ink:#0f172a;--mute:#64748b;
      --pri:#4f46e5;--pri2:#0ea5e9;--ok:#16a34a;--okbg:#dcfce7;--warn:#d97706;--warnbg:#fef3c7;--bad:#dc2626;--badbg:#fee2e2;
      --info:#4f46e5;--infobg:#e0e7ff;--grad:linear-gradient(135deg,#0ea5e9 0%,#6366f1 55%,#8b5cf6 100%);
      font:13px/1.45 "Segoe UI",system-ui,-apple-system,sans-serif;color:var(--ink)}
    @media (prefers-color-scheme: dark){
      .p,.vw,.toasts{--bg:rgba(15,23,42,.92);--card:#1e293b;--soft:#0f172a;--line:#334155;--ink:#e2e8f0;--mute:#94a3b8;
        --okbg:#14532d;--warnbg:#78350f;--badbg:#7f1d1d;--infobg:#312e81;--ok:#4ade80;--warn:#fbbf24;--bad:#f87171;--info:#a5b4fc}
    }
    .p{position:fixed;right:16px;bottom:16px;width:410px;max-height:86vh;display:flex;flex-direction:column;z-index:2147483646;
      background:var(--bg);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid var(--line);
      border-radius:18px;box-shadow:0 20px 50px rgba(15,23,42,.28);overflow:hidden;animation:pop .25s ease-out}
    @keyframes pop{from{transform:translateY(12px) scale(.98);opacity:0}to{transform:none;opacity:1}}
    button{font:inherit;color:inherit}
    .hd{display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--grad);color:#fff;cursor:move;user-select:none}
    .logo{width:32px;height:32px;border-radius:10px;background:#fff;color:#4f46e5;font-weight:800;display:grid;place-items:center;font-size:13px;
      box-shadow:0 4px 12px rgba(0,0,0,.18)}
    .tt{flex:1;min-width:0}.tt b{display:block;font-size:15px;letter-spacing:.2px}.tt small{opacity:.85;font-size:11px}
    .hb{background:rgba(255,255,255,.18);border:0;color:#fff;border-radius:8px;width:28px;height:28px;cursor:pointer;font-size:15px;display:grid;place-items:center}
    .hb:hover{background:rgba(255,255,255,.32)}
    .bd{padding:12px 14px;overflow:auto;display:flex;flex-direction:column;gap:10px}
    .min .bd{display:none}.min{width:260px}
    .min .hd{cursor:pointer}

    /* steps */
    .steps{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
    .stp{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:7px 6px;text-align:center;cursor:pointer;transition:.15s;position:relative}
    .stp:hover{border-color:var(--pri);transform:translateY(-1px)}
    .stp .n{width:22px;height:22px;border-radius:50%;margin:0 auto 3px;display:grid;place-items:center;font-weight:700;font-size:11px;background:var(--soft);color:var(--mute)}
    .stp .l{font-size:11px;font-weight:600;line-height:1.2}
    .stp .s{font-size:10px;color:var(--mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .stp.done .n{background:var(--ok);color:#fff}
    .stp.act{border-color:var(--pri);box-shadow:0 0 0 3px rgba(99,102,241,.18)}
    .stp.act .n{background:var(--pri);color:#fff}
    .stp.warn .n{background:var(--warn);color:#fff}

    /* progress */
    .prog{display:flex;align-items:center;gap:10px}
    .bar{flex:1;height:8px;border-radius:99px;background:var(--soft);overflow:hidden;border:1px solid var(--line)}
    .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#22c55e,#16a34a);border-radius:99px;transition:width .5s}
    .pct{font-weight:700;font-size:12px;min-width:84px;text-align:right}

    /* filters + search */
    .chips{display:flex;gap:5px;flex-wrap:wrap}
    .chip{border:1px solid var(--line);background:var(--card);border-radius:99px;padding:2px 9px;font-size:11px;font-weight:600;cursor:pointer;display:flex;gap:5px;align-items:center}
    .chip b{font-weight:700}
    .chip.on{background:var(--ink);color:var(--card);border-color:var(--ink)}
    .dot{width:7px;height:7px;border-radius:50%;display:inline-block;background:var(--mute)}
    .dot.Ready{background:var(--ok)}.dot.Check{background:var(--warn)}.dot.Error{background:var(--bad)}.dot.Done{background:#0ea5e9}.dot.Filling{background:var(--pri)}
    .srch{width:100%;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:10px;padding:7px 10px 7px 30px;font:12px inherit;outline:none;
      background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Ccircle cx='6' cy='6' r='4.5'/%3E%3Cpath d='M9.5 9.5 13 13'/%3E%3C/svg%3E");
      background-repeat:no-repeat;background-position:10px 50%}
    .srch:focus{border-color:var(--pri);box-shadow:0 0 0 3px rgba(99,102,241,.15)}

    /* claim cards */
    .list{display:flex;flex-direction:column;gap:6px;max-height:250px;overflow:auto;padding:2px}
    .cl{display:flex;gap:8px;align-items:center;background:var(--card);border:1px solid var(--line);border-left:4px solid var(--line);border-radius:12px;padding:7px 8px;transition:.15s}
    .cl:hover{box-shadow:0 4px 14px rgba(15,23,42,.08)}
    .cl.Ready{border-left-color:var(--ok)}.cl.Check{border-left-color:var(--warn)}.cl.Error{border-left-color:var(--bad)}.cl.Done{border-left-color:#0ea5e9;opacity:.75}.cl.Filling{border-left-color:var(--pri)}
    .cl.cur{box-shadow:0 0 0 2px var(--pri)}
    .cm{flex:1;min-width:0}
    .cn{font-weight:700;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .cs{font-size:11px;color:var(--mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .cs code{font:11px Consolas,monospace;color:var(--ink)}
    .tags{display:flex;gap:4px;margin-top:3px;flex-wrap:wrap}
    .tag{font-size:10px;font-weight:700;padding:1px 6px;border-radius:99px;background:var(--soft);color:var(--mute)}
    .tag.w{background:var(--warnbg);color:var(--warn)}.tag.b{background:var(--badbg);color:var(--bad)}.tag.i{background:var(--infobg);color:var(--info)}
    .pill{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:99px;background:var(--soft);color:var(--mute);white-space:nowrap}
    .pill.Ready{background:var(--okbg);color:var(--ok)}.pill.Check{background:var(--warnbg);color:var(--warn)}.pill.Error{background:var(--badbg);color:var(--bad)}
    .pill.Done{background:#e0f2fe;color:#0369a1}.pill.Filling{background:var(--infobg);color:var(--info)}
    .pill.Filling::before{content:"";display:inline-block;width:8px;height:8px;margin-right:4px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin .8s linear infinite;vertical-align:-1px}
    @keyframes spin{to{transform:rotate(360deg)}}
    .empty{text-align:center;color:var(--mute);padding:16px 8px;font-size:12px;border:1.5px dashed var(--line);border-radius:12px}
    .empty b{display:block;font-size:22px;margin-bottom:4px}

    /* buttons */
    .btn{border:1px solid var(--line);border-radius:10px;padding:6px 11px;font-weight:600;cursor:pointer;background:var(--card);font-size:12px;transition:.15s;white-space:nowrap}
    .btn:hover{border-color:var(--pri);color:var(--pri)}
    .btn.sm{padding:4px 8px;font-size:11px;border-radius:8px}
    .btn.ic{width:28px;height:28px;padding:0;display:grid;place-items:center}
    .btn.pri{background:var(--pri);border-color:var(--pri);color:#fff}
    .btn.pri:hover{filter:brightness(1.1);color:#fff}
    .btn:disabled{opacity:.45;cursor:default;filter:none}
    .go{width:100%;border:0;border-radius:14px;padding:12px;font-size:14px;font-weight:700;color:#fff;cursor:pointer;background:var(--grad);
      box-shadow:0 8px 20px rgba(79,70,229,.35);transition:.15s;display:flex;align-items:center;justify-content:center;gap:8px}
    .go:hover{transform:translateY(-1px);box-shadow:0 12px 26px rgba(79,70,229,.45)}
    .go:disabled{opacity:.6;cursor:default;transform:none}
    .go kbd,.kb{font:10px Consolas,monospace;background:rgba(255,255,255,.22);border-radius:5px;padding:1px 5px}
    .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
    .sp{flex:1}
    .menu{position:relative}
    .mlist{position:absolute;right:0;bottom:34px;background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 30px rgba(15,23,42,.2);padding:5px;display:none;min-width:190px;z-index:3}
    .mlist.on{display:block}
    .mlist button{display:block;width:100%;text-align:left;background:none;border:0;padding:7px 10px;border-radius:8px;cursor:pointer;font-size:12px}
    .mlist button:hover{background:var(--soft)}
    .mlist .dz{color:var(--bad)}

    /* now filling */
    .now{display:none;background:var(--infobg);border-radius:12px;padding:8px 10px}
    .now.on{display:block}
    .now .nt{font-weight:700;font-size:12px;margin-bottom:6px;color:var(--info)}
    .trail{display:flex;gap:3px}
    .trail span{flex:1;height:5px;border-radius:99px;background:rgba(99,102,241,.2)}
    .trail span.d{background:var(--pri)}.trail span.a{background:var(--pri);animation:blink 1s infinite}
    .trail span.x{background:var(--warn)}
    @keyframes blink{50%{opacity:.35}}
    .ns{font-size:11px;color:var(--mute);margin-top:4px}

    /* warnings */
    .warn{display:none;background:var(--warnbg);border-radius:12px;padding:8px 10px;font-size:12px}
    .warn.on{display:block}
    .warn .wh{font-weight:700;color:var(--warn);margin-bottom:3px}
    .warn ul{margin:0;padding-left:16px}.warn li{margin:2px 0}

    /* editor */
    .ed{background:var(--card);border:1.5px solid var(--pri);border-radius:14px;padding:10px;display:none;flex-direction:column;gap:7px;box-shadow:0 0 0 4px rgba(99,102,241,.1)}
    .ed.on{display:flex}
    .eh{display:flex;align-items:center;gap:6px}
    .eh b{flex:1;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ed textarea{width:100%;min-height:44px;font:12px/1.4 inherit;color:var(--ink);background:var(--soft);border:1px solid var(--line);border-radius:8px;padding:6px 8px;resize:vertical;outline:none}
    .ed textarea:focus{border-color:var(--pri);background:var(--card)}
    .lbl{font-size:11px;color:var(--mute);font-weight:700;display:flex;justify-content:space-between;margin-bottom:2px}
    .ed select{font:11px inherit;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:4px;width:100%;margin-top:3px}
    .docs .btn.sel{background:var(--pri);color:#fff;border-color:var(--pri)}
    .hint{font-size:10.5px;color:var(--mute)}

    /* log */
    details.lg{background:var(--card);border:1px solid var(--line);border-radius:12px}
    details.lg summary{cursor:pointer;padding:6px 10px;font-size:12px;font-weight:600;color:var(--mute);list-style:none;display:flex;gap:6px;align-items:center}
    details.lg summary::before{content:"▸";transition:.15s}
    details.lg[open] summary::before{transform:rotate(90deg)}
    .log{background:#0b1220;color:#cbd5e1;border-radius:0 0 11px 11px;padding:6px 9px;font:11px/1.5 Consolas,monospace;max-height:150px;overflow:auto;white-space:pre-wrap}
    .log .e{color:#fca5a5}.log .w{color:#fcd34d}.log .k{color:#86efac}.log .h{color:#a5b4fc;font-weight:700}.log .t{color:#64748b}
    .safe{display:flex;gap:8px;align-items:flex-start;font-size:11px;color:var(--mute);padding:2px 2px 0}
    .safe svg{flex:none;margin-top:1px}
    input[type=file]{display:none}

    /* scanned document viewer */
    .vw{position:fixed;left:16px;top:60px;width:640px;height:78vh;min-width:320px;min-height:240px;display:none;flex-direction:column;z-index:2147483645;
      background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:0 20px 50px rgba(15,23,42,.3);overflow:hidden;resize:both}
    .vw.on{display:flex;animation:pop .2s ease-out}
    .vh{display:flex;align-items:center;gap:8px;padding:9px 12px;background:var(--grad);color:#fff;cursor:move;user-select:none}
    .vh b{flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .vh button{background:rgba(255,255,255,.2);border:0;color:#fff;border-radius:8px;padding:3px 10px;cursor:pointer;font-size:12px}
    .vw embed{flex:1;width:100%;border:0;background:#525659}

    /* toasts + celebration */
    .toasts{position:fixed;right:440px;bottom:20px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;pointer-events:none}
    .toast{pointer-events:auto;min-width:220px;max-width:340px;background:var(--card);color:var(--ink);border:1px solid var(--line);border-left:4px solid var(--ok);border-radius:12px;
      padding:9px 12px;box-shadow:0 12px 30px rgba(15,23,42,.22);font-size:12.5px;animation:pop .25s ease-out}
    .toast.bad{border-left-color:var(--bad)}.toast.warn{border-left-color:var(--warn)}.toast.info{border-left-color:var(--pri)}
    .toast.out{opacity:0;transform:translateY(8px);transition:.3s}
    .cf{position:fixed;top:-12px;width:9px;height:14px;border-radius:2px;z-index:2147483647;pointer-events:none;animation:fall 1.8s ease-in forwards}
    @keyframes fall{to{transform:translate(var(--dx),105vh) rotate(var(--r));opacity:.9}}
  </style>
  <div class="vw" role="dialog" aria-label="Scanned document">
    <div class="vh"><b class="vn">Scanned document</b><button class="vx">Close ✕</button></div>
    <embed class="vf" type="application/pdf">
  </div>
  <div class="toasts" aria-live="polite"></div>
  <div class="p" role="region" aria-label="PJ Auto OPD Claim">
    <div class="hd">
      <span class="logo">PJ</span>
      <div class="tt"><b>Auto OPD Claim</b><small class="sub">RGHS claim helper</small></div>
      <button class="hb mn" title="Minimise (Alt+M)" aria-label="Minimise">–</button>
      <button class="hb hx" title="Hide panel (toolbar icon brings it back)" aria-label="Hide">✕</button>
    </div>
    <div class="bd">
      <div class="steps">
        <div class="stp" data-step="load" title="Load the claim list from Hospedia (or an Excel sheet)"><div class="n">1</div><div class="l">Claims</div><div class="s">load</div></div>
        <div class="stp" data-step="folder" title="Choose the scan folder once"><div class="n">2</div><div class="l">Scans</div><div class="s">folder</div></div>
        <div class="stp" data-step="text" title="Type chief complaints and diagnosis while looking at the slip"><div class="n">3</div><div class="l">Text</div><div class="s">type</div></div>
        <div class="stp" data-step="fill" title="Fill the RGHS form, check it and submit"><div class="n">4</div><div class="l">Fill</div><div class="s">submit</div></div>
      </div>
      <div class="prog"><div class="bar"><i></i></div><span class="pct">0 / 0 done</span></div>

      <div class="ed" role="dialog" aria-label="Chief complaints and diagnosis">
        <div class="eh"><span class="dot Filling"></span><b class="etid"></b><button class="btn sm" data-a="close" title="Close (Esc)">✕</button></div>
        <div class="row docs"></div>
        <div><div class="lbl"><span>Chief complaints</span><span class="ccn">0/250</span></div><textarea class="ecc" maxlength="250" placeholder="e.g. Fever and cough for 3 days"></textarea>
          <select class="qcc"><option value="">⚡ Quick pick from earlier...</option></select></div>
        <div><div class="lbl"><span>Diagnosis</span><span class="dgn">0/250</span></div><textarea class="edg" maxlength="250" placeholder="e.g. Upper respiratory tract infection"></textarea>
          <select class="qdg"><option value="">⚡ Quick pick from earlier...</option></select></div>
        <div class="row"><button class="btn pri" data-a="save">Save &amp; next →</button><button class="btn" data-a="saveonly">Save</button>
          <span class="sp"></span><span class="hint">Ctrl+Enter = save &amp; next</span></div>
      </div>

      <div class="now"><div class="nt"></div><div class="trail"></div><div class="ns"></div></div>
      <div class="warn"><div class="wh">⚠ Please check before you submit</div><ul></ul></div>

      <button class="go" data-a="next" title="Alt+N">▶ Fill next TID <kbd>Alt+N</kbd></button>

      <div class="chips"></div>
      <input class="srch" type="search" placeholder="Search TID, patient or doctor..." aria-label="Search claims">
      <div class="list"></div>

      <div class="row">
        <button class="btn" data-a="hospedia" title="Take the list made on the Hospedia report page">⬇ Hospedia</button>
        <button class="btn" data-a="sheet" title="Load an Excel or CSV sheet">📄 Excel</button>
        <button class="btn" data-a="folder">📁 Scan folder</button>
        <span class="sp"></span>
        <div class="menu"><button class="btn ic" data-a="more" title="More" aria-label="More">⋯</button>
          <div class="mlist">
            <button data-a="text">✎ Type text for all (Alt+T)</button>
            <button data-a="report">⬇ Download status report (Excel)</button>
            <button data-a="template">⬇ Blank Excel template</button>
            <button data-a="clear" class="dz">🗑 Clear list</button>
          </div>
        </div>
        <input type="file" class="fs" accept=".xlsx,.xls,.csv">
        <input type="file" class="fd" webkitdirectory multiple>
      </div>
      <div class="muted info hint"></div>

      <details class="lg"><summary>Activity log <span class="lgc"></span></summary><div class="log"></div></details>
      <div class="safe"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        <span>The tool only fills the form. It never presses SAVE or FINAL CLAIM SUBMISSION — you check and submit.</span></div>
    </div>
  </div>`;
  document.documentElement.appendChild(host);
  const q = (s) => root.querySelector(s);
  const panel = q('.p');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let rows = [];
  let status = {}; // tid -> {s, msg}
  let memory = {};
  let busy = false;
  let currentTid = null;
  let filter = 'All';
  let lastWarn = [];

  // ---------- log + toasts ----------
  const logEl = q('.log');
  let logCount = 0;
  function log(msg) {
    const t = new Date().toLocaleTimeString('en-IN', { hour12: false });
    const cls = /^(ERROR|!)/.test(msg) ? (/^ERROR/.test(msg) ? 'e' : 'w') : /^---/.test(msg) ? 'h' : /^(Done|Submitted|Saved|RMC verified|Package added|.*uploaded:)/.test(msg) ? 'k' : '';
    const line = document.createElement('div');
    line.innerHTML = `<span class="t">${t}</span>  `;
    const m = document.createElement('span'); m.className = cls; m.textContent = msg; line.appendChild(m);
    logEl.appendChild(line);
    while (logEl.childElementCount > 400) logEl.firstChild.remove();
    logEl.scrollTop = logEl.scrollHeight;
    q('.lgc').textContent = `(${++logCount})`;
  }
  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind; el.textContent = msg;
    q('.toasts').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, kind === 'bad' ? 7000 : 4000);
  }
  function celebrate(n = 70) {
    const colors = ['#6366f1', '#0ea5e9', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6'];
    for (let i = 0; i < n; i++) {
      const c = document.createElement('i');
      c.className = 'cf';
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[i % colors.length];
      c.style.setProperty('--dx', (Math.random() * 200 - 100) + 'px');
      c.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg');
      c.style.animationDelay = Math.random() * 0.4 + 's';
      root.appendChild(c);
      setTimeout(() => c.remove(), 2600);
    }
  }

  // ---------- rendering ----------
  const STATES = ['All', 'Waiting', 'Ready', 'Check', 'Error', 'Done'];
  const stOf = (r) => status[r.tid]?.s || 'Waiting';
  const needsText = (r) => !r.complaints || !r.diagnosis;
  function info() {
    const fol = folderState === 'locked' ? `"${folderName}" needs permission — press Reconnect`
      : folderName ? `"${folderName}" · ${pdfCount()} PDF/ZIP`
        : scanFiles.length ? `${pdfCount()} PDF/ZIP files (copied in)` : 'not chosen';
    q('.info').textContent = 'Scan folder: ' + fol;
    const b = q('[data-a=folder]');
    b.textContent = folderState === 'locked' ? '🔓 Reconnect folder' : folderName || scanFiles.length ? '📁 Change folder' : '📁 Scan folder';
    // steps
    const total = rows.length;
    const done = rows.filter((r) => stOf(r) === 'Done').length;
    const texted = rows.filter((r) => !needsText(r)).length;
    const set = (k, cls, sub) => { const el = q(`[data-step=${k}]`); el.className = 'stp ' + cls; el.querySelector('.s').textContent = sub; };
    set('load', total ? 'done' : 'act', total ? `${total} TIDs` : 'load');
    set('folder', folderState === 'locked' ? 'warn' : pdfCount() ? 'done' : total ? 'act' : '', folderState === 'locked' ? 'reconnect' : pdfCount() ? `${pdfCount()} files` : 'choose');
    set('text', !total ? '' : texted === total ? 'done' : (pdfCount() || folderState === 'locked') ? 'act' : '', total ? `${texted}/${total}` : 'type');
    set('fill', !total ? '' : done === total ? 'done' : texted === total ? 'act' : '', total ? `${done}/${total}` : 'submit');
    q('.bar i').style.width = total ? (done * 100 / total) + '%' : '0';
    q('.pct').textContent = total ? `${done} / ${total} done` : 'no claims';
    q('.sub').textContent = total ? `${total - done} pending · ${done} submitted` : 'RGHS claim helper';
  }
  function chips() {
    const n = (s) => (s === 'All' ? rows.length : rows.filter((r) => stOf(r) === s).length);
    q('.chips').innerHTML = STATES.filter((s) => s === 'All' || n(s)).map((s) =>
      `<button class="chip ${filter === s ? 'on' : ''}" data-f="${s}">${s === 'All' ? '' : `<span class="dot ${s}"></span>`}${s} <b>${n(s)}</b></button>`).join('');
  }
  function render() {
    if (filter !== 'All' && !rows.some((r) => stOf(r) === filter)) filter = 'All';
    chips();
    const term = norm(q('.srch').value);
    const list = q('.list');
    list.innerHTML = '';
    const shown = rows.filter((r) => (filter === 'All' || stOf(r) === filter)
      && (!term || norm(r.tid + r.patient + r.doctor).includes(term)));
    if (!rows.length) {
      list.innerHTML = '<div class="empty"><b>📋</b>No claims yet.<br>Press <b style="display:inline;font-size:12px">⬇ Hospedia</b> or <b style="display:inline;font-size:12px">📄 Excel</b> below.</div>';
    } else if (!shown.length) {
      list.innerHTML = '<div class="empty">Nothing matches.</div>';
    }
    for (const r of shown) {
      const st = stOf(r);
      const el = document.createElement('div');
      el.className = `cl ${st}${r.tid === currentTid ? ' cur' : ''}`;
      el.title = status[r.tid]?.msg || '';
      const bill = r.bill ? ` · ₹${esc(r.bill)}` : '';
      const tags = [];
      if (needsText(r)) tags.push('<span class="tag i">✎ text needed</span>');
      if (r.preAuth) tags.push('<span class="tag b">PRE-AUTH</span>');
      if ((r.notes || []).length && st === 'Waiting') tags.push(`<span class="tag w" title="${esc(r.notes.join('\n'))}">${r.notes.length} note${r.notes.length > 1 ? 's' : ''}</span>`);
      el.innerHTML = `<div class="cm"><div class="cn">${esc(r.patient || 'TID ' + r.tid)}</div>`
        + `<div class="cs"><code>${esc(r.tid)}</code>${bill} · ${(r.packages || []).length} codes</div>`
        + `<div class="cs">${esc(r.doctor || 'no doctor')}</div>`
        + (tags.length ? `<div class="tags">${tags.join('')}</div>` : '') + '</div>'
        + `<span class="pill ${st}">${st}</span>`;
      const e = document.createElement('button');
      e.className = 'btn sm ic'; e.textContent = '✎'; e.title = 'See the scanned slip and type chief complaints / diagnosis';
      e.setAttribute('aria-label', 'Type text for ' + r.tid);
      e.onclick = () => openEditor(r);
      const b = document.createElement('button');
      b.className = 'btn sm' + (st === 'Done' ? '' : ' pri'); b.textContent = st === 'Done' || st === 'Ready' || st === 'Check' ? 'Redo' : 'Fill';
      b.dataset.fill = r.tid;
      b.disabled = busy;
      b.onclick = () => fillRow(r);
      el.appendChild(e); el.appendChild(b);
      list.appendChild(el);
    }
    const pending = rows.some((x) => stOf(x) !== 'Done');
    q('.go').disabled = busy || !pending;
    q('.go').innerHTML = busy ? '<span class="pill Filling" style="background:none;color:#fff;padding:0"></span> Filling...'
      : !rows.length ? 'Load claims to start' : pending ? '▶ Fill next TID <kbd>Alt+N</kbd>' : '🎉 All claims done';
    info();
  }
  async function setStatus(tid, s, msg = '') {
    const before = status[tid]?.s;
    status[tid] = { s, msg, at: Date.now() };
    await store.set('pjStatus', status);
    render();
    if (s === 'Done' && before !== 'Done') {
      celebrate(rows.every((r) => stOf(r) === 'Done') ? 140 : 50);
      toast(rows.every((r) => stOf(r) === 'Done') ? '🎉 All claims submitted. Great work!' : `✅ ${tid} submitted`, '');
    }
  }
  function showWarn(list) {
    lastWarn = list;
    q('.warn ul').innerHTML = list.map((w) => `<li>${esc(w)}</li>`).join('');
    q('.warn').classList.toggle('on', !!list.length);
  }

  // live step trail while a claim is being filled
  const STEPS = [['search', 'Search TID'], ['doctor', 'Doctor & RMC'], ['packages', 'Packages'], ['presc', 'Prescription & bill'], ['files', 'Documents'], ['check', 'Final check']];
  let stepState = {};
  function showStep(row, key, state) {
    if (key) stepState[key] = state;
    const box = q('.now');
    if (!row) { box.classList.remove('on'); return; }
    box.classList.add('on');
    q('.now .nt').textContent = `Filling ${row.patient || ''} · ${row.tid}`;
    q('.now .trail').innerHTML = STEPS.map(([k, t]) => `<span class="${{ done: 'd', active: 'a', fail: 'x' }[stepState[k]] || ''}" title="${t}"></span>`).join('');
    const cur = STEPS.find(([k]) => stepState[k] === 'active');
    q('.now .ns').textContent = cur ? cur[1] + '...' : '';
  }

  async function fillRow(row) {
    if (busy) return;
    if (editing) closeEditor();
    busy = true; currentTid = row.tid; stepState = {};
    showWarn([]);
    await store.set('pjCurrent', row.tid);
    await setStatus(row.tid, 'Filling');
    log(`--- TID ${row.tid}${row.patient ? ' - ' + row.patient : ''} ---`);
    const problems = [];
    // every step after Search runs even when an earlier one fails, so the form is filled as far as possible
    const step = async (key, fn) => {
      showStep(row, key, 'active');
      try { const v = await fn(); showStep(row, key, 'done'); return v; } catch (e) {
        problems.push(e.message); log('! ' + e.message); showStep(row, key, 'fail');
        try { for (const id of ['addPackageModal', 'msgModal']) if (modalOpen(id)) await closeModal(id); } catch (x) { /* ignore */ }
        return null;
      }
    };
    try {
      showStep(row, 'search', 'active');
      await popups();
      await searchTid(row, log);
      showStep(row, 'search', 'done');
    } catch (e) {
      log('ERROR: ' + e.message);
      showStep(row, 'search', 'fail');
      await setStatus(row.tid, 'Error', e.message);
      toast(`${row.tid}: ${e.message}`, 'bad');
      busy = false; render();
      return;
    }
    await step('doctor', () => fillDoctor(row, log, memory));
    const failed = (await step('packages', () => addPackages(row, log))) || [];
    await step('presc', () => fillPrescription(row, log));
    const up = (await step('files', () => uploadFiles(row, log))) || {};
    showStep(row, 'check', 'active');
    const c = checks(row);
    if (up.none) c.warn.push(up.none);
    if (failed.length) c.warn.unshift(`These package codes were NOT added: ${failed.join(' | ')}. Add them on the portal yourself, or leave them out.`);
    for (const p of problems.reverse()) c.warn.unshift(p);
    if (row.preAuth) c.warn.unshift(`PRE-AUTH: ${row.preAuth}`);
    for (const n of (row.notes || []).slice(0, 4)) c.warn.push(n);
    const warn = [...new Set(c.warn)];
    log(`Claim amount as per packages: Rs ${c.total}`);
    showWarn(warn);
    showStep(row, 'check', warn.length ? 'fail' : 'done');
    await setStatus(row.tid, warn.length ? 'Check' : 'Ready', warn.join(' '));
    highlightSubmit();
    log('Done. Check the form and press FINAL CLAIM SUBMISSION.');
    toast(warn.length ? `⚠ ${row.tid} filled — ${warn.length} thing${warn.length > 1 ? 's' : ''} to check` : `✔ ${row.tid} filled — check and submit`, warn.length ? 'warn' : '');
    busy = false;
    render();
    setTimeout(() => showStep(null), 4000);
  }

  // Mark Done when the portal shows its success pop-up after a submission.
  setInterval(async () => {
    if (!currentTid || !['Ready', 'Check'].includes(status[currentTid]?.s)) return;
    if (modalOpen('successModal')) {
      const t = modalText('successModal');
      if (/success|submitted/i.test(t)) {
        log(`Submitted: ${currentTid}`);
        showWarn([]);
        await setStatus(currentTid, 'Done', t);
      }
    }
  }, 1000);

  // ---------- buttons ----------
  q('.mn').onclick = async (e) => {
    e.stopPropagation();
    panel.classList.toggle('min');
    q('.mn').textContent = panel.classList.contains('min') ? '▢' : '–';
    await store.set('pjMin', panel.classList.contains('min'));
  };
  q('.hx').onclick = (e) => { e.stopPropagation(); host.style.display = 'none'; };
  q('.hd').addEventListener('dblclick', () => q('.mn').click());
  q('.chips').onclick = (e) => { const b = e.target.closest('[data-f]'); if (!b) return; filter = b.dataset.f; render(); };
  q('.srch').oninput = () => render();
  root.querySelectorAll('[data-step]').forEach((s) => (s.onclick = () => {
    ({ load: () => q('[data-a=hospedia]').click(), folder: () => q('[data-a=folder]').click(), text: () => q('[data-a=text]').click(), fill: () => q('[data-a=next]').click() })[s.dataset.step]();
  }));
  q('[data-a=more]').onclick = (e) => { e.stopPropagation(); q('.mlist').classList.toggle('on'); };
  root.addEventListener('click', (e) => { if (!e.target.closest('.menu')) q('.mlist').classList.remove('on'); });
  q('.mlist').addEventListener('click', () => q('.mlist').classList.remove('on'));
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
        if (await readFolder()) toast(`📁 ${pdfCount()} scanned files found in "${folderName}"`);
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
      if (await readFolder()) toast(`🔓 Folder reconnected · ${pdfCount()} files`);
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
    const inp = e.target;   // read now: a shadow-DOM event loses its target after the first await
    const list = [...inp.files].map((f) => ({ name: f.name, file: f }));
    log(`Scan folder: ${list.length} files. Keeping the PDFs...`);
    await keepScans(list);
    log(`Scan folder ready: ${scanFiles.length} PDF/ZIP files.`);
    toast(`📁 ${scanFiles.length} scanned files ready`);
    inp.value = '';
  };
  q('.fs').onchange = async (e) => {
    const inp = e.target;
    const f = inp.files[0];
    if (!f) return;
    try {
      const fresh = parseSheet(new Uint8Array(await f.arrayBuffer()), f.name);
      // keep what was typed earlier for a TID that is loaded again
      const old = new Map(rows.map((r) => [r.tid, r]));
      for (const r of fresh) { const o = old.get(r.tid); if (o) { r.complaints = r.complaints || o.complaints || ''; r.diagnosis = r.diagnosis || o.diagnosis || ''; } }
      rows = fresh;
      await store.set('pjRows', rows);
      log(`Loaded ${rows.length} TIDs from ${f.name}.` + (fresh.skipped ? ` ${fresh.skipped} row(s) skipped - TID missing or wrong.` : ''));
      toast(`📄 ${rows.length} claims loaded from ${f.name}` + (fresh.skipped ? ` · ${fresh.skipped} skipped` : ''), fresh.skipped ? 'warn' : '');
      const numTid = rows.filter((r) => (r.notes || []).some((n) => /saved as a number/.test(n))).length;
      if (numTid) toast(`⚠ ${numTid} TID(s) were numbers in Excel — the last digit may be wrong. Format the TID column as Text.`, 'bad');
    } catch (err) {
      log('ERROR: ' + err.message);
      toast(err.message, 'bad');
    }
    inp.value = '';
    render();
  };
  function nextRow() {
    return rows.find((x) => !['Done', 'Ready', 'Check'].includes(stOf(x)) && x.tid !== currentTid)
      || rows.find((x) => !['Done', 'Ready'].includes(stOf(x)) && x.tid !== currentTid)
      || rows.find((x) => !['Done'].includes(stOf(x)) && x.tid !== currentTid);
  }
  q('[data-a=next]').onclick = () => {
    if (busy) return;
    const r = nextRow();
    if (!r) { log('No pending TID in the list.'); toast(rows.length ? '🎉 Nothing pending — all done!' : 'Load claims first.', rows.length ? '' : 'info'); return; }
    fillRow(r);
  };
  q('[data-a=text]').onclick = () => {
    const r = rows.find((x) => needsText(x) && stOf(x) !== 'Done');
    if (!r) { log('All claims already have chief complaints and diagnosis.'); toast(rows.length ? '✔ Every claim already has its text' : 'Load claims first.', rows.length ? '' : 'info'); return; }
    openEditor(r);
  };
  q('[data-a=clear]').onclick = async () => {
    if (!confirm('Clear the TID list and status?')) return;
    rows = []; status = {}; currentTid = null;
    await store.set('pjRows', rows); await store.set('pjStatus', status);
    try { await ScanDB.clear(); } catch (e) { /* ignore */ }
    if (!dirHandle) scanFiles = [];
    showWarn([]);
    render();
  };
  q('[data-a=report]').onclick = () => {
    if (!rows.length) { toast('No claims to report.', 'info'); return; }
    const aoa = [['TID', 'Patient', 'Doctor', 'Package Codes', 'Bill', 'Status', 'Message', 'Updated']].concat(rows.map((r) => [
      r.tid, r.patient || '', r.doctor || '', (r.packages || []).join('; '), r.bill || '', stOf(r), status[r.tid]?.msg || '',
      status[r.tid]?.at ? new Date(status[r.tid].at).toLocaleString('en-IN') : '']));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 18 }, { wch: 24 }, { wch: 22 }, { wch: 22 }, { wch: 8 }, { wch: 9 }, { wch: 60 }, { wch: 20 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Claims');
    XLSX.writeFile(wb, `RGHS-OPD-claims-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast('⬇ Status report downloaded');
  };
  q('[data-a=template]').onclick = () => {
    const H = ['TID', 'Patient Name', 'Speciality', 'Doctor', 'RMC No', 'RMC Type', 'Doctor Speciality', 'Package Codes', 'Prescription Date', 'Validity Days',
      'Chief Complaints', 'Diagnosis', 'Bill Amount', 'Discount', 'Match Key', 'Prescription File', 'Investigation File', 'Bill File', 'Diagnosis File'];
    const ws = XLSX.utils.aoa_to_sheet([H]);
    ws['!cols'] = H.map((h) => ({ wch: Math.max(12, h.length + 2) }));
    // TID as text so Excel does not round 16-digit numbers
    for (let r = 1; r < 500; r++) ws[XLSX.utils.encode_cell({ r, c: 0 })] = { t: 's', v: '', z: '@' };
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 499, c: H.length - 1 } });
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'OPD Claims');
    XLSX.writeFile(wb, 'RGHS-OPD-claims-template.xlsx');
  };

  // ---------- complaints / diagnosis editor ----------
  let editing = null;
  let phrases = { cc: [], dg: [] };
  function fillPicks() {
    for (const [k, sel] of [['cc', q('.qcc')], ['dg', q('.qdg')]]) {
      sel.innerHTML = '<option value="">⚡ Quick pick from earlier...</option>'
        + [...new Set(phrases[k])].sort().map((t) => `<option>${esc(t)}</option>`).join('');
    }
  }
  const counters = () => { q('.ccn').textContent = `${q('.ecc').value.length}/250`; q('.dgn').textContent = `${q('.edg').value.length}/250`; };
  q('.ecc').oninput = counters; q('.edg').oninput = counters;
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
  function closeEditor() { q('.ed').classList.remove('on'); editing = null; closeViewer(); }
  q('.vx').onclick = closeViewer;

  async function openEditor(r) {
    editing = r;
    q('.ed').classList.add('on');
    q('.ecc').value = r.complaints || '';
    q('.edg').value = r.diagnosis || '';
    counters();
    const left = rows.filter(needsText).length;
    q('.etid').textContent = `${r.patient || 'TID ' + r.tid} · ${r.tid}` + (left ? ` · ${left} left` : '');
    fillPicks();
    // buttons for this patient's scanned files; the slip opens on its own
    if (dirHandle && folderState === 'ready') await readFolder(true);
    const map = filesForRow(r);
    const list = UPLOAD_SLOTS.filter((s) => map[s.id]).map((s) => ({ slot: s, f: map[s.id] }));
    const box = q('.docs');
    box.innerHTML = '';
    if (!list.length) {
      box.innerHTML = `<span class="hint">${scanFiles.length ? 'No scanned file found for this patient.' : 'Choose the scan folder to see the slip here.'}</span>`;
      closeViewer();
    } else {
      for (const { slot, f } of list) {
        const b = document.createElement('button');
        b.className = 'btn sm'; b.textContent = '📄 ' + slot.title.split(' / ')[0]; b.title = f.name;
        b.onclick = () => { box.querySelectorAll('.btn').forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); showDoc(f, `${r.patient || r.tid} - ${f.name}`); };
        box.appendChild(b);
      }
      const first = list.find((x) => x.slot.id === 'doctorprescription') || list[0];
      box.querySelector('.btn').classList.add('sel');
      await showDoc(first.f, `${r.patient || r.tid} - ${first.f.name}`);
    }
    q('.ecc').focus();
  }
  q('.qcc').onchange = (e) => { if (e.target.value) q('.ecc').value = e.target.value; e.target.value = ''; counters(); };
  q('.qdg').onchange = (e) => { if (e.target.value) q('.edg').value = e.target.value; e.target.value = ''; counters(); };
  q('[data-a=close]').onclick = closeEditor;
  async function saveText() {
    if (!editing) return null;
    const r = editing;
    r.complaints = q('.ecc').value.trim();
    r.diagnosis = q('.edg').value.trim();
    for (const [k, v] of [['cc', r.complaints], ['dg', r.diagnosis]]) if (v && !phrases[k].includes(v)) phrases[k].unshift(v);
    phrases.cc = phrases.cc.slice(0, 80); phrases.dg = phrases.dg.slice(0, 80);
    await store.set('pjRows', rows); await store.set('pjPhrases', phrases);
    log(`Saved text for ${r.tid}.`);
    render();
    return r;
  }
  q('[data-a=saveonly]').onclick = async () => {
    if (!await saveText()) return;
    closeEditor();
    toast('✔ Text saved');
  };
  // Save and move straight to the next claim that still needs text - no extra clicks.
  q('[data-a=save]').onclick = async () => {
    const r = await saveText(); if (!r) return;
    const i = rows.indexOf(r);
    const want = (x) => needsText(x) && stOf(x) !== 'Done';
    const next = rows.slice(i + 1).find(want) || rows.find((x) => x !== r && want(x));
    if (next) { await openEditor(next); return; }
    closeEditor();
    log('All claims have chief complaints and diagnosis.');
    toast('🎉 Text done for every claim. Now press "Fill next TID".');
    celebrate(40);
  };

  q('[data-a=hospedia]').onclick = async () => {
    const list = (await store.get('pjRows')) || [];
    if (!list.length) {
      log('Nothing from Hospedia yet. Open the Hospedia report and press the blue "PJ Make RGHS claim list" button there.');
      toast('Nothing from Hospedia yet. Open the Hospedia report and press "Make RGHS claim list" there.', 'info');
      return;
    }
    rows = list;
    const n = rows.filter((r) => r.source === 'hospedia').length;
    log(`Loaded ${rows.length} claims (${n} from Hospedia).`);
    toast(`⬇ ${rows.length} claims loaded`);
    render();
  };

  // ---------- keyboard ----------
  const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test((e.composedPath()[0] || {}).tagName || '');
  addEventListener('keydown', (e) => {
    if (host.style.display === 'none') return;
    if (e.altKey && !e.ctrlKey && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); q('[data-a=next]').click(); }
    else if (e.altKey && !e.ctrlKey && (e.key === 't' || e.key === 'T')) { e.preventDefault(); q('[data-a=text]').click(); }
    else if (e.altKey && !e.ctrlKey && (e.key === 'm' || e.key === 'M')) { e.preventDefault(); q('.mn').click(); }
    else if (editing && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); q('[data-a=save]').click(); }
    else if (editing && e.key === 'Escape') { e.preventDefault(); closeEditor(); }
    else if (e.key === '/' && !typing(e) && !editing) { e.preventDefault(); q('.srch').focus(); }
  }, true);

  // Drag (panel and document viewer)
  function draggable(handle, box, key) {
    let sx, sy, ox, oy;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      const r = box.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      const mv = (ev) => {
        box.style.left = Math.min(innerWidth - 80, Math.max(0, ox + ev.clientX - sx)) + 'px';
        box.style.top = Math.min(innerHeight - 40, Math.max(0, oy + ev.clientY - sy)) + 'px';
        box.style.right = 'auto'; box.style.bottom = 'auto';
      };
      const up = () => {
        removeEventListener('mousemove', mv); removeEventListener('mouseup', up);
        if (key) store.set(key, { left: box.style.left, top: box.style.top });
      };
      addEventListener('mousemove', mv); addEventListener('mouseup', up);
    });
  }
  draggable(q('.hd'), panel, 'pjPos');
  draggable(q('.vh'), q('.vw'));

  chrome.runtime.onMessage.addListener((m) => {
    if (m?.type === 'PJ_TOGGLE_PANEL') host.style.display = host.style.display === 'none' ? '' : 'none';
  });
  // a new list made on the Hospedia tab shows up here without a reload
  chrome.storage.onChanged?.addListener((ch, area) => {
    if (area === 'local' && ch.pjFromHospedia && !busy) {
      toast('⬇ New claim list from Hospedia — press "⬇ Hospedia" to load it.', 'info');
    }
  });

  // Load saved state; resume if the page reloaded during a TID search.
  (async () => {
    rows = (await store.get('pjRows')) || [];
    status = (await store.get('pjStatus')) || {};
    phrases = (await store.get('pjPhrases')) || { cc: [], dg: [] };
    folderName = (await store.get('pjFolderName')) || '';
    const pos = await store.get('pjPos');
    if (pos && parseInt(pos.left) < innerWidth - 80 && parseInt(pos.top) < innerHeight - 40) {
      Object.assign(panel.style, { left: pos.left, top: pos.top, right: 'auto', bottom: 'auto' });
    }
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
    if (await store.get('pjMin')) { panel.classList.add('min'); q('.mn').textContent = '▢'; }
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
