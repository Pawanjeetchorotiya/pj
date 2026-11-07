/* PJ RGHS Suite - background service worker
   - Hospedia report -> OPD claim rows (for the claim filler) and bill breakdown (for the daily sheet)
   - RGHS tracker / payment rows -> saved per month for the daily sheet
   - upload list, toolbar badge, daily notification */
try { importScripts('shared.js', 'engine.js', 'sheet.js'); } catch (e) { /* ignore */ }
const PJ = self.PJ;
const DS = self.DailySheet;

/* All storage changes go through one queue so tabs cannot overwrite each other */
let chain = Promise.resolve();
function queue(fn) {
  const p = chain.then(() => fn());
  chain = p.catch(() => {});
  return p.catch((e) => ({ error: String(e && e.message || e) }));
}

/* ================= OPD claim maker (Hospedia -> claim rows) ================= */
let CODES = null, DOCTORS = null;
async function data() {
  if (!CODES) CODES = await (await fetch(chrome.runtime.getURL('data/codes.json'))).json();
  if (!DOCTORS) {
    const saved = (await chrome.storage.local.get('pjDoctors')).pjDoctors;
    DOCTORS = (saved && saved.length) ? saved : await (await fetch(chrome.runtime.getURL('data/doctors.json'))).json();
  }
  return { CODES, DOCTORS };
}

// engine claim -> the row shape the RGHS panel fills
// "Any Other Speciality" needs the real speciality typed in; the doctor's department is the best we have.
const SPEC_NAME = { 'obs & gynae': 'Obstetrics and Gynaecology', derma: 'Dermatology', ophthal: 'Ophthalmology', orthopedic: 'Orthopaedics',
  paediatrician: 'Paediatrics', anesthesia: 'Anaesthesiology', anesthesiology: 'Anaesthesiology', pathology: 'Pathology', radiology: 'Radiology' };
const deptName = (d) => { const k = String(d || '').trim(); return SPEC_NAME[k.toLowerCase()] || k.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()); };
function toRow(c) {
  const other = /any other/i.test(c.speciality || '');
  return {
    tid: c.tid,
    patient: c.patient,
    speciality: c.speciality,
    otherSpeciality: other ? deptName(c.dept) : '',
    doctor: c.doctor,
    rmcNo: c.rmc,
    rmcType: c.rmcType,
    docSpeciality: other ? deptName(c.dept) : c.docSpeciality,
    packages: String(c.codes || '').split(/[;,]/).map((x) => x.trim()).filter(Boolean),
    prescDate: c.prescDate,
    validity: String(c.validity || 15),
    complaints: c.complaints || '',
    diagnosis: c.diagnosis || '',
    bill: String(c.bill || ''),
    discount: String(c.discount || 0),
    matchKey: c.mr || '',
    notes: c.notes || [],
    preAuth: c.preAuth || '',
    source: 'hospedia',
  };
}

async function makeClaims(rows2d) {
  const { CODES, DOCTORS } = await data();
  const items = ClaimEngine.parseRows(rows2d);
  const claims = ClaimEngine.buildClaims(items, { codes: CODES, doctors: DOCTORS, learned: {}, settings: {} });
  const rows = claims.map(toRow);
  const st = await chrome.storage.local.get(['pjRows']);
  const old = st.pjRows || [];
  // keep what the user already typed for a TID that is loaded again
  const byTid = new Map(old.map((r) => [r.tid, r]));
  for (const r of rows) {
    const o = byTid.get(r.tid);
    if (o) { r.complaints = o.complaints || r.complaints; r.diagnosis = o.diagnosis || r.diagnosis; }
  }
  const merged = rows.concat(old.filter((r) => !rows.some((n) => n.tid === r.tid)));
  await chrome.storage.local.set({ pjRows: merged, pjFromHospedia: Date.now() });
  const saved = await saveHospedia(items);
  const by = (k) => claims.filter((c) => c.status === k).length;
  return { count: rows.length, noTid: (claims.noTid || []).length, ready: by('ready'), check: by('check'), stop: by('stop'),
    preAuth: claims.filter((c) => c.preAuth).length, noDoctor: claims.filter((c) => !c.doctorFound).length, sheet: saved.count };
}

/* ================= daily sheet store ================= */
// r:YYYY-MM = RGHS records, h:YYYY-MM = Hospedia bills, p:YYYY-MM = payments (layout in sheet.js makeStore)
const store = DS.makeStore({
  get: async (k) => (await chrome.storage.local.get(k))[k],
  set: (k, v) => chrome.storage.local.set({ [k]: v })
});
const saveHospedia = (items) => store.saveHospedia(DS.hospediaSummary(items));

/* ================= upload list ================= */
async function syncUploads(add, remove) {
  const r = await PJ.get('uploads');
  const uploads = Object.assign({}, r.uploads || {});
  const before = JSON.stringify(uploads);
  (add || []).forEach(a => {
    if (!a || !a.tid) return;
    const tid = String(a.tid).trim();
    const ex = uploads[tid] || { tid, addedAt: Date.now() };
    const next = Object.assign({}, ex);
    ['name', 'dept', 'date', 'dateRaw', 'status', 'source'].forEach(k => { if (a[k]) next[k] = a[k]; });
    if (Number(a.amount) > 0 || next.amount == null) next.amount = Number(a.amount) || 0;
    if (!next.dept) next.dept = 'OTHER';
    uploads[tid] = next;
  });
  (remove || []).forEach(t => { delete uploads[String(t).trim()]; });
  if (JSON.stringify(uploads) !== before) await PJ.set({ uploads });
  return uploads;
}

async function removeUploads(tids) {
  const r = await PJ.get('uploads');
  const uploads = Object.assign({}, r.uploads || {});
  let changed = false;
  (tids || []).forEach(t => { if (uploads[t]) { delete uploads[t]; changed = true; } });
  if (changed) await PJ.set({ uploads });
}

async function badgeCount() {
  const r = await PJ.get(['uploads', 'settings']);
  const s = Object.assign({}, PJ.DEFAULTS, r.settings || {});
  if (!s.alertBadge) return 0;
  return PJ.scopeUploads(r.uploads || {}, { scope: s.tickerScope === 'all' ? 'all' : 'month' }).length;
}

async function updateBadge() {
  try {
    const n = await badgeCount();
    await chrome.action.setBadgeText({ text: n > 0 ? String(n > 99 ? '99+' : n) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
    try { await chrome.action.setBadgeTextColor({ color: '#ffffff' }); } catch (e) { /* older Chrome */ }
    await chrome.action.setTitle({ title: n > 0 ? 'PJ RGHS Suite - ' + n + ' TID' + (n > 1 ? 's' : '') + ' to upload' : 'PJ RGHS Suite' });
  } catch (e) { /* ignore */ }
}

/* Toolbar icon follows the logo style chosen in Settings */
let lastIconStyle = '';
async function updateIcon() {
  try {
    const r = await PJ.get('settings');
    const st = (r.settings && r.settings.logo) || PJ.DEFAULTS.logo;
    if (st === lastIconStyle) return;
    const pre = st === 'aurora' ? 'icons/aurora' : st === 'care' ? 'icons/care' : 'icons/icon';
    await chrome.action.setIcon({ path: { 16: pre + '16.png', 32: pre + '32.png', 48: pre + '48.png', 128: pre + '128.png' } });
    lastIconStyle = st;
  } catch (e) { /* ignore */ }
}
function iconFile() {
  const st = lastIconStyle || PJ.DEFAULTS.logo;
  return st === 'aurora' ? 'icons/aurora128.png' : st === 'care' ? 'icons/care128.png' : 'icons/icon128.png';
}

async function maybeDailyNotice() {
  try {
    const r = await PJ.get(['settings', 'snapshot', 'uploads', 'lastDailyNotice']);
    const s = Object.assign({}, PJ.DEFAULTS, r.settings || {});
    if (!s.alertDaily) return;
    const today = PJ.todayISO();
    if (r.lastDailyNotice === today) return;
    const ms = PJ.monthStats(r.snapshot);
    const ups = PJ.scopeUploads(r.uploads || {}, { scope: s.tickerScope === 'all' ? 'all' : 'month' });
    if (!r.snapshot && !ups.length) return;
    if (!PJ.hasNotice(ms.stats, ups.length)) return; // nothing to tell today
    const st = ms.stats;
    const line = d => PJ.DEPT_LABEL[d] + ': ' + PJ.fmt(st[d].claimed) + ' claimed, ' + PJ.fmt(st[d].pending) + ' pending';
    const extra = [];
    extra.push(ups.length ? ups.length + ' TID' + (ups.length > 1 ? 's' : '') + ' to upload' : 'No TIDs to upload');
    if (st.ALL.c.query) extra.push('Query ' + st.ALL.c.query);
    if (st.ALL.c.rejected) extra.push('Rejected ' + st.ALL.c.rejected);
    await chrome.notifications.create('pj-daily-' + Date.now(), {
      type: 'basic',
      iconUrl: iconFile(),
      title: 'RGHS Claim Status · ' + PJ.monthLabel(),
      message: PJ.DEPTS.map(line).join('\n'),
      contextMessage: extra.join(' · '),
      priority: 1
    });
    await PJ.set({ lastDailyNotice: today });
  } catch (e) { /* ignore */ }
}

async function openUrlTab(url) {
  try {
    const tabs = await chrome.tabs.query({ url: url.split('?')[0] + '*' });
    if (tabs && tabs.length) {
      await chrome.tabs.update(tabs[0].id, { active: true });
      try { await chrome.windows.update(tabs[0].windowId, { focused: true }); } catch (e) { /* ignore */ }
    } else await chrome.tabs.create({ url });
  } catch (e) { /* ignore */ }
}
async function openTracker() {
  try {
    const r = await PJ.get('trackerUrl');
    const url = r.trackerUrl || PJ.TRACKER_URL;
    const tabs = await chrome.tabs.query({ url: 'https://rghs.rajasthan.gov.in/*' });
    if (tabs && tabs.length) {
      const t = tabs[0];
      await chrome.tabs.update(t.id, { url, active: true });
      try { await chrome.windows.update(t.windowId, { focused: true }); } catch (e) { /* ignore */ }
    } else {
      await chrome.tabs.create({ url });
    }
  } catch (e) { /* ignore */ }
}

try {
  chrome.runtime.onInstalled.addListener(async () => {
    const s = await PJ.getSettings();
    await PJ.set({ settings: s });
    updateBadge(); updateIcon();
  });
  chrome.runtime.onStartup.addListener(() => { updateBadge(); updateIcon(); });

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && (ch.uploads || ch.settings)) updateBadge();
    if (area === 'local' && ch.settings) updateIcon();
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'PJ_HOSPEDIA_ROWS':
        queue(() => makeClaims(msg.rows)).then((r) => sendResponse(r || { error: 'failed' }));
        return true;
      case 'hospedia:put':
        queue(() => saveHospedia(ClaimEngine.parseRows(msg.rows))).then((r) => sendResponse(r));
        return true;
      case 'hospedia:putSum':
        queue(() => store.saveHospedia(msg.hospedia || {})).then((r) => sendResponse(r));
        return true;
      case 'month:clear':
        queue(() => store.clearMonth(msg.month)).then(() => sendResponse({ ok: true }));
        return true;
      case 'records:put':
        queue(() => store.saveRecords(msg.records || [])).then((r) => sendResponse(r));
        return true;
      case 'payments:put':
        queue(() => store.savePayments(msg.payments || {})).then((r) => sendResponse(r));
        return true;
      case 'uploads:sync':
        queue(() => syncUploads(msg.add, msg.remove)).then(() => sendResponse({ ok: true }));
        return true;
      case 'uploads:done':
        queue(() => removeUploads(msg.tids || [])).then(() => sendResponse({ ok: true }));
        return true;
      case 'portal:opened':
        updateBadge();
        maybeDailyNotice();
        sendResponse({ ok: true });
        return;
      case 'open:tracker':
        openTracker();
        sendResponse({ ok: true });
        return;
      case 'open:report':
        openUrlTab(chrome.runtime.getURL('app/index.html'));
        sendResponse({ ok: true });
        return;
    }
  });

  chrome.notifications.onClicked.addListener(id => {
    if (String(id).indexOf('pj-daily') === 0) {
      openTracker();
      try { chrome.notifications.clear(id); } catch (e) { /* ignore */ }
    }
  });
} catch (e) { /* ignore */ }

updateBadge();
updateIcon();
