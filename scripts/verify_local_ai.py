"""Full verify: local AI runners for Atlas HCM (Ollama / LM Studio / Jan / AnythingLLM).

Research (2026 blogs):
- Ollama = best model runner (daemon + OpenAI /v1) — MachineLearningMastery
- LM Studio = best GUI browse + server :1234
- Jan = open-source ChatGPT-like GUI :1337
- AnythingLLM = docs RAG + OpenAI-compat at :3001/api/v1/openai (workspace slug as model)
- llama.cpp = engine under LM Studio/Jan

This machine: ~16GB RAM + Intel Iris Xe → keep 1.5B–3B instruct models.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))


def _get(url: str, timeout: float = 3.0) -> tuple[int, str]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except Exception as exc:  # noqa: BLE001
        return 0, str(exc)


def _post_json(url: str, body: dict, timeout: float = 90.0) -> tuple[int, dict | str]:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")
    except Exception as exc:  # noqa: BLE001
        return 0, str(exc)


def main() -> int:
    from airfare_management.ai_agent.local_llm import llm_status, synthesize, synthesize_openai_compat
    from airfare_management.config import get_settings

    get_settings.cache_clear()
    settings = get_settings()
    checks: list[tuple[str, bool, str]] = []

    print("=== Hardware guidance (this PC profile) ===")
    print("Prefer Ollama + qwen2.5:3b-instruct (already configured).")
    print("Optional: LM Studio/Jan GUI, or AnythingLLM OpenAI-compat for docs RAG.\n")

    # Probe common local servers
    probes = [
        ("ollama_tags", "http://127.0.0.1:11434/api/tags"),
        ("ollama_v1_models", "http://127.0.0.1:11434/v1/models"),
        ("lmstudio_v1", "http://127.0.0.1:1234/v1/models"),
        ("jan_v1", "http://127.0.0.1:1337/v1/models"),
        ("anythingllm_ui", "http://127.0.0.1:3001"),
    ]
    for name, url in probes:
        code, body = _get(url)
        ok = code == 200
        checks.append((name, ok, f"{code} {body[:100]}"))
        print(("PASS" if ok else "SKIP"), name, "->", code)

    # OpenAI-compat chat against Ollama /v1 (online testing tool = curl-equivalent)
    st, payload = _post_json(
        "http://127.0.0.1:11434/v1/chat/completions",
        {
            "model": settings.ai_ollama_model,
            "messages": [{"role": "user", "content": "Reply with exactly: ATLAS_OK"}],
            "temperature": 0,
            "max_tokens": 16,
        },
    )
    reply = ""
    if isinstance(payload, dict):
        reply = ((payload.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    ok_chat = st == 200 and "ATLAS_OK" in reply
    checks.append(("ollama_v1_chat", ok_chat, f"{st} {reply[:80]}"))
    print(("PASS" if ok_chat else "FAIL"), "ollama_v1_chat", reply[:80])

    status = llm_status(
        ollama_enabled=settings.ai_ollama_enabled,
        ollama_base_url=settings.ai_ollama_base_url,
        ollama_model=settings.ai_ollama_model,
        deepseek_api_key=settings.ai_deepseek_api_key or None,
        provider=settings.ai_llm_provider,
        openai_compat_enabled=settings.ai_openai_compat_enabled,
        openai_compat_base_url=settings.ai_openai_compat_base_url,
        openai_compat_model=settings.ai_openai_compat_model,
        openai_compat_api_key=settings.ai_openai_compat_api_key,
    )
    ok_status = bool(status.get("active_provider")) and (
        status["ollama"]["online"] or (status.get("openai_compat") or {}).get("online")
    )
    checks.append(("atlas_llm_status", ok_status, str(status.get("active_provider"))))
    print(("PASS" if ok_status else "FAIL"), "atlas_llm_status", status.get("active_provider"), status["ollama"]["model"])

    syn = synthesize(
        user_message="How do I export the finance ledger?",
        tool_context={
            "facts": {
                "route": "/finance",
                "buttons": ["Export Excel", "Export PDF"],
                "apis": ["/v1/finance/ledger-report.xlsx", "/v1/finance/ledger-report.pdf"],
            }
        },
        provider=settings.ai_llm_provider,
        ollama_enabled=settings.ai_ollama_enabled,
        ollama_base_url=settings.ai_ollama_base_url,
        ollama_model=settings.ai_ollama_model,
        openai_compat_enabled=settings.ai_openai_compat_enabled,
        openai_compat_base_url=settings.ai_openai_compat_base_url,
        openai_compat_model=settings.ai_openai_compat_model,
        openai_compat_api_key=settings.ai_openai_compat_api_key,
        timeout=90,
    )
    ok_syn = bool(syn.get("ok"))
    checks.append(("atlas_synthesize", ok_syn, f"{syn.get('provider')} {syn.get('latency_ms')}ms"))
    print(("PASS" if ok_syn else "FAIL"), "atlas_synthesize", (syn.get("reply") or syn.get("error") or "")[:180])

    # Optional OpenAI-compat (LM Studio / Jan / AnythingLLM) when enabled
    if settings.ai_openai_compat_enabled:
        compat = synthesize_openai_compat(
            user_message="Say OK",
            tool_context={"facts": {"ping": True}},
            base_url=settings.ai_openai_compat_base_url,
            model=settings.ai_openai_compat_model,
            api_key=settings.ai_openai_compat_api_key,
            timeout=60,
        )
        checks.append(
            ("openai_compat", bool(compat.get("ok")), str(compat.get("error") or compat.get("model")))
        )
        print(("PASS" if compat.get("ok") else "FAIL"), "openai_compat", compat.get("reply") or compat.get("error"))

    print("\n=== VERIFY SUMMARY ===")
    failed = 0
    for name, passed, detail in checks:
        # SKIP probes for offline optional servers do not fail the run
        if name in {"lmstudio_v1", "jan_v1", "anythingllm_ui"} and not passed:
            print(f"SKIP {name}: offline (optional)")
            continue
        mark = "PASS" if passed else "FAIL"
        if not passed:
            failed += 1
        print(f"{mark} {name}: {detail[:160]}")
    print("\nRecommended: keep Ollama as model runner.")
    print("AnythingLLM: set BASE_URL=http://127.0.0.1:3001/api/v1/openai + API key + workspace slug.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
