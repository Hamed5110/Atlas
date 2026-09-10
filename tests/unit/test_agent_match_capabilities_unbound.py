"""Regression: agent product/general paths must not UnboundLocalError match_capabilities."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from airfare_management.ai_agent.planner import build_plan
from airfare_management.ai_agent.smart_agent import run_agent


def test_product_intent_uses_module_level_match_capabilities():
    """Regression for: cannot access local variable 'match_capabilities'…"""
    plan = build_plan("What is airfare rate")
    # Prefer product/teach; either must not crash on match_capabilities
    assert plan.primary_action in {"product", "teach", "capabilities", "general"}

    session = MagicMock()
    session.scalars.return_value = []
    with patch(
        "airfare_management.ai_agent.smart_agent._maybe_llm_polish",
        side_effect=lambda msg, ctx, fallback, tools, **kw: fallback,
    ):
        with patch(
            "airfare_management.ai_agent.knowledge_brain.recall",
            return_value={"hits": [], "answer_context": "", "knowledge_version": "t", "corpus_size": 0},
        ):
            out = run_agent(session, message="How do company logos work", actor="admin")
    assert out.outcome in {"ok", "needs_clarification", "manual_review"}
    assert "match_capabilities" not in (out.reply or "").lower()
    assert "unbound" not in (out.reply or "").lower()


def test_build_plan_product_or_teach_for_rate_question():
    plan = build_plan("What is airfare rate")
    assert plan.primary_action in {"product", "teach"}
