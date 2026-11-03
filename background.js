// Service worker: toolbar icon, and turning a Hospedia report into claim rows.
importScripts('engine.js');

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
function toRow(c) {
  return {
    tid: c.tid,
    patient: c.patient,
    speciality: c.speciality,
    otherSpeciality: /any other/i.test(c.speciality || '') ? (c.docSpeciality || '') : '',
    doctor: c.doctor,
    rmcNo: c.rmc,
    rmcType: c.rmcType,
    docSpeciality: c.docSpeciality,
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'PJ_HOSPEDIA_ROWS') {
    (async () => {
      try {
        const { CODES, DOCTORS } = await data();
        const items = ClaimEngine.parseRows(msg.rows);
        const claims = ClaimEngine.buildClaims(items, { codes: CODES, doctors: DOCTORS, learned: {}, settings: {} });
        const rows = claims.map(toRow);
        const st = await chrome.storage.local.get(['pjRows', 'pjStatus']);
        const old = st.pjRows || [];
        // keep what the user already typed for a TID that is loaded again
        const byTid = new Map(old.map((r) => [r.tid, r]));
        for (const r of rows) {
          const o = byTid.get(r.tid);
          if (o) { r.complaints = o.complaints || r.complaints; r.diagnosis = o.diagnosis || r.diagnosis; }
        }
        const merged = rows.concat(old.filter((r) => !rows.some((n) => n.tid === r.tid)));
        await chrome.storage.local.set({ pjRows: merged, pjFromHospedia: Date.now() });
        sendResponse({ count: rows.length, noTid: (claims.noTid || []).length });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'PJ_TOGGLE_PANEL' });
  } catch (e) {
    chrome.tabs.update(tab.id, { url: 'https://rghs.rajasthan.gov.in/RGHS/tmsOPDDetails' });
  }
});
