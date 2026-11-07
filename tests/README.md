# Tests

All tests use synthetic data (no real patients). Browser tests need Node and Playwright with Chromium.

| Test | What it covers |
|---|---|
| `node tests/sheet-test.js` | `sheet.js`: dates, Hospedia item -> column, month build, Excel cells/formulas, storage merge, payments. Set `PJ_REAL_SHEET=/path/to/a/real/month.xlsx` to also round-trip a real hand-made month sheet cell by cell (never commit that file). |
| `node tests/suite-e2e.js [--shots]` | Loads the whole unpacked extension in Chromium: tmsBisTrack1 DataTable (3 pages), Payment Tracker, Hospedia report, Daily sheet page, downloaded Excel checked cell by cell, pop-up, OPD page, no console errors. |
| `node tests/mobile-e2e.js [--shots]` | The mobile app (no extension) at phone size: import RGHS / Hospedia / payment Excel, phone layout, download, data kept after reload. |
| `node tests/e2e.js [--shots]` | OPD claim filler (`content.js`) on a mock RGHS OPD page: filling, reload resume, uploads, bad codes, never presses SAVE / FINAL. |
| `node tests/hospedia-e2e.js [--shots]` | Hospedia report -> claim rows and daily-sheet bills through `background.js`. |

`vendor/` has jQuery 3.7.1 and DataTables 1.13.11 (MIT) for the mock portal pages.
Screenshots and downloads go to `$PJ_OUT` (default: `<tmp>/pj-e2e`).
`fixtures/` holds the sheets and results from v3.1 for reference.
