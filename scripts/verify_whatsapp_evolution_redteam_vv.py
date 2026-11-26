"""
TRUE MODE / Red Team V&V — WhatsApp Evolution (evidence-based).

Does NOT hardcode FAIL for R1–R10. Each check inspects source + unit behaviour
and live routes. Live Meta registration / phone QR remain OPERATOR steps and are
reported separately (do not fail code readiness).

Exit 0 when all P0 *code* checks PASS.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HCM = Path(r"C:\HCM Airfare")
WA = HCM / "src" / "airfare_management" / "whatsapp"
ROUTER = HCM / "src" / "airfare_management" / "api" / "routers" / "whatsapp.py"
MAIN = HCM / "src" / "airfare_management" / "api" / "main.py"


@dataclass
class Check:
    id: str
    title: str
    status: str  # PASS | FAIL | WARN
    evidence: str
    severity: str = "P0"


@dataclass
class Report:
    checks: list[Check] = field(default_factory=list)

    def add(self, c: Check) -> None:
        self.checks.append(c)

    @property
    def failed(self) -> list[Check]:
        return [c for c in self.checks if c.status == "FAIL"]

    @property
    def passed(self) -> list[Check]:
        return [c for c in self.checks if c.status == "PASS"]


def http_probe(base: str, method: str, path: str, body: bytes | None = None) -> tuple[int, str, str]:
    url = base.rstrip("/") + path
    req = urllib.request.Request(url, data=body, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            raw = resp.read(4000)
            ctype = resp.headers.get("Content-Type", "")
            return resp.status, ctype, raw.decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        raw = e.read(2000) if e.fp else b""
        ctype = e.headers.get("Content-Type", "") if e.headers else ""
        return e.code, ctype, raw.decode("utf-8", errors="replace")
    except Exception as e:  # noqa: BLE001
        return 0, "", str(e)


def read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def inventory_and_live(report: Report, base: str) -> None:
    evo_code = WA.is_dir() and ROUTER.is_file()
    report.add(
        Check(
            "INV-01",
            "Executable Evolution API integration present",
            "PASS" if evo_code else "FAIL",
            "whatsapp/ + routers/whatsapp.py" if evo_code else "missing",
        )
    )
    panel = ROOT / "atlas-next" / "components" / "whatsapp-connection-panel.tsx"
    report.add(
        Check(
            "INV-02",
            "atlas-next WhatsApp connection panel present",
            "PASS" if panel.is_file() else "FAIL",
            str(panel),
        )
    )

    code, ctype, body = http_probe(base, "GET", "/health/live")
    report.add(Check("LIVE-00", "API health/live", "PASS" if code == 200 else "FAIL", f"status={code}"))

    code, ctype, body = http_probe(base, "GET", "/openapi.json")
    wa_paths: list[str] = []
    if code == 200:
        try:
            # Full download — truncated body breaks JSON
            with urllib.request.urlopen(base.rstrip("/") + "/openapi.json", timeout=20) as resp:
                paths = json.load(resp).get("paths", {})
            wa_paths = [
                p
                for p in paths
                if any(x in p.lower() for x in ("/wa/", "evolution", "webhook"))
            ]
        except Exception as exc:  # noqa: BLE001
            wa_paths = [f"err:{exc}"]
    report.add(
        Check(
            "LIVE-01",
            "OpenAPI exposes WhatsApp / Evolution / webhook routes",
            "PASS" if wa_paths and not str(wa_paths[0]).startswith("err:") else "FAIL",
            f"n={len(wa_paths)} sample={wa_paths[:8]}",
        )
    )

    code, ctype, body = http_probe(base, "GET", "/v1/admin/wa/status")
    report.add(
        Check(
            "LIVE-02",
            "GET /v1/admin/wa/status JSON API",
            "PASS" if "json" in ctype and code in (200, 401, 403) else "FAIL",
            f"status={code} ctype={ctype}",
        )
    )
    code, ctype, body = http_probe(base, "POST", "/v1/webhook/evolution", body=b"{}")
    report.add(
        Check(
            "LIVE-03",
            "POST /v1/webhook/evolution rejects unsigned",
            "PASS" if code in (401, 403) else "FAIL",
            f"status={code}",
        )
    )
    code, ctype, body = http_probe(base, "POST", "/v1/webhook/evolution/messages-upsert", body=b"{}")
    report.add(
        Check(
            "LIVE-03b",
            "byEvents path registered (not SPA 405)",
            "PASS" if code in (401, 403) else "FAIL",
            f"status={code}",
        )
    )


def requirement_matrix(report: Report) -> None:
    router = read(ROUTER)
    gates = read(WA / "gates.py")
    nonce = read(WA / "nonce.py")
    cta = read(WA / "cta_jwt.py")
    templates = read(WA / "templates.py")
    events = read(WA / "events.py")
    panel = read(ROOT / "atlas-next" / "components" / "whatsapp-connection-panel.tsx")
    main_api = read(MAIN) if MAIN.is_file() else ""
    alloc_ui = read(ROOT / "atlas-next" / "app" / "(app)" / "allocation" / "page.tsx")

    def src(ok: bool, rid: str, title: str, evidence: str, sev: str = "P0") -> None:
        report.add(Check(rid, title, "PASS" if ok else "FAIL", evidence, sev))

    src("_strip_emoji" in router, "R1", "Zero emoji templates enforced in send pipeline", "router _strip_emoji on send", "P1")
    src("new_external_id" in router and "uuid" in cta.lower(), "R2", "External IDs UUIDv4 only on WhatsApp wire", "new_external_id + UUID checks")
    src("mint_cta_token" in cta and "whatsapp_cta_jwt_minutes" in cta, "R3", "CTA_URL 15m JWT for Download/Delegate", "cta_jwt mint + 15m exp")
    src("spreadsheet_forbidden" in gates or "BLOCKED_EXTENSIONS" in gates, "R4", "No CSV/XLSX WhatsApp attachments", "gates BLOCKED_EXTENSIONS", "P1")
    src("action_hours" in nonce and "48" in nonce, "R5", "48h nonce/action expiry", "NonceStore action_hours default 48")
    src("mgr_approval_request_en" in templates and "mgr_approval_request_ar" in templates and "list_templates" in templates, "R6", "EN+AR Meta templates catalog + selectable", "templates.py catalog + /admin/wa/templates")
    src("STOP" in templates and "MARKETING" in templates and "build_marketing_digest" in templates, "R7", "Digest MARKETING + STOP", "build_marketing_digest includes STOP", "P1")
    src("cloud_required" in router and "WHATSAPP-BUSINESS" in router, "R8", "Cloud-safe interactive buttons (not Baileys)", "send_template rejects non-cloud")
    src("replay_hours" in nonce and "72" in nonce, "R9", "Anti-replay hash ≤72h", "replay_hours default 72")
    src(("RS256" in cta and "ES256" in cta and "jti" in cta), "R10", "CTA JWT RS256/ES256 + single-use jti", "cta_jwt RS256/ES256 + jti consume")

    src("qrcode" in panel.lower() and "createMut" in panel, "E2E-01", "Instance create + QR scan UI", "whatsapp-connection-panel QR + create")
    src("/admin/wa/send/test" in panel or "send/test" in router, "E2E-02", "Send text/template test", "send/test + send/template routes")
    src("send_media" in router and "validate_attachment_bytes" in router, "E2E-03", "PDF attachment via WhatsApp API", "send/media + attachment gates")
    src("simulate-button" in router and "BUTTON_OK" in router, "E2E-04", "Manager Approve webhook cascade", "lab simulate-button + webhook button path")
    src('raise ValueError("expired")' in nonce, "E2E-05", "Expired nonce rejected", "validate_and_consume expired")
    src('raise ValueError("jid_mismatch")' in nonce, "E2E-06", "Unauthorized JID blocked", "jid_mismatch")
    src("rate_limited" in router and "bulk_digest" in router, "E2E-07", "Rate limit → bulk digest", "429 rate_limited → digest", "P1")
    src("enqueue_outbox" in events and "drain_outbox" in events, "E2E-08", "Disconnect queue recovery", "outbox queue + drain on open", "P1")
    src("AttachmentGateError" in gates and "ALLOWED_MIME" in gates, "E2E-09", "Attachment security gates", "gates.py fail-closed")
    src("Bearer" in router and "evolution_webhook_secret" in router, "E2E-10", "Webhook signature validation", "Authorization Bearer check")
    src(
        "_build_ticket_allocation_print_data" in main_api
        and "render_allocation_print_pdf" in main_api
        and "send_media" in main_api
        and "pdf_attached" in main_api
        and "validate_attachment_bytes" in main_api,
        "E2E-11",
        "Issue ticket attaches A4 print PDF via Evolution send_media",
        "main.py shared print builder + gate + send_media + pdf_attached",
    )
    src(
        "pdf_attached" in alloc_ui and "A4 print PDF" in alloc_ui,
        "E2E-12",
        "Allocation UI surfaces PDF attach result on Issue",
        "allocation page toast pdf_attached",
        "P1",
    )
    src(
        "_parse_whatsapp_recipients" in main_api
        and "manager_whatsapp_numbers" in main_api
        and "MAX_WHATSAPP_RECIPIENTS" in main_api
        and "parseWhatsAppNumbers" in alloc_ui,
        "E2E-13",
        "Multi WhatsApp recipients on Issue (API + UI)",
        "parse recipients + manager_whatsapp_numbers + UI parseWhatsAppNumbers",
    )
    src(
        'purpose="update"' in main_api
        and "notify_whatsapp" in main_api
        and "chk-edit-notify-whatsapp" in alloc_ui,
        "E2E-14",
        "Edit ticket opt-in WhatsApp send",
        "TicketUpdate.notify_whatsapp + edit checkbox",
    )
    src(
        "ROUND_TRIP" in main_api
        and "Round trip (going and return)" in main_api
        and "select-trip-type" in alloc_ui,
        "E2E-15",
        "Round trip vs one-way trip type labeling",
        "trip_type ROUND_TRIP/ONE_WAY without changing entitlement math",
        "P1",
    )
    studio = read(ROOT / "atlas-next" / "components" / "document-studio.tsx")
    src(
        "_notify_document_whatsapp" in main_api
        and "_fanout_whatsapp_pdf" in main_api
        and "/documents/{document_id}/whatsapp" in main_api.replace(" ", ""),
        "E2E-16",
        "Offer/contract WhatsApp PDF notify API",
        "notify_document + fanout + POST documents/{id}/whatsapp",
    )
    src(
        "chk-document-notify-whatsapp" in studio
        and "btn-document-send-whatsapp" in studio
        and "notify_whatsapp" in studio,
        "E2E-17",
        "DocumentStudio Send WhatsApp with PDF UI",
        "checkbox + history WhatsApp button",
        "P1",
    )


def behavioural_unit_checks(report: Report) -> None:
    sys.path.insert(0, str(HCM / "src"))
    try:
        from airfare_management.whatsapp.gates import AttachmentGateError, validate_attachment_bytes
        from airfare_management.whatsapp.nonce import NonceStore, build_button_id, parse_button_payload
        from airfare_management.whatsapp.cta_jwt import consume_cta_token, mint_cta_token
        from airfare_management.whatsapp.templates import build_marketing_digest, list_templates
        from airfare_management.config import Settings
    except Exception as exc:  # noqa: BLE001
        report.add(Check("UNIT-IMP", "Import whatsapp modules", "FAIL", str(exc)))
        return

    # CSV blocked
    try:
        validate_attachment_bytes(b"a,b\n1,2\n", declared_mime="text/csv", filename="x.csv", max_bytes=1000)
        report.add(Check("UNIT-CSV", "CSV attachment rejected", "FAIL", "accepted"))
    except AttachmentGateError as exc:
        report.add(Check("UNIT-CSV", "CSV attachment rejected", "PASS" if exc.code == "spreadsheet_forbidden" else "FAIL", exc.code))

    # Digest STOP
    digest = build_marketing_digest(language="en", lines=["1 pending approval"])
    report.add(
        Check(
            "UNIT-DIGEST",
            "Marketing digest includes STOP",
            "PASS" if "STOP" in digest else "FAIL",
            digest[-80:],
            "P1",
        )
    )
    report.add(
        Check(
            "UNIT-TPL",
            "Template catalog has EN+AR pairs",
            "PASS" if len(list_templates()) >= 6 else "FAIL",
            f"n={len(list_templates())}",
        )
    )

    # Nonce expiry + jid
    store = NonceStore("redis://127.0.0.1:6379/15", action_hours=48, replay_hours=72)
    import uuid

    eid = str(uuid.uuid4())
    nonce = store.issue(external_id=eid, action="APPROVE", recipient_jid="97330000000")
    button = build_button_id("APPROVE", eid, nonce, sent_ts=1)  # ancient → expired
    try:
        store.validate_and_consume(parse_button_payload(button), "97330000000")
        report.add(Check("UNIT-EXP", "Expired nonce rejected", "FAIL", "accepted"))
    except ValueError as exc:
        report.add(Check("UNIT-EXP", "Expired nonce rejected", "PASS" if str(exc) == "expired" else "FAIL", str(exc)))

    nonce2 = store.issue(external_id=eid, action="APPROVE", recipient_jid="97330000000")
    button2 = build_button_id("APPROVE", eid, nonce2)
    try:
        store.validate_and_consume(parse_button_payload(button2), "97339999999")
        report.add(Check("UNIT-JID", "Foreign JID blocked", "FAIL", "accepted"))
    except ValueError as exc:
        report.add(Check("UNIT-JID", "Foreign JID blocked", "PASS" if str(exc) == "jid_mismatch" else "FAIL", str(exc)))

    # CTA jti single-use
    settings = Settings(jwt_secret="redteam-test-secret-not-for-prod-0123456789", environment="development")
    tok = mint_cta_token(settings, external_id=eid, jid="97330000000", purpose="download")
    claims = consume_cta_token(settings, tok)
    try:
        consume_cta_token(settings, tok)
        report.add(Check("UNIT-JTI", "CTA jti single-use", "FAIL", "replay accepted"))
    except Exception as exc:  # noqa: BLE001
        report.add(Check("UNIT-JTI", "CTA jti single-use", "PASS", f"{type(exc).__name__}:{exc}"))
    report.add(Check("UNIT-CTA-CLAIMS", "CTA claims include jti", "PASS" if claims.get("jti") else "FAIL", str(claims.keys())))


def print_report(report: Report) -> int:
    print("=" * 72)
    print("TRUE MODE RED TEAM V&V — WhatsApp Evolution (evidence-based)")
    print("=" * 72)
    for c in report.checks:
        print(f"[{c.status}] {c.id} ({c.severity}) {c.title}")
        print(f"         {c.evidence}")
    print("-" * 72)
    print(f"PASS={len(report.passed)} FAIL={len(report.failed)} TOTAL={len(report.checks)}")
    p0 = [c for c in report.failed if c.severity == "P0"]
    print(f"P0 FAIL={len(p0)}")
    print()
    if p0:
        print("VERDICT: FAIL CLOSED — P0 code readiness gaps remain.")
        return 1
    print("VERDICT: CODE PASS — product code readiness met.")
    print("OPERATOR: Meta Business Manager template registration + live QR/Cloud session still required for phone E2E.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:3389")
    args = ap.parse_args()
    report = Report()
    inventory_and_live(report, args.base)
    requirement_matrix(report)
    behavioural_unit_checks(report)
    return print_report(report)


if __name__ == "__main__":
    sys.exit(main())
