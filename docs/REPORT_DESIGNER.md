# Report designer vs Crystal BIP (:3389)

## What you use day-to-day

**Native Report designer** on Reports (banded columns, templates, preview, Export PDF/Excel via `/v1/reports/export/...` and saved templates). This is the working path on HCM **:3389**.

## What “Crystal BIP not configured” meant

That badge was **not** a broken button. It meant the optional **SAP Crystal Reports Business Intelligence Platform** bridge is off. Crystal 2020 support ends **Dec 2026**; we do not require BIP.

Open-source banded alternatives researched for future deep canvas work: NextReport Engine, AnkaReport, json-pdf-designer — not required to use catalog exports today.

## Proper flow

1. Click a catalog tile → Excel / PDF  
2. Or designer: pick dataset → columns → **Export Excel/PDF** (always)  
3. Optionally **Save template** → **Run saved** for reusable layouts
