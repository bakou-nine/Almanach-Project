from __future__ import annotations

from urllib.parse import urlparse, urlunparse


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
