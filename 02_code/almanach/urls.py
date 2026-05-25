from __future__ import annotations

import html
import re
from typing import Optional
from urllib.parse import urlparse, urlunparse

# BUG-260525-0745-001: RSS <description>/<summary> often carries HTML markup
# (and entities), and ingestion truncates it — sometimes mid-tag/entity. Rendered
# auto-escaped, that surfaces as garbled fragments in the feed. `clean_html_text`
# strips tags + unescapes entities + drops any dangling tag left by truncation,
# yielding plain readable text. Applied at render (fixes already-stored rows) and
# at ingestion (clean going forward); idempotent on already-clean text.
_HTML_TAG_RE = re.compile(r"<[^>]*>")
_DANGLING_TAG_RE = re.compile(r"<[^>]*$")
_WS_RE = re.compile(r"\s+")


def clean_html_text(raw: Optional[str], max_chars: Optional[int] = None) -> Optional[str]:
    if not raw:
        return raw
    text = str(raw).replace("<![CDATA[", "").replace("]]>", "")
    text = _DANGLING_TAG_RE.sub("", text)   # drop a trailing tag cut by truncation
    text = _HTML_TAG_RE.sub("", text)       # strip complete tags
    text = html.unescape(text)              # &amp; &#8217; … -> real chars
    text = _WS_RE.sub(" ", text).strip()
    if max_chars and len(text) > max_chars:
        text = text[:max_chars].rstrip() + "…"
    return text or None


def canonical_source_url(raw: str) -> str:
    """Normalise a homepage URL for dedup comparison.

    Rules (per US-260512-2300-002 / AC-260512-2300-003):
        - scheme + host lowercased
        - leading 'www.' stripped from host
        - path trailing slash stripped (but a single '/' becomes empty)
        - query/fragment dropped (homepages don't carry them)
    """
    parsed = urlparse(raw.strip())
    scheme = (parsed.scheme or "https").lower()
    host = (parsed.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if parsed.port:
        host = f"{host}:{parsed.port}"
    path = parsed.path or ""
    if path.endswith("/"):
        path = path.rstrip("/")
    return urlunparse((scheme, host, path, "", "", ""))


def is_valid_http_url(raw: str) -> bool:
    if not raw:
        return False
    try:
        parsed = urlparse(raw.strip())
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    if not parsed.hostname:
        return False
    return True


def origin_of(url: str) -> str:
    """Return scheme://host[:port] with no path/query."""
    parsed = urlparse(url)
    host = parsed.hostname or ""
    netloc = host if not parsed.port else f"{host}:{parsed.port}"
    return f"{parsed.scheme}://{netloc}"
