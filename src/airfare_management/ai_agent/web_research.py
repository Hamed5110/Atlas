"""Online research tools for the local AI Data Agent.

Inspired by Hugging Face smolagents WebSearchTool / DuckDuckGoSearchTool:
research stays optional, cited, and never sends HCM row data off-box.
Only the user's research question (and allowlisted URLs) leave the machine.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from airfare_management.infrastructure.schema import AiLearningEventRow

USER_AGENT = "AtlasHCM-LocalAIAgent/1.0 (+local; research-tool)"
TIMEOUT_SEC = 12

# Privacy-first allowlist for full-page fetch (smolagents-style bounded tools).
FETCH_ALLOW_PREFIXES = (
    "https://learn.microsoft.com/",
    "https://ourairports.com/",
    "https://davidmegginson.github.io/ourairports-data/",
    "https://raw.githubusercontent.com/",
    "https://docs.github.com/",
    "https://huggingface.co/docs/",
    "https://en.wikipedia.org/wiki/",
    "https://en.wikipedia.org/api/",
    "https://api.duckduckgo.com/",
)

_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def _http_get(url: str, *, accept: str = "application/json,text/html;q=0.9,*/*;q=0.8") -> tuple[str, str]:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": accept},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        body = resp.read().decode(charset, errors="replace")
        return str(resp.url), body


def _strip_html(text: str) -> str:
    text = _TAG.sub(" ", text)
    return _WS.sub(" ", text).strip()


def duckduckgo_instant(query: str, *, max_related: int = 5) -> dict[str, Any]:
    """DuckDuckGo Instant Answer API (no key). Good for definitions and topic cards."""
    params = urllib.parse.urlencode(
        {"q": query, "format": "json", "no_html": 1, "skip_disambig": 1}
    )
    url = f"https://api.duckduckgo.com/?{params}"
    _, body = _http_get(url)
    data = json.loads(body)
    related: list[dict[str, str]] = []
    for item in (data.get("RelatedTopics") or [])[: max_related * 2]:
        if "Text" in item:
            related.append(
                {
                    "text": str(item.get("Text") or "")[:400],
                    "url": str(item.get("FirstURL") or ""),
                }
            )
        elif "Topics" in item:
            for sub in item.get("Topics") or []:
                if "Text" in sub:
                    related.append(
                        {
                            "text": str(sub.get("Text") or "")[:400],
                            "url": str(sub.get("FirstURL") or ""),
                        }
                    )
                if len(related) >= max_related:
                    break
        if len(related) >= max_related:
            break
    return {
        "provider": "duckduckgo_instant",
        "query": query,
        "heading": data.get("Heading") or "",
        "abstract": data.get("AbstractText") or "",
        "abstract_url": data.get("AbstractURL") or "",
        "answer": data.get("Answer") or "",
        "related": related,
        "source": "https://duckduckgo.com/",
    }


def wikipedia_opensearch(query: str, *, limit: int = 5) -> dict[str, Any]:
    """Wikipedia OpenSearch (no key) — open-source knowledge fallback."""
    params = urllib.parse.urlencode(
        {
            "action": "opensearch",
            "search": query,
            "limit": limit,
            "namespace": 0,
            "format": "json",
        }
    )
    url = f"https://en.wikipedia.org/w/api.php?{params}"
    _, body = _http_get(url)
    payload = json.loads(body)
    titles = payload[1] if len(payload) > 1 else []
    descs = payload[2] if len(payload) > 2 else []
    links = payload[3] if len(payload) > 3 else []
    results = [
        {"title": t, "description": d, "url": u}
        for t, d, u in zip(titles, descs, links, strict=False)
    ]
    return {"provider": "wikipedia_opensearch", "query": query, "results": results}


def fetch_allowlisted(url: str, *, max_chars: int = 4000) -> dict[str, Any]:
    """Fetch a URL only if it matches the privacy allowlist."""
    cleaned = (url or "").strip()
    if not any(cleaned.startswith(prefix) for prefix in FETCH_ALLOW_PREFIXES):
        return {
            "ok": False,
            "error": "url_not_allowlisted",
            "detail": "Fetch limited to Microsoft Learn, OurAirports, Wikipedia, GitHub docs, Hugging Face docs.",
            "url": cleaned,
        }
    final_url, body = _http_get(cleaned, accept="text/html,application/json;q=0.9")
    text = _strip_html(body)[:max_chars]
    return {"ok": True, "url": final_url, "chars": len(text), "text": text}


def wikipedia_summary(title: str) -> dict[str, Any]:
    """Fetch a short extract for a Wikipedia title (enriches empty OpenSearch descriptions)."""
    cleaned = (title or "").strip()
    if not cleaned:
        return {"ok": False, "error": "empty_title"}
    params = urllib.parse.urlencode(
        {
            "action": "query",
            "prop": "extracts",
            "exintro": 1,
            "explaintext": 1,
            "redirects": 1,
            "titles": cleaned,
            "format": "json",
        }
    )
    url = f"https://en.wikipedia.org/w/api.php?{params}"
    _, body = _http_get(url)
    data = json.loads(body)
    pages = ((data.get("query") or {}).get("pages") or {})
    for page in pages.values():
        extract = (page.get("extract") or "").strip()
        if extract:
            return {
                "ok": True,
                "title": page.get("title") or cleaned,
                "extract": extract[:800],
                "url": f"https://en.wikipedia.org/wiki/{urllib.parse.quote(str(page.get('title') or cleaned).replace(' ', '_'))}",
            }
    return {"ok": False, "error": "no_extract", "title": cleaned}


def research_online(query: str, *, fetch_url: str | None = None) -> dict[str, Any]:
    """Run online research for a question; never includes HCM database rows."""
    citations: list[dict[str, str]] = []
    sections: list[str] = []
    errors: list[str] = []
    ddg: dict[str, Any] = {}
    wiki: dict[str, Any] = {}
    fetched: dict[str, Any] | None = None

    queries = [query]
    # Fallback: drop filler words if Instant Answer returns empty (common for long queries).
    simplified = re.sub(
        r"\b(what|is|are|the|a|an|how|to|for|of|online|research|please|explain)\b",
        " ",
        query,
        flags=re.IGNORECASE,
    )
    simplified = _WS.sub(" ", simplified).strip()
    if simplified and simplified.casefold() != query.casefold():
        queries.append(simplified)

    for q_try in queries:
        try:
            ddg = duckduckgo_instant(q_try)
            if ddg.get("abstract") or ddg.get("answer") or ddg.get("related"):
                break
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
            errors.append(f"duckduckgo: {exc}")
            ddg = {}

    # Last-chance: use first meaningful token (e.g. "Ollama" from a long noisy query).
    if not (ddg.get("abstract") or ddg.get("answer") or ddg.get("related")):
        tokens = [
            t
            for t in re.findall(r"[A-Za-z][A-Za-z0-9._-]{2,}", query)
            if t.casefold()
            not in {
                "what",
                "the",
                "how",
                "for",
                "and",
                "api",
                "compatible",
                "localhost",
                "online",
                "research",
                "openai",
                "please",
                "explain",
            }
        ]
        for tok in tokens[:3]:
            if tok in queries:
                continue
            try:
                ddg = duckduckgo_instant(tok)
                if ddg.get("abstract") or ddg.get("answer") or ddg.get("related"):
                    queries.append(tok)
                    break
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
                errors.append(f"duckduckgo_token:{tok}: {exc}")
                ddg = {}

    if ddg:
        if ddg.get("abstract"):
            sections.append(f"DuckDuckGo: {ddg['abstract']}")
            if ddg.get("abstract_url"):
                citations.append({"title": ddg.get("heading") or "DuckDuckGo", "url": ddg["abstract_url"]})
        elif ddg.get("answer"):
            sections.append(f"DuckDuckGo answer: {ddg['answer']}")
        for rel in ddg.get("related") or []:
            if rel.get("text"):
                sections.append(rel["text"])
            if rel.get("url"):
                citations.append({"title": "Related", "url": rel["url"]})

    for q_try in queries:
        try:
            wiki = wikipedia_opensearch(q_try)
            if wiki.get("results"):
                break
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
            errors.append(f"wikipedia: {exc}")
            wiki = {}

    for item in wiki.get("results") or []:
        desc = (item.get("description") or "").strip()
        title = str(item.get("title") or "")
        if not desc and title:
            try:
                summ = wikipedia_summary(title)
                if summ.get("ok"):
                    desc = str(summ.get("extract") or "")
                    if summ.get("url"):
                        item["url"] = summ["url"]
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
                errors.append(f"wikipedia_summary: {exc}")
        bit = f"{title}: {desc}".strip(": ").strip()
        if bit:
            sections.append(bit)
        if item.get("url"):
            citations.append({"title": title or "Wikipedia", "url": item["url"]})

    if fetch_url:
        try:
            fetched = fetch_allowlisted(fetch_url)
            if fetched.get("ok") and fetched.get("text"):
                sections.append(f"Fetched {fetched['url']}: {fetched['text'][:1200]}")
                citations.append({"title": "Fetched page", "url": str(fetched["url"])})
            elif fetched and not fetched.get("ok"):
                errors.append(str(fetched.get("detail") or fetched.get("error")))
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            errors.append(f"fetch: {exc}")

    # Deduplicate citations by URL
    seen: set[str] = set()
    unique_citations: list[dict[str, str]] = []
    for c in citations:
        u = c.get("url") or ""
        if not u or u in seen:
            continue
        seen.add(u)
        unique_citations.append(c)

    reply_bits = sections[:8]
    if not reply_bits and errors:
        summary = "Online research failed (" + "; ".join(errors[:2]) + "). Local knowledge may still help."
    elif not reply_bits:
        summary = "No online snippets found. Try a more specific query or an allowlisted URL."
    else:
        summary = "Online research (cited):\n" + "\n".join(f"• {b}" for b in reply_bits)

    return {
        "ok": bool(reply_bits),
        "query": query,
        "summary": summary,
        "citations": unique_citations[:10],
        "duckduckgo": {k: ddg.get(k) for k in ("heading", "abstract", "abstract_url", "answer")} if ddg else {},
        "wikipedia": wiki.get("results") or [],
        "fetch": fetched,
        "errors": errors,
        "privacy_note": (
            "Only the research query/URL left this host. HCM MSSQL rows were not transmitted."
        ),
    }


def remember_research(
    session: Session,
    *,
    query: str,
    result: dict[str, Any],
    actor: str | None = None,
) -> None:
    """Persist research outcome into the local learning store."""
    session.add(
        AiLearningEventRow(
            id=str(uuid4()),
            event_type="research",
            check_code="online_research",
            severity="info",
            summary=(result.get("summary") or query)[:2000],
            details={
                "query": query,
                "citations": result.get("citations") or [],
                "ok": result.get("ok"),
                "errors": result.get("errors") or [],
            },
            outcome="success" if result.get("ok") else "failed",
            confidence=0.7 if result.get("ok") else 0.3,
            created_by=actor,
        )
    )
    session.flush()
