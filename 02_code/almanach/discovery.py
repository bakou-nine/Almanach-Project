from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urljoin
from xml.etree import ElementTree as ET

import httpx
from bs4 import BeautifulSoup

from . import config
from .urls import origin_of

FEED_CONTENT_TYPES = (
    "application/rss+xml",
    "application/atom+xml",
    "application/xml",
    "text/xml",
)

COMMON_PATHS = ("/feed", "/rss", "/atom.xml")


@dataclass
class StepResult:
    step: str
    success: bool
    feed_url: Optional[str] = None
    reason: Optional[str] = None
    details: Optional[str] = None


@dataclass
class DiscoveryResult:
    success: bool
    feed_url: Optional[str] = None
    method: Optional[str] = None
    error: Optional[str] = None
    details: Optional[str] = None
    steps: list[StepResult] = field(default_factory=list)


def _client(timeout: float) -> httpx.Client:
    return httpx.Client(
        timeout=timeout,
        follow_redirects=True,
        headers={"User-Agent": config.USER_AGENT},
    )


def head_scan(homepage_url: str, timeout: float = config.HEAD_SCAN_TIMEOUT_S) -> StepResult:
    try:
        with _client(timeout) as c:
            resp = c.get(homepage_url)
            if resp.status_code >= 400:
                return StepResult(
                    "alternate_link",
                    False,
                    reason="fetch_error",
                    details=f"HTTP {resp.status_code}",
                )
            html = resp.text
            base = str(resp.url)
    except httpx.TimeoutException as e:
        return StepResult("alternate_link", False, reason="fetch_error", details=f"timeout: {e}")
    except httpx.HTTPError as e:
        return StepResult("alternate_link", False, reason="fetch_error", details=str(e))

    soup = BeautifulSoup(html, "lxml")
    head = soup.head or soup
    candidates: list[tuple[int, str]] = []  # (priority, href). 0 = RSS, 1 = Atom
    for link in head.find_all("link"):
        rel = link.get("rel")
        if not rel:
            continue
        rel_value = " ".join(rel) if isinstance(rel, list) else str(rel)
        if "alternate" not in rel_value.lower():
            continue
        ctype = (link.get("type") or "").lower()
        href = link.get("href")
        if not href:
            continue
        if ctype == "application/rss+xml":
            candidates.append((0, href))
        elif ctype == "application/atom+xml":
            candidates.append((1, href))
    if not candidates:
        return StepResult("alternate_link", False, reason="no_alternate_link")

    candidates.sort(key=lambda t: t[0])
    chosen = candidates[0][1]
    feed_url = urljoin(base, chosen)
    return StepResult("alternate_link", True, feed_url=feed_url)


def common_path_probe(
    homepage_url: str, timeout: float = config.COMMON_PATH_TIMEOUT_S
) -> StepResult:
    origin = origin_of(homepage_url)
    with _client(timeout) as c:
        for path in COMMON_PATHS:
            candidate = origin + path
            try:
                resp = c.head(candidate)
                if resp.status_code == 405:
                    # Some servers reject HEAD; fall back to a tiny GET range.
                    resp = c.get(candidate, headers={"Range": "bytes=0-1024"})
                if resp.status_code != 200:
                    continue
                ctype = resp.headers.get("content-type", "").split(";")[0].strip().lower()
                if ctype in FEED_CONTENT_TYPES:
                    return StepResult("common_path", True, feed_url=candidate)
                # Sites like lefigaro.fr return 200 + HTML at /rss with an
                # index of actual feed URLs. Parse the body for <a> hrefs
                # pointing to .xml / .rss / /rss/ / /feed/ and probe them.
                if "html" in ctype:
                    full = c.get(candidate)
                    if full.status_code != 200:
                        continue
                    found = _harvest_feed_from_html(full.text, str(full.url), c)
                    if found:
                        return StepResult("common_path", True, feed_url=found)
            except httpx.HTTPError:
                continue
    return StepResult("common_path", False, reason="all_common_paths_404")


def _harvest_feed_from_html(html: str, base_url: str, client: httpx.Client) -> Optional[str]:
    """Scan HTML for feed candidates and return the first one that resolves
    to a feed-shaped resource.

    Looks at: head <link rel="alternate" type="application/rss+xml|atom+xml">
    (in case the path returned a sub-page with proper alternate-links), and
    body <a href> values whose URL ends in .xml/.rss or contains a /rss/ or
    /feed/ path segment. Candidates are validated by a small range-GET and
    Content-Type check before being returned.
    """
    soup = BeautifulSoup(html, "lxml")
    candidates: list[tuple[int, str]] = []  # (priority, absolute_url)

    head = soup.head or soup
    for link in head.find_all("link"):
        rel = link.get("rel")
        if not rel:
            continue
        rel_value = " ".join(rel) if isinstance(rel, list) else str(rel)
        if "alternate" not in rel_value.lower():
            continue
        ltype = (link.get("type") or "").lower()
        href = link.get("href")
        if not href:
            continue
        if ltype == "application/rss+xml":
            candidates.append((0, urljoin(base_url, href)))
        elif ltype == "application/atom+xml":
            candidates.append((1, urljoin(base_url, href)))

    for a in soup.find_all("a"):
        href = a.get("href")
        if not href:
            continue
        h = href.strip().lower()
        if h.endswith(".xml") or h.endswith(".rss"):
            candidates.append((2, urljoin(base_url, href)))
        elif "/rss/" in h or "/feed/" in h or "/atom/" in h:
            candidates.append((3, urljoin(base_url, href)))

    seen: set[str] = set()
    ordered: list[str] = []
    for _prio, url in sorted(candidates, key=lambda t: t[0]):
        if url in seen:
            continue
        seen.add(url)
        ordered.append(url)

    for cand in ordered[:10]:
        try:
            r = client.get(cand, headers={"Range": "bytes=0-1024"})
        except httpx.HTTPError:
            continue
        # 206 = Partial Content (the Range header was honoured); both are fine.
        if r.status_code not in (200, 206):
            continue
        ct = r.headers.get("content-type", "").split(";")[0].strip().lower()
        if ct in FEED_CONTENT_TYPES:
            return cand
    return None


def sitemap_fallback(
    homepage_url: str, timeout: float = config.SITEMAP_TIMEOUT_S
) -> StepResult:
    origin = origin_of(homepage_url)
    last_reason: str = "no_sitemap"
    last_details: Optional[str] = None
    saw_unparseable = False
    saw_fetch_error = False
    with _client(timeout) as c:
        # Build candidate list: robots-declared sitemaps first (sorted with
        # news-flavoured URLs ahead of archive/video/topics), then the two
        # well-known root paths as a last resort.
        candidates: list[str] = []
        candidates.extend(_robots_sitemaps(origin, c))
        for path in ("/sitemap.xml", "/news-sitemap.xml"):
            full = origin + path
            if full not in candidates:
                candidates.append(full)

        for url in candidates:
            try:
                resp = c.get(url)
            except httpx.TimeoutException as e:
                saw_fetch_error = True
                last_details = f"timeout: {e}"
                continue
            except httpx.HTTPError as e:
                saw_fetch_error = True
                last_details = str(e)
                continue
            if resp.status_code != 200:
                last_details = f"HTTP {resp.status_code} at {url}"
                continue
            try:
                root = ET.fromstring(resp.text)
            except ET.ParseError as e:
                saw_unparseable = True
                last_details = f"XML parse error at {url}: {e}"
                continue
            tag = root.tag.lower()
            if tag.endswith("sitemapindex"):
                # Recurse one level: pick the most recently-modified inner
                # sitemap and verify it's a parseable <urlset>.
                inner = _pick_inner_sitemap(root)
                for inner_url in inner[:3]:
                    try:
                        r2 = c.get(inner_url)
                    except httpx.HTTPError as e:
                        saw_fetch_error = True
                        last_details = str(e)
                        continue
                    if r2.status_code != 200:
                        continue
                    try:
                        r2_root = ET.fromstring(r2.text)
                    except ET.ParseError as e:
                        saw_unparseable = True
                        last_details = f"XML parse error at {inner_url}: {e}"
                        continue
                    if r2_root.tag.lower().endswith("urlset"):
                        return StepResult("sitemap", True, feed_url=inner_url)
                continue
            if tag.endswith("urlset"):
                return StepResult("sitemap", True, feed_url=url)
    if saw_unparseable:
        last_reason = "sitemap_unparsable"
    elif saw_fetch_error:
        last_reason = "fetch_error"
    return StepResult("sitemap", False, reason=last_reason, details=last_details)


_SITEMAP_PRIORITY_BUMP = ("news", "article")
_SITEMAP_PRIORITY_DROP = (
    "archive",
    "video",
    "audio",
    "image",
    "topic",
    "ws-topics",
    "podcast",
)


def _robots_sitemaps(origin: str, client: httpx.Client) -> list[str]:
    """Read /robots.txt and return Sitemap: declarations sorted so that
    news-flavoured URLs come first and archive/video/topic URLs come last.
    Returns [] if robots.txt is missing or has no Sitemap lines.
    """
    try:
        r = client.get(origin + "/robots.txt")
    except httpx.HTTPError:
        return []
    if r.status_code != 200:
        return []
    sitemaps: list[str] = []
    for raw_line in r.text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.lower().startswith("sitemap:"):
            value = line.split(":", 1)[1].strip()
            if value:
                sitemaps.append(value)

    def score(u: str) -> int:
        lu = u.lower()
        s = 0
        if any(token in lu for token in _SITEMAP_PRIORITY_BUMP):
            s -= 10
        if any(token in lu for token in _SITEMAP_PRIORITY_DROP):
            s += 10
        return s

    sitemaps.sort(key=score)
    return sitemaps


def _pick_inner_sitemap(root: ET.Element) -> list[str]:
    """Given a <sitemapindex> root, return its inner sitemap URLs sorted
    most-recently-modified first (falls back to document order)."""
    ns = ""
    if root.tag.startswith("{"):
        ns = root.tag.split("}", 1)[0] + "}"
    entries: list[tuple[str, str]] = []  # (lastmod, url)
    for sm in root.findall(f"{ns}sitemap"):
        loc = sm.find(f"{ns}loc")
        if loc is None or not loc.text:
            continue
        lastmod_el = sm.find(f"{ns}lastmod")
        lastmod = lastmod_el.text.strip() if (lastmod_el is not None and lastmod_el.text) else ""
        entries.append((lastmod, loc.text.strip()))
    # Reverse-sort by lastmod (empty strings end up last).
    entries.sort(key=lambda t: t[0], reverse=True)
    return [u for _lm, u in entries]


def discover(homepage_url: str) -> DiscoveryResult:
    """Run the three-step waterfall with a 10s total wall-clock budget.

    Returns the first successful step's result, or the last step's error if all
    fail (per AC-260513-0000-008: the user-visible error is the deepest step's
    reason, never step 1's `no_alternate_link`).
    """
    deadline = time.monotonic() + config.DISCOVERY_TOTAL_BUDGET_S
    steps: list[StepResult] = []

    def remaining() -> float:
        return max(0.1, deadline - time.monotonic())

    timeout = min(config.HEAD_SCAN_TIMEOUT_S, remaining())
    s1 = head_scan(homepage_url, timeout=timeout)
    steps.append(s1)
    if s1.success:
        return DiscoveryResult(True, feed_url=s1.feed_url, method="alternate_link", steps=steps)

    if remaining() <= 0.2:
        return _final_failure(steps)

    timeout = min(config.COMMON_PATH_TIMEOUT_S, remaining())
    s2 = common_path_probe(homepage_url, timeout=timeout)
    steps.append(s2)
    if s2.success:
        return DiscoveryResult(True, feed_url=s2.feed_url, method="common_path", steps=steps)

    if remaining() <= 0.2:
        return _final_failure(steps)

    timeout = min(config.SITEMAP_TIMEOUT_S, remaining())
    s3 = sitemap_fallback(homepage_url, timeout=timeout)
    steps.append(s3)
    if s3.success:
        return DiscoveryResult(True, feed_url=s3.feed_url, method="sitemap", steps=steps)

    return _final_failure(steps)


def _final_failure(steps: list[StepResult]) -> DiscoveryResult:
    last = steps[-1]
    return DiscoveryResult(
        success=False,
        error=last.reason or "fetch_error",
        details=last.details,
        steps=steps,
    )


REASON_TO_USER_MESSAGE = {
    "no_alternate_link": "No RSS or Atom link found in the page head.",
    "all_common_paths_404": "No feed at /feed, /rss, or /atom.xml.",
    "no_sitemap": "No sitemap.xml or news-sitemap.xml found.",
    "sitemap_unparsable": "Sitemap found but it could not be parsed.",
    "fetch_error": "Could not reach the site (network error or timeout).",
}


def humanise(error: Optional[str]) -> str:
    if error is None:
        return "Discovery failed for an unknown reason."
    return REASON_TO_USER_MESSAGE.get(error, f"Discovery failed: {error}.")
