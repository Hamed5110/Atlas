# Voucher lifecycle (logic — no code)

Sprint-critical #2 design input for Engineering + Ops.

## States

1. **draft** — UI form only; no voucher_no.  
2. **reserved** — voucher_no allocated; row exists; PDF not yet durable.  
3. **stuck** — reserved (or claimed issued) but PDF missing/corrupt OR stamp/render failed after reserve.  
4. **issued** — PDF bytes on disk; downloadable; WhatsApp may attach.  
5. **void** — retired stuck/failed; voucher_no never reused for another party/company.

## Transitions

| From | To | Trigger | Rule |
|---|---|---|---|
| draft | reserved | Issue start | Allocate one voucher_no for this intent |
| reserved | issued | Render+stamp+store OK | Only then “Issued & downloadable” |
| reserved | stuck | Render/stamp/store fail | Detectable; not downloadable |
| stuck | issued | Idempotent retry same id | No new voucher_no |
| stuck | void | Ops retire | Explicit; then new intent may Issue anew |
| issued | issued | Regenerate | Same voucher_no; **company locked** |

## Forbidden

- reserved → issued without bytes  
- stuck auto → new voucher_no on retry  
- issued company change on regenerate  

## API error classes (feeds #5)

| Class | Meaning | Client |
|---|---|---|
| business_rule | Validation, company_mismatch, stale_version | Do not blind-retry |
| infrastructure | PDF engine down, disk write fail | Retry same intent under idempotency |
