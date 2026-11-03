PJ Auto OPD Claim  (v3.1)
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
     press the blue "PJ Make RGHS claim list" button.
  2. Open the RGHS portal OPD claim page. The PJ panel is at the bottom right.
     Press "Load from Hospedia".
  3. Press "Choose scan folder" ONCE and pick your scan folder.
     The tool remembers that folder. Files scanned later are picked up on their own.
  4. Press "Type text for all". The scanned slip opens on the left;
     type Chief Complaints and Diagnosis, press "Save & next".
     Text you have typed before comes back under "Quick pick".
  5. Press "Fill next TID". Check the form. Press FINAL CLAIM SUBMISSION yourself.

WHAT STAYS MANUAL (and why)
  - Chief complaints and diagnosis: these are handwritten on the OPD slip.
    No software reads handwriting reliably, so the tool shows you the slip
    and you type. Typed text is saved and offered again as Quick pick.
  - Live / BIS photo: it is the patient's photo.
  - FINAL CLAIM SUBMISSION: once submitted, a mistake cannot be undone.

PRE-AUTH WARNING
  The panel warns when investigations come to more than Rs 2000, or when
  more than one CT / MRI / Doppler is in the claim.

PRIVACY
  Everything stays in your own Chrome. No patient data is sent anywhere.
