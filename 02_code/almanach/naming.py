"""Shared display-name resolution (CR-260704-0800-003).

Formerly copy-pasted verbatim as `_resolve_display_name` in app.py and
portability.py — the add-source flow and import approval share this single
implementation now.
"""
from __future__ import annotations

from urllib.parse import urlparse


def resolve_display_name(feed_url: str, canonical: str) -> str:
    """Best-effort: fetch the feed and use its <title>; fall back to host."""
    try:
        import feedparser

        from . import ingestion

        raw = ingestion.fetch_feed_bytes(feed_url, timeout=5)
        parsed = feedparser.parse(raw)
        title = (parsed.feed.get("title") if hasattr(parsed, "feed") else None) or ""
        title = title.strip()
        if title:
            return title[:120]
    except Exception:
        pass
    host = urlparse(canonical).hostname or canonical
    if host.startswith("www."):
        host = host[4:]
    return host
