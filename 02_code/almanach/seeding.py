"""First-run seeding (CR-260704-0800-003 — moved out of app.py).

Two seeds, in order:
  1. Stage the bundled curated default library while the DB is still empty so
     every curated source is proposed as ADDED (US-260525-1200-002,
     AC-260525-1200-020). Runs once ever, gated by a settings flag.
  2. Legacy flat seed: add up to 10 popular sources through the same
     discovery + persist path used by the UI when the DB has no sources.

Runs on a daemon thread (BUG-260704-0735-001) so startup never blocks on the
discovery waterfall; failures are logged, never fatal.
"""
from __future__ import annotations

import logging
import threading

from . import config, discovery, models, portability, settings_store
from .naming import resolve_display_name
from .urls import canonical_source_url

log = logging.getLogger(__name__)

SEED_SOURCES = [
    "https://www.theverge.com",
    "https://arstechnica.com",
    "https://news.ycombinator.com",
    "https://www.bbc.com/news",
    "https://www.reuters.com",
    "https://www.lemonde.fr",
    "https://www.lesechos.fr",
    "https://feeds.npr.org/1001/rss.xml",
    "https://techcrunch.com",
    "https://www.theguardian.com/international",
]


def start_background() -> None:
    """Kick off first-run seeding on a daemon thread (BUG-260704-0735-001)."""
    threading.Thread(target=run, daemon=True).start()


def run() -> None:
    try:
        _seed_staged_default_library()
        _seed_if_empty()
    except Exception as e:  # noqa: BLE001 — seeding must never kill the thread
        log.warning("first-run seeding failed: %s", e)


def _seed_staged_default_library() -> None:
    if settings_store.get("default_library_seeded") == "1":
        return
    try:
        path = config.default_library_path()
        n = portability.stage_from_file(path)
        settings_store.set_value("default_library_seeded", "1")
        log.info("first-run: staged %d items from bundled default library", n)
    except Exception as e:  # noqa: BLE001 — seeding must never block startup
        log.warning("default-library seed staging failed: %s", e)


def _seed_if_empty() -> None:
    if models.list_sources():
        return
    for raw in SEED_SOURCES:
        try:
            canonical = canonical_source_url(raw)
            if models.find_source_by_canonical_url(canonical):
                continue
            result = discovery.discover(canonical)
            if not result.success:
                log.info("seed skipped (%s): %s", raw, result.error)
                continue
            display_name = resolve_display_name(result.feed_url, canonical)
            colour = settings_store.next_palette_colour()
            models.insert_source(
                url=canonical,
                feed_url=result.feed_url,
                discovery_method=result.method,
                display_name=display_name,
                colour=colour,
            )
            log.info("seeded source: %s (%s)", display_name, raw)
        except Exception as e:
            log.warning("seed failed for %s: %s", raw, e)
