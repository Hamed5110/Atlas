"""Unit tests for local LLM provider routing (Ollama free + DeepSeek optional)."""

from __future__ import annotations

import json
from io import BytesIO
from unittest.mock import MagicMock, patch

import pytest

from airfare_management.ai_agent import local_llm as llm


class _FakeResp:
    def __init__(self, payload: dict, status: int = 200):
        self.status = status
        self._payload = payload

    def read(self) -> bytes:
        return json.dumps(self._payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def test_resolve_provider_prefers_ollama_when_online():
    with patch.object(llm, "ollama_available", return_value=True):
        assert (
            llm.resolve_provider(
                preferred="auto",
                ollama_enabled=True,
                deepseek_api_key="sk-test",
            )
            == "ollama"
        )


def test_resolve_provider_falls_back_to_deepseek():
    with patch.object(llm, "ollama_available", return_value=False):
        assert (
            llm.resolve_provider(
                preferred="auto",
                ollama_enabled=True,
                deepseek_api_key="sk-test",
            )
            == "deepseek"
        )


def test_resolve_provider_none_when_unavailable():
    with patch.object(llm, "ollama_available", return_value=False):
        assert (
            llm.resolve_provider(
                preferred="auto",
                ollama_enabled=True,
                deepseek_api_key="",
            )
            is None
        )


def test_synthesize_ollama_ok():
    fake = _FakeResp({"message": {"content": "Polished reply."}})
    with patch("urllib.request.urlopen", return_value=fake):
        out = llm.synthesize_ollama(
            user_message="hi",
            tool_context={"x": 1},
            model="llama3.2",
        )
    assert out["ok"] is True
    assert out["provider"] == "ollama"
    assert out["cost"] == "free"
    assert out["reply"] == "Polished reply."
    assert "latency_ms" in out


def test_synthesize_deepseek_ok_with_thinking():
    fake = _FakeResp(
        {
            "model": "deepseek-v4-flash",
            "choices": [{"message": {"content": "DeepSeek reply"}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5},
        }
    )
    captured: dict = {}

    def _urlopen(req, timeout=60):  # noqa: ARG001
        captured["url"] = req.full_url
        captured["headers"] = dict(req.headers)
        captured["body"] = json.loads(req.data.decode("utf-8"))
        return fake

    with patch("urllib.request.urlopen", side_effect=_urlopen):
        out = llm.synthesize_deepseek(
            user_message="hello",
            tool_context={"ok": True},
            api_key="sk-test",
            thinking_enabled=True,
            reasoning_effort="high",
        )
    assert out["ok"] is True
    assert out["provider"] == "deepseek"
    assert out["reply"] == "DeepSeek reply"
    assert captured["url"].endswith("/chat/completions")
    assert captured["body"]["model"] == "deepseek-v4-flash"
    assert captured["body"]["thinking"] == {"type": "enabled"}
    assert captured["body"]["reasoning_effort"] == "high"
    assert "Bearer sk-test" in captured["headers"].get("Authorization", "")


def test_synthesize_cascade_uses_settings_provider():
    with patch.object(llm, "resolve_provider", return_value="deepseek"):
        with patch.object(
            llm,
            "synthesize_deepseek",
            return_value={"ok": True, "reply": "via ds", "provider": "deepseek"},
        ) as ds:
            out = llm.synthesize(
                user_message="q",
                tool_context={},
                provider="auto",
                deepseek_api_key="sk-x",
            )
    assert out["ok"] is True
    assert out["reply"] == "via ds"
    ds.assert_called_once()


def test_llm_status_shape():
    with patch.object(llm, "ollama_available", return_value=False):
        status = llm.llm_status(deepseek_api_key="", provider="auto")
    assert status["free_path"] == "ollama"
    assert status["active_provider"] is None
    assert status["ollama"]["online"] is False
    assert "metrics_to_track" in status
    assert "inference_latency_ms" in status["metrics_to_track"]
