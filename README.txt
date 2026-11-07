PJ RGHS Suite  (v4.0.0)
=======================
One Chrome extension instead of two. It joins
  - "PJ RGHS Claim Status" (v3.2)  - claim status panel, upload ticker, alerts
  - "PJ Auto OPD Claim"   (v3.2)  - makes the OPD claim list from Hospedia and fills the RGHS form
and adds
  - the DAILY SHEET: the month Excel (sheets 1..31) you used to make by hand from RGHS + Hospedia
  - the Payment Tracker summary (tmsPaymentTrack)
  - tmsBisTrack1 (Gender, Age, RGHS Card No. are read from it)
  - a mobile app (app/ folder) for the phone

INSTALL (2 minutes)
  1. Unzip. You get a folder "pj-rghs-suite" with manifest.json inside.
  2. Chrome: open  chrome://extensions  and turn ON "Developer mode" (top right).
  3. REMOVE the old "PJ RGHS Claim Status" and "PJ Auto OPD Claim". This suite has both.
     (If an old one is still there, a small card on the portal reminds you.)
  4. "Load unpacked" -> choose the "pj-rghs-suite" folder.
  5. Pin it: puzzle icon -> pin "PJ RGHS Suite".
  6. Press F5 on every RGHS and Hospedia tab that is already open.

EVERY DAY - THE DAILY SHEET (no more copy-paste)
  1. RGHS: open the Transaction ID Tracker (tmsBisTrack1 has Gender / Age / Card No.) and search the dates.
     All pages of the table are read and saved. The panel shows "✓ N saved".
  2. RGHS: open the Payment Tracker once (optional). Paid / approved / UTR are saved.
  3. Hospedia: Reports > Panel Wise Invoice Summary > RGHS NEW > Panel Business Detailed > dates >
     VIEW ON SCREEN. The bill breakdown of every TID is saved by itself ("✓ N TIDs saved for the daily sheet").
  4. Toolbar icon > "Daily sheet" (or the green sheet button on the tracker panel).
     Pick the month > "Download month Excel".
  The file (e.g. RGHS_OCT_26_OPD.xlsx) has the same sheets and columns as your hand-made one:
     1 .. 31   CLAIMSUBMISSIONYEAR ... TREATING DOCTOR NAME (from RGHS), PANEL, CONSULT, X RAY, CT SCAN,
               USG, CBCT, OPG, OCT, OTHERS (from Hospedia), DIFF = I-K and LAB = I-(M..T) as Excel formulas
     Summary   day totals, column totals, doctor-wise count
     Check     TIDs with no Hospedia bill, amount different (DIFF), Hospedia bill not in RGHS, missing details
     Payments  paid / approved / deduction / UTR (when the Payment Tracker was opened)
  The page also shows a calendar of the month, each day's rows, and the same checks on screen.

  How Hospedia items go into columns:
     APPOINTMENT / consultation -> CONSULT      CBCT, cone beam, "CT SCAN DENTAL" -> CBCT
     OPG -> OPG     OCT -> OCT     other CT -> CT SCAN     USG / ultrasound / doppler -> USG
     X-RAY -> X RAY     LAB / pathology tests -> LAB     anything else (ECG, physio, procedures) -> OTHERS
  LAB in the sheet is the formula I-(M..T), exactly like your sheet.

OPD CLAIM FILLER (same as before)
  Hospedia report -> "Make RGHS claim list" -> RGHS OPD page -> PJ panel bottom right ->
  "⬇ Hospedia", "📁 Scan folder", step 3 "Text", "▶ Fill next TID". You check and press
  FINAL CLAIM SUBMISSION yourself - the tool never presses SAVE or FINAL.
  Toolbar icon > "OPD claims": on the OPD page it shows / hides the panel; on Hospedia it makes the list.
  Keys: Alt+N fill next, Alt+T type text, Alt+M minimise, Ctrl+Enter save text & next.

CLAIM STATUS (same as before)
  Tracker panel: click any number to filter the portal table. Calendar = quick dates.
  Copy = WhatsApp summary. Red badge in the top bar = TIDs waiting for upload.

MOBILE APP
  The app/ folder is an installable phone app (works offline, data stays on the phone).
  Open it on the phone (see the link given with this version), then browser menu > "Add to Home screen".
  Bring data to the phone in any of these ways (button "Import files"):
    - the Transaction ID Tracker Excel downloaded from RGHS
    - the Hospedia report exported to Excel
    - an older daily sheet (like RGHS_OCT_26_OPD.xlsx)
    - a backup made on the PC: Daily sheet page > "Data on this device" > "Backup (JSON)"
  It shows the same calendar, checks and makes the same month Excel.

PRIVACY
  Everything stays in this Chrome (or on the phone). No patient data is sent anywhere.
