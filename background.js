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
    hospBill: c.bill,
    cat: ClaimEngine.categorize(c.lines),
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
        // the claim register (for the Excel export) keeps every TID, even after the list is cleared
        const reg = (await chrome.storage.local.get('pjRegister')).pjRegister || {};
        for (const r of rows) {
          reg[r.tid] = Object.assign(reg[r.tid] || {}, {
            tid: r.tid, patient: r.patient, prescDate: r.prescDate, hospBill: r.hospBill, cat: r.cat,
            doctor: (reg[r.tid] && reg[r.tid].doctorVerified) ? reg[r.tid].doctor : r.doctor, mr: r.matchKey, updated: Date.now(),
          });
        }
        await chrome.storage.local.set({ pjRows: merged, pjRegister: reg, pjFromHospedia: Date.now() });
        const by = (k) => claims.filter((c) => c.status === k).length;
        sendResponse({ count: rows.length, noTid: (claims.noTid || []).length, ready: by('ready'), check: by('check'), stop: by('stop'),
          preAuth: claims.filter((c) => c.preAuth).length, noDoctor: claims.filter((c) => !c.doctorFound).length });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }
});

const RGHS_URL = 'https://rghs.rajasthan.gov.in/RGHS/tmsOPDDetails';
// Toolbar icon: show / hide the panel on the RGHS page (or run the list maker on Hospedia).
// On any other tab it switches to the RGHS tab, or opens one - it never replaces the page you are on.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'PJ_TOGGLE_PANEL' });
  } catch (e) {
    const [t] = await chrome.tabs.query({ url: RGHS_URL + '*' }).catch(() => []);
    if (t) {
      await chrome.tabs.update(t.id, { active: true });
      chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
    } else {
      chrome.tabs.create({ url: RGHS_URL, index: tab.index + 1 });
    }
  }
});
