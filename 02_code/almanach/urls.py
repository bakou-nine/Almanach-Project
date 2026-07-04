from __future__ import annotations

import html
import ipaddress
import re
import socket
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


def private_target_reason(url: str) -> Optional[str]:
    """SSRF guard (CR-260704-0800-001): reason string when `url` targets a
    loopback, private, link-local, or otherwise non-global address — None when
    the target looks public.

    Literal IPs are classified directly; hostnames are resolved and rejected if
    ANY resolved address is non-global. An unresolvable hostname returns None —
    the subsequent fetch fails with its own error, which is not an SSRF risk.
    """
    host = urlparse(url).hostname
    if not host:
        return "URL has no host"
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None
    if ip is not None:
        return None if ip.is_global else f"{host} is a private or local address"
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return None
    for info in infos:
        try:
            resolved = ipaddress.ip_address(info[4][0])
        except ValueError:
            continue
        if not resolved.is_global:
            return f"{host} resolves to a private or local address"
    return None


def origin_of(url: str) -> str:
    """Return scheme://host[:port] with no path/query."""
    parsed = urlparse(url)
    host = parsed.hostname or ""
    netloc = host if not parsed.port else f"{host}:{parsed.port}"
    return f"{parsed.scheme}://{netloc}"
