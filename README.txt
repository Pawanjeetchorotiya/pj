PJ Auto OPD Claim  (v3.2)
=========================

WHAT IT DOES
  1. Hospedia report  ->  claim list (TID, doctor, RMC, RGHS package codes, bill)
  2. Scan folder      ->  the right PDF is uploaded into the right box on the portal
  3. RGHS portal      ->  the whole OPD claim form is filled
  You check the form and press FINAL CLAIM SUBMISSION yourself. The tool never presses it.

INSTALL (2 minutes)
  1. Right-click the zip > Extract All > Extract.
  2. Chrome: open  chrome://extensions
  3. Turn ON "Developer mode" (top right).
  4. Remove any older "PJ ..." extension.
  5. Press "Load unpacked" and choose the folder that has manifest.json inside.
  6. Pin it: puzzle icon in the toolbar > pin "PJ Auto OPD Claim".

EVERY DAY
  1. Hospedia > Reports > Panel Wise Invoice Summary > RGHS NEW >
     Panel Business Detailed > dates > VIEW ON SCREEN >
     press the blue "Make RGHS claim list" button. A card shows how many
     claims are ready, which need checking and which need you.
  2. Open the RGHS portal OPD claim page (the card has a button for it).
     The PJ panel is at the bottom right. Press "⬇ Hospedia".
  3. Press "📁 Scan folder" ONCE and pick your scan folder.
     The tool remembers that folder. Files scanned later are picked up on their own.
  4. Press step 3 "Text" (or Alt+T). The scanned slip opens on the left;
     type Chief Complaints and Diagnosis, press "Save & next" (Ctrl+Enter).
     Text you have typed before comes back under "Quick pick".
  5. Press "▶ Fill next TID" (or Alt+N). Check the form and the yellow
     "Please check" box. Press FINAL CLAIM SUBMISSION yourself.
     The claim turns "Done" on its own after the portal says it was submitted.

THE PANEL
  - Steps 1-4 at the top show where you are; click a step to do it.
  - Green bar = claims submitted today.
  - Chips (Waiting / Ready / Check / Error / Done) filter the list.
    Type in the search box (or press /) to find a TID, patient or doctor.
  - ⋯ menu: download a status report (Excel), a blank Excel template,
    or clear the list.
  - Drag the panel by its top bar; it stays where you put it.
  - Toolbar icon: show / hide the panel. On Hospedia it makes the list.
    On any other tab it switches to (or opens) the RGHS page.

KEYS
  Alt+N  fill next TID        Alt+T  type text        Alt+M  minimise
  Ctrl+Enter  save text & next                       Esc    close text box

WHAT STAYS MANUAL (and why)
  - Chief complaints and diagnosis: these are handwritten on the OPD slip.
    No software reads handwriting reliably, so the tool shows you the slip
    and you type. Typed text is saved and offered again as Quick pick.
  - Live / BIS photo: it is the patient's photo.
  - FINAL CLAIM SUBMISSION: once submitted, a mistake cannot be undone.

PRE-AUTH WARNING
  The panel warns when investigations come to more than Rs 2000, or when
  more than one CT / MRI / Doppler is in the claim.

WHEN SOMETHING IS WRONG
  The tool still fills everything it can. If the doctor is not in the list,
  an RMC does not verify or a package code is not found, the rest of the
  form is filled and the claim is marked "Check" with the reason.

PRIVACY
  Everything stays in your own Chrome. No patient data is sent anywhere.
