// PJ Auto OPD Claim - Hospedia side. Adds a button on the report page that turns
// "Panel Wise Invoice Summary" (scheme RGHS NEW) into ready claim rows.
(() => {
  if (window.__pjHospedia) { window.__pjHospedia(); return; }

  function reportTable() {
    return [...document.querySelectorAll('table')].reverse().find((t) => {
      const head = t.tHead || t.rows[0];
      if (!head) return false;
      const txt = head.innerText.toUpperCase();
      return /\bTID\b/.test(txt) && /ITEM\s*NAME/.test(txt);
    });
  }
  function toast(msg, bad) {
    let el = document.getElementById('pj-hos-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pj-hos-toast';
      el.style.cssText = 'position:fixed;right:18px;bottom:76px;z-index:2147483647;max-width:360px;padding:10px 14px;border-radius:10px;color:#fff;font:13px/1.45 "Segoe UI",Arial,sans-serif;box-shadow:0 8px 24px rgba(15,23,42,.3)';
      document.body.appendChild(el);
    }
    el.style.background = bad ? '#dc2626' : '#16a34a';
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.style.display = 'none'), 9000);
  }
  function addButton() {
    if (document.getElementById('pj-hos-btn')) return;
    const b = document.createElement('button');
    b.id = 'pj-hos-btn';
    b.type = 'button';
    b.innerHTML = '<span style="display:inline-grid;place-items:center;width:22px;height:22px;border-radius:7px;background:#fff;color:#4f46e5;font-weight:800;font-size:11px;margin-right:8px">PJ</span>Make RGHS claim list';
    b.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;display:flex;align-items:center;padding:9px 15px;border:0;border-radius:24px;background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;font:600 13px "Segoe UI",Arial,sans-serif;cursor:pointer;box-shadow:0 8px 22px rgba(79,70,229,.35)';
    b.onclick = () => {
      const t = reportTable();
      if (!t) {
        toast('Report table not found. Choose Panel Wise Invoice Summary, scheme RGHS NEW, Panel Business Detailed, set the dates and press VIEW ON SCREEN. Then press this button again.', true);
        return;
      }
      const rows = [...t.rows].map((r) => [...r.cells].map((c) => c.innerText.replace(/\s+/g, ' ').trim()));
      if (rows.length < 2) { toast('The report has no rows for these dates.', true); return; }
      b.disabled = true;
      chrome.runtime.sendMessage({ type: 'PJ_HOSPEDIA_ROWS', rows }, (resp) => {
        b.disabled = false;
        if (chrome.runtime.lastError || !resp) { toast('Could not reach the extension. Reload this page and try again.', true); return; }
        if (resp.error) { toast(resp.error, true); return; }
        toast(`${resp.count} claims ready. Open the RGHS OPD page and press "Load from Hospedia" in the PJ panel.${resp.noTid ? ' ' + resp.noTid + ' billed row(s) had no TID and were left out.' : ''}`);
      });
    };
    document.body.appendChild(b);
  }
  function update() {
    if (reportTable() || /report/i.test(location.pathname + location.hash)) addButton();
  }
  window.__pjHospedia = update;
  update();
  new MutationObserver(() => { clearTimeout(window.__pjHT); window.__pjHT = setTimeout(update, 400); })
    .observe(document.documentElement, { childList: true, subtree: true });
})();
