# Tests

Both tests need Node and Playwright with Chromium.

- `node tests/e2e.js [--shots]` runs `content.js` on a mock RGHS OPD page (`mock-rghs.html`).
  It covers filling, page-reload resume, uploads, bad codes, an unknown doctor, "Any Other" speciality,
  and marking a claim Done after the user submits. It also checks that SAVE / FINAL are never pressed.
- `node tests/hospedia-e2e.js [--shots]` runs a mock Hospedia report through `hospedia.js`, `background.js`
  and `engine.js`, then checks the claim rows.

Screenshots and the result go to `$PJ_OUT` (default: `<tmp>/pj-e2e`).
`fixtures/` holds the sheets and results from the earlier version (v3.1) for reference.
