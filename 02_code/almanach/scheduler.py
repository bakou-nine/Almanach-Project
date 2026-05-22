from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse

from apscheduler.schedulers.background import BackgroundScheduler

from . import ingestion, models, settings_store
from .urls import origin_of

log = logging.getLogger(__name__)

POLL_JOB_ID = "almanach_poll"
RETENTION_JOB_ID = "almanach_retention"

_scheduler: Optional[BackgroundScheduler] = None
_domain_locks: dict[str, threading.Lock] = {}
_domain_last_hit: dict[str, float] = {}
_domain_locks_lock = threading.Lock()
_manual_poll_lock = threading.Lock()


def _domain_of(url: str) -> str:
    return (urlparse(url).hostname or "").lower()


def _acquire_polite_slot(url: str, min_gap_s: float = 2.0) -> None:
    """Per-domain throttle: at most one request every min_gap_s per host."""
    domain = _domain_of(url)
    if not domain:
        return
    with _domain_locks_lock:
        lock = _domain_locks.setdefault(domain, threading.Lock())
    with lock:
        last = _domain_last_hit.get(domain, 0.0)
        wait = min_gap_s - (time.monotonic() - last)
        if wait > 0:
            time.sleep(wait)
        _domain_last_hit[domain] = time.monotonic()


def _poll_all_sources() -> None:
    log.info("poll cycle start")
    sources = list(models.sources_to_poll())
    for src in sources:
        try:
            _acquire_polite_slot(src["feed_url"])
            new_count, seen = ingestion.ingest_source(src)
            log.info(
                "polled %s: %d new / %d seen",
                src["display_name"],
                new_count,
                seen,
            )
        except Exception as e:
            log.exception("poll failed for %s: %s", src["display_name"], e)
            try:
                models.record_poll_failure(src["id"], str(e))
            except Exception:
                pass
    log.info("poll cycle done")


def _retention_sweep() -> None:
    days = settings_store.retention_days()
    deleted = models.prune_old_articles(days)
    log.info("retention sweep deleted %d articles older than %d days", deleted, days)


def last_sync_at() -> Optional[datetime]:
    """Read MAX(source.last_polled_at) from the DB so the value survives restarts."""
    return models.latest_poll_at()


def trigger_manual_poll() -> None:
    """Run a poll cycle now in a worker thread (legacy fire-and-forget)."""
    if _scheduler is None:
        threading.Thread(target=_poll_all_sources, daemon=True).start()
        return
    _scheduler.add_job(_poll_all_sources, id=f"manual-{time.time()}", replace_existing=False)


def run_manual_poll_blocking() -> None:
    """Run a poll cycle synchronously in the caller's thread.

    Used by the /refresh HTTP endpoint so the response only returns once the
    cycle has completed — the frontend can then show real completion feedback
    (BUG-260521-2051-001 defect #2). Serialised via _manual_poll_lock so
    concurrent /refresh clicks queue rather than racing.
    """
    with _manual_poll_lock:
        _poll_all_sources()


def start() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    interval = settings_store.polling_interval_minutes()
    _scheduler = BackgroundScheduler(daemon=True, timezone="UTC")
    _scheduler.add_job(
        _poll_all_sources,
        "interval",
        minutes=interval,
        id=POLL_JOB_ID,
        next_run_time=datetime.now(timezone.utc),
        max_instances=1,
        coalesce=True,
    )
    _scheduler.add_job(
        _retention_sweep,
        "interval",
        hours=24,
        id=RETENTION_JOB_ID,
        max_instances=1,
        coalesce=True,
    )
    _scheduler.start()
    log.info("scheduler started: poll every %d min", interval)


def stop() -> None:
    global _scheduler
    if _scheduler is None:
        return
    _scheduler.shutdown(wait=False)
    _scheduler = None
