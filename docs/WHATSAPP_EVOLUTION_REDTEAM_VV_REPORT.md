# TRUE MODE Red Team V&V — WhatsApp Evolution E2E

**Date:** 2026-09-07  
**Mode:** Independent verification & validation (inventory + live probes + requirement matrix + helper unit tests)  
**Base API:** `http://127.0.0.1:3389`  
**Harness:** `scripts/verify_whatsapp_evolution_redteam_vv.py`  
**Spec:** `docs/WHATSAPP_EVOLUTION_IMPLEMENTATION_SPEC.md`

---

## Executive verdict

**FAIL CLOSED — Evolution WhatsApp go-live requirements are NOT met.**

The product cannot show QR, send attachments via WhatsApp API, receive button webhooks, or run Approve cascades because **those capabilities are not implemented in executable code**. Live `:3389` (atlas-next + HCM FastAPI) has **no** WhatsApp/Evolution OpenAPI paths. A `GET /admin/wa/instances` returning HTTP 200 is a **false positive** (SPA HTML shell), not an API.

| Metric | Result |
|--------|--------|
| Checks total | 31 |
| PASS | 7 |
| FAIL | 24 |
| P0 FAIL | 19 |

---

## Independent procedures used

| # | Procedure | Method | Result |
|---|-----------|--------|--------|
| 1 | Source inventory | Recursive search of atlas-next, atlas-hcm-next, atlas-platform, HCM Airfare `src` for Evolution/sendMedia/webhook | No Evolution product code |
| 2 | Live OpenAPI probe | Full `GET /openapi.json` filter for whatsapp/wa/evolution/webhook | **No matching paths** |
| 3 | Route deception check | `GET /admin/wa/instances` | 200 **text/html** (Next SPA) — not JSON API |
| 4 | Webhook ingress | `POST /webhook/evolution` | **405** Method Not Allowed |
| 5 | Requirement matrix | Decision lock R1–R10 + E2E 01–10 mapped to code | All **FAIL** (spec-only) |
| 6 | Legacy wa.me V&V | Extract + unit test + layout source test | **PASS** after harden |

---

## What exists today (truth)

| Layer | Reality |
|-------|---------|
| Production UI (`atlas-next` on :3389) | **Zero** WhatsApp QR / connection / template UI |
| Legacy UI (`atlas-hcm-next` / `atlas-platform`) | Manual **wa.me** click-to-chat + print/image download for manual attach |
| Backend HCM FastAPI | **No** WhatsApp/Evolution routes |
| `server.js` (legacy) | Stores `Employees.WhatsAppNumber` only |
| Docs / canvases | Architecture + implementation **spec** only |

Implemented path: `window.open(https://wa.me/<digits>?text=…)` → user presses Send manually. No delivery receipts, no buttons, no API media.

---

## E2E 01–10 (locked tests) — validation status

| ID | Test | Status | Evidence |
|----|------|--------|----------|
| 01 | Instance + QR | **FAIL** | No QR widget; no `/instance/create` BFF |
| 02 | Send text/template | **FAIL** | No Evolution/Cloud send |
| 03 | PDF via WhatsApp API | **FAIL** | Manual download only in legacy UI |
| 04 | Approve cascade | **FAIL** | No webhook / no Cloud buttons |
| 05 | Expired nonce | **FAIL** | No nonce store |
| 06 | Unauthorized JID | **FAIL** | No button ingress |
| 07 | Rate limit digest | **FAIL** | Not implemented |
| 08 | Disconnect recovery | **FAIL** | Not implemented |
| 09 | Attachment gates | **FAIL** | No pre-Evolution gate pipeline |
| 10 | Webhook signature | **FAIL** | No `/webhook/evolution` handler |

---

## Fixes applied in this V&V pass (limited, evidence-based)

Cannot invent Evolution without a full implementation sprint. Applied **defect fix** on the only live WhatsApp path (wa.me):

1. Extracted `lib/whatsapp-click-to-chat.ts` (atlas-hcm-next + atlas-platform).  
2. Added **E.164 length gate** (8–15 digits) — previously `"1"` was “ready”.  
3. Unit test: `atlas-hcm-next/tests/whatsapp-click-to-chat.test.mjs` → **PASS**.  
4. Wired pages to shared lib; layout source test → **PASS**.  
5. Added repeatable red-team harness: `scripts/verify_whatsapp_evolution_redteam_vv.py` (exits non-zero while P0 gaps remain — correct fail-closed).

---

## False assumptions challenged (True Mode)

| Assumption | Reality |
|------------|---------|
| “Backend already integrated with Evolution” | **False** for this codebase |
| “200 on /admin/wa/instances means API works” | **False** — SPA HTML |
| “Attachments are sent through WhatsApp” | **False** — user attaches manually after wa.me open |
| “Baileys buttons for Approve” | Evolution docs: **discontinued**; Cloud required (already in lock) |

---

## Required next implementation order (do not skip)

1. Evolution deploy + Cloud instance (production interactive).  
2. BFF routes under `/admin/wa/*` + `POST /webhook/evolution` (real JSON, not SPA).  
3. atlas-next Connection Widget (QR for lab Baileys; Connected for Cloud).  
4. Attachment gates → pre-sign → `sendTemplate` DOCUMENT / `sendMedia`.  
5. Cloud Approve/Reject → nonce/JID validation → user cascade.  
6. Re-run this harness until **P0 FAIL = 0**.

Reference: `docs/WHATSAPP_EVOLUTION_IMPLEMENTATION_SPEC.md`

---

## How to re-run

```bash
py -3 scripts/verify_whatsapp_evolution_redteam_vv.py --base http://127.0.0.1:3389
cd atlas-hcm-next && node --experimental-strip-types tests/whatsapp-click-to-chat.test.mjs
```

---

*V&V artifact — Red Team + True Mode — FAIL CLOSED until Evolution is implemented.*
