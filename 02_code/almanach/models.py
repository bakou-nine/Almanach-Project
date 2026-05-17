from __future__ import annotations

import logging
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Iterable, Optional

from .db import get_connection, transaction

log = logging.getLogger(__name__)


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")


def new_id() -> str:
    return str(uuid.uuid4())


# ---------- Source ----------


def list_sources() -> list[dict]:
    cur = get_connection().cursor()
    cur.execute(
        "SELECT id, url, feed_url, discovery_method, display_name, colour, muted, "
        "created_at, last_polled_at, last_error, consecutive_failure_count "
        "FROM source ORDER BY created_at ASC"
    )
    return [dict(r) for r in cur.fetchall()]


def get_source(source_id: str) -> Optional[dict]:
    cur = get_connection().cursor()
    cur.execute("SELECT * FROM source WHERE id = ?", (source_id,))
    row = cur.fetchone()
    return dict(row) if row else None


def find_source_by_canonical_url(canonical_url: str) -> Optional[dict]:
    cur = get_connection().cursor()
    cur.execute("SELECT * FROM source WHERE url = ?", (canonical_url,))
    row = cur.fetchone()
    return dict(row) if row else None


def insert_source(
    *,
    url: str,
    feed_url: str,
    discovery_method: str,
    display_name: str,
    colour: str,
) -> dict:
    sid = new_id()
    created = now_iso()
    with transaction() as conn:
        conn.execute(
            "INSERT INTO source (id, url, feed_url, discovery_method, display_name, "
            "colour, muted, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
            (sid, url, feed_url, discovery_method, display_name, colour, created),
        )
    return get_source(sid)  # type: ignore[return-value]


def update_display_name(source_id: str, display_name: str) -> bool:
    with transaction() as conn:
        cur = conn.execute(
            "UPDATE source SET display_name = ? WHERE id = ?",
            (display_name, source_id),
        )
    return cur.rowcount > 0


def set_muted(source_id: str, muted: bool) -> bool:
    with transaction() as conn:
        cur = conn.execute(
            "UPDATE source SET muted = ? WHERE id = ?",
            (1 if muted else 0, source_id),
        )
    return cur.rowcount > 0


def delete_source(source_id: str) -> bool:
    with transaction() as conn:
        cur = conn.execute("DELETE FROM source WHERE id = ?", (source_id,))
    return cur.rowcount > 0


def update_source_feed(source_id: str, feed_url: str, discovery_method: str) -> bool:
    with transaction() as conn:
        cur = conn.execute(
            "UPDATE source SET feed_url = ?, discovery_method = ? WHERE id = ?",
            (feed_url, discovery_method, source_id),
        )
    return cur.rowcount > 0


def record_poll_success(source_id: str) -> None:
    with transaction() as conn:
        conn.execute(
            "UPDATE source SET last_polled_at = ?, last_error = NULL, "
            "consecutive_failure_count = 0 WHERE id = ?",
            (now_iso(), source_id),
        )


def record_poll_failure(source_id: str, error: str) -> None:
    with transaction() as conn:
        conn.execute(
            "UPDATE source SET last_polled_at = ?, last_error = ?, "
            "consecutive_failure_count = consecutive_failure_count + 1 WHERE id = ?",
            (now_iso(), error[:500], source_id),
        )


# ---------- Article ----------


def insert_article(
    *,
    source_id: str,
    url: str,
    title: str,
    summary: Optional[str],
    published_at: str,
) -> Optional[dict]:
    aid = new_id()
    fetched = now_iso()
    try:
        with transaction() as conn:
            conn.execute(
                "INSERT INTO article (id, source_id, url, title, summary, "
                "published_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (aid, source_id, url, title, summary, published_at, fetched),
            )
    except sqlite3.IntegrityError:
        # Unique violation on url → already ingested, no-op.
        return None
    except sqlite3.Error as e:
        log.warning("article insert failed (%s): %s", url, e)
        return None
    cur = get_connection().cursor()
    cur.execute("SELECT * FROM article WHERE id = ?", (aid,))
    row = cur.fetchone()
    return dict(row) if row else None


def mark_read(article_id: str) -> bool:
    with transaction() as conn:
        cur = conn.execute(
            "UPDATE article SET read_at = COALESCE(read_at, ?) WHERE id = ?",
            (now_iso(), article_id),
        )
    return cur.rowcount > 0


def get_article(article_id: str) -> Optional[dict]:
    cur = get_connection().cursor()
    cur.execute("SELECT * FROM article WHERE id = ?", (article_id,))
    row = cur.fetchone()
    return dict(row) if row else None


def list_articles(
    *,
    source_id: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    include_muted: bool = False,
) -> list[dict]:
    sql = (
        "SELECT a.*, s.display_name AS source_name, s.colour AS source_colour, "
        "s.muted AS source_muted "
        "FROM article a JOIN source s ON s.id = a.source_id "
    )
    where: list[str] = []
    params: list = []
    if source_id is not None:
        where.append("a.source_id = ?")
        params.append(source_id)
    elif not include_muted:
        where.append("s.muted = 0")
    if where:
        sql += "WHERE " + " AND ".join(where) + " "
    sql += "ORDER BY a.published_at DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    cur = get_connection().cursor()
    cur.execute(sql, params)
    return [dict(r) for r in cur.fetchall()]


def count_articles(*, source_id: Optional[str] = None, include_muted: bool = False) -> int:
    sql = "SELECT COUNT(*) AS n FROM article a JOIN source s ON s.id = a.source_id "
    where: list[str] = []
    params: list = []
    if source_id is not None:
        where.append("a.source_id = ?")
        params.append(source_id)
    elif not include_muted:
        where.append("s.muted = 0")
    if where:
        sql += "WHERE " + " AND ".join(where)
    cur = get_connection().cursor()
    cur.execute(sql, params)
    return int(cur.fetchone()["n"])


def unread_counts_per_source() -> dict[str, int]:
    """Returns {source_id: unread_count} for all sources (muted included with 0)."""
    cur = get_connection().cursor()
    cur.execute(
        "SELECT source_id, COUNT(*) AS n FROM article WHERE read_at IS NULL "
        "GROUP BY source_id"
    )
    return {row["source_id"]: int(row["n"]) for row in cur.fetchall()}


def total_unread_excluding_muted() -> int:
    """All-sources sum, excluding muted (visible scope)."""
    cur = get_connection().cursor()
    cur.execute(
        "SELECT COUNT(*) AS n FROM article a JOIN source s ON s.id = a.source_id "
        "WHERE a.read_at IS NULL AND s.muted = 0"
    )
    return int(cur.fetchone()["n"])


def prune_old_articles(retention_days: int) -> int:
    """Delete articles whose fetched_at is older than the retention window.

    Returns the number of rows deleted. Uses fetched_at (not published_at) per
    DATA_MODEL.md §5.
    """
    with transaction() as conn:
        cur = conn.execute(
            "DELETE FROM article WHERE fetched_at < datetime('now', ?)",
            (f"-{retention_days} days",),
        )
    return cur.rowcount


def sources_to_poll() -> Iterable[dict]:
    """Every source — polling ignores muted (charter §3)."""
    return list_sources()
