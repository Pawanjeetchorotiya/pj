// PJ Auto OPD Claim - Hospedia side. Adds a button on the report page that turns
// "Panel Wise Invoice Summary" (scheme RGHS NEW) into ready claim rows.
(() => {
  if (window.__pjHospedia) { window.__pjHospedia(); return; }
  const RGHS_URL = 'https://rghs.rajasthan.gov.in/RGHS/tmsOPDDetails';

  function reportTable() {
    return [...document.querySelectorAll('table')].reverse().find((t) => {
      const head = t.tHead || t.rows[0];
      if (!head) return false;
      const txt = head.innerText.toUpperCase();
      return /\bTID\b/.test(txt) && /ITEM\s*NAME/.test(txt);
    });
  }

  // Everything lives in a shadow root so the Hospedia page styles cannot break it.
  let ui = null;
  function mount() {
    if (ui) return ui;
    const host = document.createElement('div');
    host.id = 'pj-hos';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
    <style>
      :host{all:initial}
      *{box-sizing:border-box}
      .w{--card:#fff;--ink:#0f172a;--mute:#64748b;--line:#e2e8f0;--soft:#f1f5f9;
        position:fixed;right:18px;bottom:18px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;gap:10px;
        font:13px/1.45 "Segoe UI",system-ui,Arial,sans-serif;color:var(--ink)}
      @media (prefers-color-scheme: dark){.w{--card:#1e293b;--ink:#e2e8f0;--mute:#94a3b8;--line:#334155;--soft:#0f172a}}
      .btn{display:flex;align-items:center;gap:9px;padding:10px 18px 10px 10px;border:0;border-radius:99px;color:#fff;cursor:pointer;
        font:600 13.5px inherit;background:linear-gradient(135deg,#0ea5e9,#6366f1 55%,#8b5cf6);box-shadow:0 10px 26px rgba(79,70,229,.4);transition:.15s}
      .btn:hover{transform:translateY(-2px);box-shadow:0 14px 30px rgba(79,70,229,.5)}
      .btn:disabled{opacity:.7;cursor:progress;transform:none}
      .lg{width:28px;height:28px;border-radius:50%;background:#fff;color:#4f46e5;display:grid;place-items:center;font-weight:800;font-size:11px}
      .sp{width:16px;height:16px;border:2.5px solid #fff;border-right-color:transparent;border-radius:50%;animation:s .8s linear infinite;display:none}
      .busy .sp{display:block}.busy .lg{display:none}
      @keyframes s{to{transform:rotate(360deg)}}
      .card{width:340px;background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:0 18px 44px rgba(15,23,42,.28);overflow:hidden;display:none;animation:p .25s ease-out}
      .card.on{display:block}
      @keyframes p{from{transform:translateY(10px);opacity:0}to{transform:none;opacity:1}}
      .ch{padding:12px 14px;color:#fff;background:linear-gradient(135deg,#16a34a,#22c55e);display:flex;align-items:center;gap:10px}
      .card.bad .ch{background:linear-gradient(135deg,#dc2626,#f97316)}
      .ch b{flex:1;font-size:14px}
      .x{background:rgba(255,255,255,.22);border:0;color:#fff;border-radius:8px;width:26px;height:26px;cursor:pointer}
      .cb{padding:12px 14px;display:flex;flex-direction:column;gap:10px}
      .big{font-size:30px;font-weight:800;line-height:1}
      .big small{font-size:13px;font-weight:600;color:var(--mute);margin-left:6px}
      .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
      .st{background:var(--soft);border-radius:10px;padding:7px;text-align:center}
      .st b{display:block;font-size:17px}.st span{font-size:11px;color:var(--mute)}
      .st.g b{color:#16a34a}.st.a b{color:#d97706}.st.r b{color:#dc2626}
      ul{margin:0;padding-left:18px;font-size:12px;color:var(--mute)}
      .go{display:block;text-align:center;text-decoration:none;color:#fff;font-weight:700;padding:10px;border-radius:12px;background:linear-gradient(135deg,#0ea5e9,#6366f1)}
      .msg{font-size:12.5px}
    </style>
    <div class="w">
      <div class="card" role="status" aria-live="polite">
        <div class="ch"><b class="ct"></b><button class="x" aria-label="Close">✕</button></div>
        <div class="cb"></div>
      </div>
      <button class="btn" type="button" title="Turn this report into the RGHS claim list"><span class="lg">PJ</span><span class="sp"></span><span class="bt">Make RGHS claim list</span></button>
    </div>`;
    document.body.appendChild(host);
    const q = (s) => root.querySelector(s);
    q('.x').onclick = () => q('.card').classList.remove('on');
    q('.btn').onclick = makeList;
    ui = { host, q };
    return ui;
  }
  function show(title, html, bad) {
    const { q } = mount();
    q('.card').classList.toggle('bad', !!bad);
    q('.ct').textContent = title;
    q('.cb').innerHTML = html;
    q('.card').classList.add('on');
    clearTimeout(ui.t);
    if (bad) ui.t = setTimeout(() => q('.card').classList.remove('on'), 12000);
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function makeList() {
    const { q } = mount();
    const t = reportTable();
    if (!t) {
      show('Report not found', '<div class="msg">Choose <b>Panel Wise Invoice Summary</b> → scheme <b>RGHS NEW</b> → <b>Panel Business Detailed</b>, set the dates and press <b>VIEW ON SCREEN</b>. Then press this button again.</div>', true);
      return;
    }
    const rows = [...t.rows].map((r) => [...r.cells].map((c) => c.innerText.replace(/\s+/g, ' ').trim()));
    if (rows.length < 2) { show('No rows', '<div class="msg">The report has no rows for these dates.</div>', true); return; }
    const b = q('.btn');
    b.disabled = true; b.classList.add('busy'); q('.bt').textContent = 'Making the list...';
    chrome.runtime.sendMessage({ type: 'PJ_HOSPEDIA_ROWS', rows }, (resp) => {
      b.disabled = false; b.classList.remove('busy'); q('.bt').textContent = 'Make RGHS claim list';
      if (chrome.runtime.lastError || !resp) { show('Extension not reachable', '<div class="msg">Reload this page and try again.</div>', true); return; }
      if (resp.error) { show('Could not read the report', `<div class="msg">${esc(resp.error)}</div>`, true); return; }
      const notes = [];
      if (resp.noTid) notes.push(`${resp.noTid} billed row(s) had no TID and were left out.`);
      if (resp.noDoctor) notes.push(`${resp.noDoctor} claim(s): doctor not in your doctor list.`);
      if (resp.preAuth) notes.push(`${resp.preAuth} claim(s) need PRE-AUTH (investigations over ₹2000 or 2+ CT/MRI).`);
      show('Claim list ready ✔', `
        <div class="big">${resp.count}<small>claims made</small></div>
        <div class="grid">
          <div class="st g"><b>${resp.ready ?? '-'}</b><span>ready</span></div>
          <div class="st a"><b>${resp.check ?? '-'}</b><span>to check</span></div>
          <div class="st r"><b>${resp.stop ?? '-'}</b><span>need you</span></div>
        </div>
        ${notes.length ? `<ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        <a class="go" href="${RGHS_URL}" target="_blank" rel="noopener">Open RGHS portal →</a>
        <div class="msg" style="color:var(--mute);font-size:11.5px">On the RGHS page press <b>⬇ Hospedia</b> in the PJ panel.</div>`);
    });
  }
  function update() {
    if (reportTable() || /report/i.test(location.pathname + location.hash)) mount();
  }
  // toolbar icon on the Hospedia tab = make the list
  chrome.runtime.onMessage.addListener((m, s, reply) => {
    if (m?.type === 'PJ_TOGGLE_PANEL') { makeList(); reply({ ok: true }); }
  });
  window.__pjHospedia = update;
  update();
  new MutationObserver(() => { clearTimeout(window.__pjHT); window.__pjHT = setTimeout(update, 400); })
    .observe(document.documentElement, { childList: true, subtree: true });
})();
