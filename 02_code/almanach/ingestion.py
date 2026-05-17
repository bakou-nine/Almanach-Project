from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

import feedparser
import httpx

from . import config, models
from .urls import origin_of

log = logging.getLogger(__name__)

MAX_SUMMARY_CHARS = 280


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")


def _entry_published(entry) -> str:
    parsed = getattr(entry, "published_parsed", None) or getattr(
        entry, "updated_parsed", None
    )
    if parsed:
        try:
            return datetime(*parsed[:6], tzinfo=timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%S.%f"
            )
        except Exception:
            pass
    return _now_iso()


def _entry_summary(entry) -> Optional[str]:
    for attr in ("summary", "description", "subtitle"):
        v = getattr(entry, attr, None)
        if v:
            text = str(v).strip()
            if text:
                if len(text) > MAX_SUMMARY_CHARS:
                    text = text[:MAX_SUMMARY_CHARS].rstrip() + "…"
                return text
    return None


def _entry_url(entry) -> Optional[str]:
    link = getattr(entry, "link", None)
    if link:
        return link
    links = getattr(entry, "links", None) or []
    for ln in links:
        href = ln.get("href") if isinstance(ln, dict) else None
        if href:
            return href
    return None


def _entry_title(entry) -> str:
    return (getattr(entry, "title", "") or "Untitled").strip()


def fetch_feed_bytes(feed_url: str, timeout: float = config.REQUEST_TIMEOUT_S) -> bytes:
    headers = {"User-Agent": config.USER_AGENT}
    with httpx.Client(timeout=timeout, follow_redirects=True, headers=headers) as c:
        resp = c.get(feed_url)
        resp.raise_for_status()
        return resp.content


def ingest_source(source: dict) -> tuple[int, int]:
    """Fetch + parse the source's feed; insert any new articles.

    Returns (new_count, total_entries_seen). Sources with discovery_method=sitemap
    use feedparser too (it handles sitemap-like XML well enough for MVP — entries
    are loc URLs without titles, which we synthesise from the URL slug).

    Self-heal: if a poll produces zero new articles AND the source has produced
    zero total articles ever, the stored feed_url is presumed stale (e.g.
    discovery has improved since the source was added). Re-run discovery on the
    canonical URL and, if a different feed_url surfaces, persist it and re-ingest
    once.
    """
    new_count, seen = _ingest_from(source, source["feed_url"], source["discovery_method"])
    if new_count == 0 and models.count_articles(source_id=source["id"]) == 0:
        from . import discovery as _disc

        try:
            result = _disc.discover(source["url"])
        except Exception as e:
            log.warning("self-heal discovery failed for %s: %s", source["display_name"], e)
            return (new_count, seen)
        if result.success and result.feed_url and result.feed_url != source["feed_url"]:
            log.info(
                "self-heal: %s feed_url %s -> %s (method %s -> %s)",
                source["display_name"],
                source["feed_url"],
                result.feed_url,
                source["discovery_method"],
                result.method,
            )
            models.update_source_feed(source["id"], result.feed_url, result.method or "sitemap")
            updated = models.get_source(source["id"])
            if updated is not None:
                return _ingest_from(updated, updated["feed_url"], updated["discovery_method"])
    return (new_count, seen)


def _ingest_from(source: dict, feed_url: str, method: str) -> tuple[int, int]:
    try:
        raw = fetch_feed_bytes(feed_url)
    except Exception as e:
        models.record_poll_failure(source["id"], f"fetch: {e}")
        log.warning("poll fetch failed for %s: %s", source["display_name"], e)
        return (0, 0)

    new_count = 0
    seen = 0
    is_sitemap = method == "sitemap"
    if is_sitemap:
        entries = _parse_sitemap_entries(raw)
    else:
        parsed = feedparser.parse(raw)
        entries = list(parsed.entries or [])

    for entry in entries:
        seen += 1
        if is_sitemap:
            url = entry.get("url")
            title = entry.get("title") or "Untitled"
            summary = entry.get("summary")
            published = entry.get("published") or _now_iso()
        else:
            url = _entry_url(entry)
            title = _entry_title(entry)
            summary = _entry_summary(entry)
            published = _entry_published(entry)
        if not url:
            continue
        inserted = models.insert_article(
            source_id=source["id"],
            url=url,
            title=title,
            summary=summary,
            published_at=published,
        )
        if inserted is not None:
            new_count += 1

    models.record_poll_success(source["id"])
    return (new_count, seen)


_NEWS_NS = "{http://www.google.com/schemas/sitemap-news/0.9}"


def _parse_sitemap_entries(raw: bytes) -> list[dict]:
    """Minimal sitemap parser. Returns a list of dicts with url/title/published.

    Handles both <urlset> (URL entries) and <sitemapindex> (referenced sitemaps —
    we skip referenced sitemaps in MVP and only ingest direct <url> entries).
    When a <url> carries the Google News <news:news> child, prefer its
    <news:title> + <news:publication_date> over slug-derived defaults.
    """
    from xml.etree import ElementTree as ET

    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return []

    ns = ""
    if root.tag.startswith("{"):
        ns = root.tag.split("}", 1)[0] + "}"

    entries: list[dict] = []
    for url_el in root.findall(f"{ns}url"):
        loc = url_el.find(f"{ns}loc")
        if loc is None or not loc.text:
            continue
        url = loc.text.strip()

        news_title_el = url_el.find(f"{_NEWS_NS}news/{_NEWS_NS}title")
        news_pub_el = url_el.find(f"{_NEWS_NS}news/{_NEWS_NS}publication_date")

        if news_title_el is not None and news_title_el.text and news_title_el.text.strip():
            title = news_title_el.text.strip()
        else:
            title = _slug_to_title(url)

        if news_pub_el is not None and news_pub_el.text and news_pub_el.text.strip():
            published = news_pub_el.text.strip()
        else:
            lastmod_el = url_el.find(f"{ns}lastmod")
            published = (
                lastmod_el.text.strip()
                if (lastmod_el is not None and lastmod_el.text)
                else _now_iso()
            )

        entries.append(
            {"url": url, "title": title, "summary": None, "published": published}
        )
    return entries


def _slug_to_title(url: str) -> str:
    from urllib.parse import urlparse

    path = urlparse(url).path.rstrip("/")
    if not path:
        return url
    slug = path.rsplit("/", 1)[-1]
    slug = slug.split("?", 1)[0].split("#", 1)[0]
    # Drop a trailing .html/.htm/numeric-id pattern.
    for ext in (".html", ".htm", ".php"):
        if slug.endswith(ext):
            slug = slug[: -len(ext)]
    parts = slug.replace("_", "-").split("-")
    words = [p for p in parts if p and not p.isdigit()]
    if not words:
        return url
    return " ".join(w[:1].upper() + w[1:] for w in words)
