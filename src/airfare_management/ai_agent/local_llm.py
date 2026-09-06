"""Optional LLM synthesis for the AI Data Agent (privacy-first).

Free path: local Ollama (default). Optional cloud: DeepSeek OpenAI-compatible
API when AIRFARE_AI_DEEPSEEK_API_KEY is set (new accounts may include a trial
token grant; ongoing use is pay-as-you-go — not guaranteed free).

Pattern: model reasons over tool observations, then answers like a support engineer.
Never invents SQL or authorizes writes.
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from typing import Any

# Prefer instruct models for support. deepseek-r1:1.5b is kept as fallback.
PREFERRED_OLLAMA_MODELS = (
    "qwen2.5:3b-instruct",
    "qwen2.5:3b",
    "llama3.2:3b",
    "llama3.2",
    "deepseek-r1:1.5b",
)

SYSTEM_PROMPT = (
    "You are Atlas HCM support on local Ollama (https://ollama.com/). "
    "Answer the question first using ONLY facts. If missing, say UNKNOWN. "
    "BHD = Bahraini Dinar (never Baht). No invented SQL. "
    "Format exactly:\n### Think\n- …\n### Logic\n- …\n### Answer\n…\n### Next\n- …\n"
    "Answer must name screen routes and APIs from facts."
)

TEACH_SYSTEM_PROMPT = SYSTEM_PROMPT
SUPPORT_SYSTEM_PROMPT = SYSTEM_PROMPT

# Legacy DeepSeek IDs route to V4-Flash until deprecation (2026-07-24).
DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-flash"
DEEPSEEK_FALLBACK_MODELS = ("deepseek-chat", "deepseek-reasoner")

_THINK_RE = re.compile(
    r"<think>.*?</think>|<thinking>.*?</thinking>",
    re.IGNORECASE | re.DOTALL,
)


def strip_model_thinking(text: str) -> str:
    """Remove chain-of-thought tags (e.g. deepseek-r1) so operators see the answer."""
    cleaned = _THINK_RE.sub("", text or "").strip()
    # Some models emit bare "Thinking..." preambles
    if cleaned.lower().startswith("thinking"):
        parts = re.split(r"\n{2,}", cleaned, maxsplit=1)
        if len(parts) == 2:
            cleaned = parts[1].strip()
    return cleaned.strip() or (text or "").strip()


def ollama_available(base_url: str = "http://127.0.0.1:11434", timeout: float = 2.0) -> bool:
    try:
        req = urllib.request.Request(f"{base_url.rstrip('/')}/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return 200 <= resp.status < 300
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def list_ollama_models(base_url: str = "http://127.0.0.1:11434", timeout: float = 3.0) -> list[str]:
    try:
        req = urllib.request.Request(f"{base_url.rstrip('/')}/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return [str(m.get("name") or "") for m in (data.get("models") or []) if m.get("name")]
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError):
        return []


def resolve_ollama_model(
    configured: str,
    base_url: str = "http://127.0.0.1:11434",
) -> str:
    """Pick the best installed free model for support-quality answers."""
    installed = list_ollama_models(base_url)
    if not installed:
        return configured
    installed_cf = {n.casefold(): n for n in installed}
    for pref in PREFERRED_OLLAMA_MODELS:
        if pref.casefold() in installed_cf:
            return installed_cf[pref.casefold()]
    if configured and configured.casefold() in installed_cf:
        return installed_cf[configured.casefold()]
    return configured or installed[0]


def deepseek_configured(api_key: str | None) -> bool:
    return bool(api_key and str(api_key).strip())


def _user_payload(user_message: str, tool_context: dict[str, Any]) -> str:
    facts = tool_context.get("facts") or tool_context.get("answer_context") or tool_context
    return (
        f"Question: {user_message}\n\n"
        f"facts (ground truth):\n{json.dumps(facts, default=str)[:6000]}\n\n"
        "Reply with Think → Logic → Answer → Next. Answer the question only."
    )


def synthesize_ollama(
    *,
    user_message: str,
    tool_context: dict[str, Any],
    base_url: str = "http://127.0.0.1:11434",
    model: str = "llama3.2",
    timeout: float = 45.0,
    system_prompt: str | None = None,
) -> dict[str, Any]:
    """Ask local Ollama to reason over tool results and support the operator."""
    system = system_prompt or SUPPORT_SYSTEM_PROMPT
    resolved = resolve_ollama_model(model, base_url)
    payload = {
        "model": resolved,
        "stream": False,
        "keep_alive": "10m",
        "options": {
            "temperature": 0.2,
            "num_predict": 700,
        },
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": _user_payload(user_message, tool_context)},
        ],
    }
    started = time.perf_counter()
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        latency_ms = round((time.perf_counter() - started) * 1000, 1)
        raw = (data.get("message") or {}).get("content") or ""
        message = strip_model_thinking(raw)
        return {
            "ok": bool(message.strip()),
            "reply": message.strip(),
            "model": resolved,
            "provider": "ollama",
            "latency_ms": latency_ms,
            "cost": "free",
            "raw_had_thinking": raw != message,
        }
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        return {
            "ok": False,
            "error": str(exc),
            "provider": "ollama",
            "model": resolved,
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
            "cost": "free",
        }


def synthesize_deepseek(
    *,
    user_message: str,
    tool_context: dict[str, Any],
    api_key: str,
    base_url: str = "https://api.deepseek.com",
    model: str = DEEPSEEK_DEFAULT_MODEL,
    timeout: float = 60.0,
    thinking_enabled: bool = True,
    reasoning_effort: str = "medium",
    system_prompt: str | None = None,
) -> dict[str, Any]:
    """Optional cloud DeepSeek OpenAI-compatible chat."""
    system = system_prompt or SUPPORT_SYSTEM_PROMPT
    url = f"{base_url.rstrip('/')}/chat/completions"
    body: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": _user_payload(user_message, tool_context)},
        ],
        "temperature": 0.3,
    }
    if thinking_enabled:
        body["reasoning_effort"] = reasoning_effort
    started = time.perf_counter()
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        latency_ms = round((time.perf_counter() - started) * 1000, 1)
        choice = (data.get("choices") or [{}])[0]
        message = ((choice.get("message") or {}).get("content") or "").strip()
        message = strip_model_thinking(message)
        return {
            "ok": bool(message),
            "reply": message,
            "model": model,
            "provider": "deepseek",
            "latency_ms": latency_ms,
            "cost": "api",
        }
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        # Retry once with legacy model ids
        err = str(exc)
        for fb in DEEPSEEK_FALLBACK_MODELS:
            if fb == model:
                continue
            try:
                return synthesize_deepseek(
                    user_message=user_message,
                    tool_context=tool_context,
                    api_key=api_key,
                    base_url=base_url,
                    model=fb,
                    timeout=timeout,
                    thinking_enabled=thinking_enabled,
                    reasoning_effort=reasoning_effort,
                    system_prompt=system_prompt,
                )
            except Exception:  # noqa: BLE001
                continue
        return {
            "ok": False,
            "error": err,
            "provider": "deepseek",
            "model": model,
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
            "cost": "api",
        }


def resolve_provider(
    *,
    preferred: str = "auto",
    ollama_enabled: bool = True,
    ollama_base_url: str = "http://127.0.0.1:11434",
    deepseek_api_key: str | None = None,
) -> str | None:
    pref = (preferred or "auto").strip().lower()
    if pref == "off":
        return None
    ollama_ok = bool(ollama_enabled and ollama_available(ollama_base_url))
    deepseek_ok = deepseek_configured(deepseek_api_key)
    if pref == "ollama":
        return "ollama" if ollama_ok else None
    if pref == "deepseek":
        return "deepseek" if deepseek_ok else None
    if ollama_ok:
        return "ollama"
    if deepseek_ok:
        return "deepseek"
    return None


def synthesize(
    *,
    user_message: str,
    tool_context: dict[str, Any],
    provider: str | None = "auto",
    ollama_enabled: bool = True,
    ollama_base_url: str = "http://127.0.0.1:11434",
    ollama_model: str = "llama3.2",
    deepseek_api_key: str | None = None,
    deepseek_base_url: str = "https://api.deepseek.com",
    deepseek_model: str = DEEPSEEK_DEFAULT_MODEL,
    deepseek_thinking: bool = True,
    deepseek_reasoning_effort: str = "medium",
    timeout: float = 60.0,
    system_prompt: str | None = None,
) -> dict[str, Any]:
    """Route synthesis to Ollama (free) or DeepSeek (optional API key)."""
    chosen = resolve_provider(
        preferred=provider or "auto",
        ollama_enabled=ollama_enabled,
        ollama_base_url=ollama_base_url,
        deepseek_api_key=deepseek_api_key,
    )
    if chosen is None:
        return {
            "ok": False,
            "error": "No LLM provider available (start Ollama or set DEEPSEEK API key).",
            "provider": None,
            "cost": "n/a",
        }
    if chosen == "ollama":
        return synthesize_ollama(
            user_message=user_message,
            tool_context=tool_context,
            base_url=ollama_base_url,
            model=ollama_model,
            timeout=timeout,
            system_prompt=system_prompt,
        )
    return synthesize_deepseek(
        user_message=user_message,
        tool_context=tool_context,
        api_key=str(deepseek_api_key or ""),
        base_url=deepseek_base_url,
        model=deepseek_model,
        timeout=timeout,
        thinking_enabled=deepseek_thinking,
        reasoning_effort=deepseek_reasoning_effort,
        system_prompt=system_prompt,
    )


def llm_status(
    *,
    ollama_enabled: bool = True,
    ollama_base_url: str = "http://127.0.0.1:11434",
    ollama_model: str = "llama3.2",
    deepseek_api_key: str | None = None,
    deepseek_base_url: str = "https://api.deepseek.com",
    deepseek_model: str = DEEPSEEK_DEFAULT_MODEL,
    provider: str = "auto",
) -> dict[str, Any]:
    """Health + routing snapshot for ops / Learning Center UI."""
    ollama_on = bool(ollama_enabled and ollama_available(ollama_base_url))
    deepseek_on = deepseek_configured(deepseek_api_key)
    active = resolve_provider(
        preferred=provider,
        ollama_enabled=ollama_enabled,
        ollama_base_url=ollama_base_url,
        deepseek_api_key=deepseek_api_key,
    )
    resolved_model = resolve_ollama_model(ollama_model, ollama_base_url) if ollama_on else ollama_model
    return {
        "provider_preference": provider,
        "active_provider": active,
        "ollama": {
            "enabled": ollama_enabled,
            "online": ollama_on,
            "base_url": ollama_base_url,
            "model": resolved_model,
            "configured_model": ollama_model,
            "installed_models": list_ollama_models(ollama_base_url) if ollama_on else [],
            "cost": "free",
        },
        "deepseek": {
            "configured": deepseek_on,
            "base_url": deepseek_base_url,
            "model": deepseek_model,
            "cost": "api" if deepseek_on else "n/a",
        },
    }
