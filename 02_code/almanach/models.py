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
        "created_at, last_polled_at, last_error, consecutive_failure_count, "
        "folder_id, position "
        "FROM source ORDER BY position ASC, created_at ASC"
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
    """Delete a source and every Article that references it, atomically.

    Belt-and-braces: the article→source FK has ON DELETE CASCADE and
    PRAGMA foreign_keys = ON is set on every connection, but the explicit
    article DELETE here guarantees cascade-delete semantics even if a future
    connection ever forgets to enable FK enforcement (AC-260522-2030-002).
    """
    with transaction() as conn:
        conn.execute("DELETE FROM article WHERE source_id = ?", (source_id,))
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
    after: Optional[str] = None,
) -> list[dict]:
    """List articles newest-first, optionally filtered by source / cursor.

    Cascade mute (CR-260522-2101-001 iteration 2, DATA_MODEL.md §2.3):
    when `source_id` is None (combined "All sources" view), filter out
    articles whose Source.muted=1 OR parent Group.muted=1 OR parent
    Subgroup.muted=1. When `source_id` is set (explicit per-source view),
    the cascade is ignored and the source's own muted flag is also ignored.

    `after` is a cursor — when present, only articles with
    `published_at < after` are returned (descending order).
    """
    sql = (
        "WITH RECURSIVE muted_subtree(id) AS ("
        "  SELECT id FROM folder WHERE muted = 1"
        "  UNION"
        "  SELECT f.id FROM folder f JOIN muted_subtree m ON f.parent_id = m.id"
        ") "
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
        where.append(
            "(s.folder_id IS NULL OR s.folder_id NOT IN (SELECT id FROM muted_subtree))"
        )
    if after is not None:
        where.append("a.published_at < ?")
        params.append(after)
    if where:
        sql += "WHERE " + " AND ".join(where) + " "
    sql += "ORDER BY a.published_at DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    cur = get_connection().cursor()
    cur.execute(sql, params)
    return [dict(r) for r in cur.fetchall()]


def count_articles(*, source_id: Optional[str] = None, include_muted: bool = False) -> int:
    sql = (
        "WITH RECURSIVE muted_subtree(id) AS ("
        "  SELECT id FROM folder WHERE muted = 1"
        "  UNION"
        "  SELECT f.id FROM folder f JOIN muted_subtree m ON f.parent_id = m.id"
        ") "
        "SELECT COUNT(*) AS n FROM article a JOIN source s ON s.id = a.source_id "
    )
    where: list[str] = []
    params: list = []
    if source_id is not None:
        where.append("a.source_id = ?")
        params.append(source_id)
    elif not include_muted:
        where.append("s.muted = 0")
        where.append(
            "(s.folder_id IS NULL OR s.folder_id NOT IN (SELECT id FROM muted_subtree))"
        )
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
    """All-sources unread sum, excluding sources that are muted directly OR via
    any muted ancestor Folder (cascade per DATA_MODEL.md §2.3)."""
    cur = get_connection().cursor()
    cur.execute(
        "WITH RECURSIVE muted_subtree(id) AS ("
        "  SELECT id FROM folder WHERE muted = 1"
        "  UNION"
        "  SELECT f.id FROM folder f JOIN muted_subtree m ON f.parent_id = m.id"
        ") "
        "SELECT COUNT(*) AS n FROM article a "
        "JOIN source s ON s.id = a.source_id "
        "WHERE a.read_at IS NULL AND s.muted = 0 "
        "AND (s.folder_id IS NULL OR s.folder_id NOT IN (SELECT id FROM muted_subtree))"
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


# ---------- Folder (FT05 / CR-260522-2101-001 iteration 3) ----------


class InvariantViolation(ValueError):
    """Legacy invariant violation (iteration 1/2). Kept for backwards compat."""


class DepthLimitExceeded(ValueError):
    """Raised when a folder insert or move would push depth above the cap."""


class CycleViolation(ValueError):
    """Raised when a folder move would place a folder under one of its own descendants."""


def list_folders() -> list[dict]:
    cur = get_connection().cursor()
    cur.execute(
        "SELECT id, parent_id, name, position, collapsed, muted, depth, created_at "
        "FROM folder ORDER BY depth ASC, position ASC, created_at ASC"
    )
    return [dict(r) for r in cur.fetchall()]


def get_folder(folder_id: str) -> Optional[dict]:
    cur = get_connection().cursor()
    cur.execute("SELECT * FROM folder WHERE id = ?", (folder_id,))
    row = cur.fetchone()
    return dict(row) if row else None


def count_folders() -> int:
    cur = get_connection().cursor()
    cur.execute("SELECT COUNT(*) AS n FROM folder")
    return int(cur.fetchone()["n"])


def _depth_of(parent_id: Optional[str]) -> int:
    """Return the depth a child of `parent_id` would have. 1 if parent_id is None."""
    if parent_id is None:
        return 1
    parent = get_folder(parent_id)
    if parent is None:
        raise ValueError("parent folder not found")
    return int(parent["depth"]) + 1


def _max_subtree_depth_offset(folder_id: str) -> int:
    """Return (max_descendant_depth - this folder's depth). 0 if no descendants.

    Used to compute whether reparenting a folder would push any descendant
    past the depth cap.
    """
    cur = get_connection().cursor()
    cur.execute(
        "WITH RECURSIVE sub(id, depth) AS ("
        "  SELECT id, depth FROM folder WHERE id = ?"
        "  UNION ALL"
        "  SELECT f.id, f.depth FROM folder f JOIN sub s ON f.parent_id = s.id"
        ") SELECT MAX(depth) AS m, MIN(depth) AS r FROM sub",
        (folder_id,),
    )
    row = cur.fetchone()
    if row is None or row["m"] is None:
        return 0
    return int(row["m"]) - int(row["r"])


def _is_descendant_of(candidate: str, ancestor: str) -> bool:
    """Return True iff `candidate` is in the subtree rooted at `ancestor`."""
    if candidate == ancestor:
        return True
    cur = get_connection().cursor()
    cur.execute(
        "WITH RECURSIVE sub(id) AS ("
        "  SELECT id FROM folder WHERE id = ?"
        "  UNION ALL"
        "  SELECT f.id FROM folder f JOIN sub s ON f.parent_id = s.id"
        ") SELECT 1 FROM sub WHERE id = ? LIMIT 1",
        (ancestor, candidate),
    )
    return cur.fetchone() is not None


def insert_folder(name: str, *, parent_id: Optional[str] = None) -> dict:
    """Create a folder. Raises DepthLimitExceeded if depth would exceed the cap."""
    from .db import MAX_FOLDER_DEPTH

    new_depth = _depth_of(parent_id)
    if new_depth > MAX_FOLDER_DEPTH:
        raise DepthLimitExceeded(
            f"would create depth {new_depth}, max is {MAX_FOLDER_DEPTH}"
        )
    fid = new_id()
    created = now_iso()
    with transaction() as conn:
        cur = conn.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM folder "
            "WHERE parent_id IS ?",
            (parent_id,),
        )
        position = float(cur.fetchone()["p"])
        conn.execute(
            "INSERT INTO folder (id, parent_id, name, position, collapsed, muted, "
            "depth, created_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?)",
            (fid, parent_id, name, position, new_depth, created),
        )
        # Creating a sub-folder auto-expands its parent (US-260522-2116-006
        # iteration-1 contract retargeted to the folder model).
        if parent_id is not None:
            conn.execute(
                "UPDATE folder SET collapsed = 0 WHERE id = ?", (parent_id,)
            )
    return get_folder(fid)  # type: ignore[return-value]


def insert_folder_with_banner_dismiss(
    name: str, *, parent_id: Optional[str] = None
) -> dict:
    """Create a folder AND set grouping_banner_dismissed = 1 in the same
    transaction (iteration-1 AC-260522-2118-030 contract retargeted to
    /folders — first folder ever created auto-dismisses the onboarding
    banner)."""
    from .db import MAX_FOLDER_DEPTH

    new_depth = _depth_of(parent_id)
    if new_depth > MAX_FOLDER_DEPTH:
        raise DepthLimitExceeded(
            f"would create depth {new_depth}, max is {MAX_FOLDER_DEPTH}"
        )
    fid = new_id()
    created = now_iso()
    with transaction() as conn:
        cur = conn.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM folder "
            "WHERE parent_id IS ?",
            (parent_id,),
        )
        position = float(cur.fetchone()["p"])
        conn.execute(
            "INSERT INTO folder (id, parent_id, name, position, collapsed, muted, "
            "depth, created_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?)",
            (fid, parent_id, name, position, new_depth, created),
        )
        if parent_id is not None:
            conn.execute(
                "UPDATE folder SET collapsed = 0 WHERE id = ?", (parent_id,)
            )
        conn.execute(
            "INSERT INTO settings(key, value) VALUES "
            "('grouping_banner_dismissed', '1') "
            "ON CONFLICT(key) DO UPDATE SET value = '1'"
        )
    return get_folder(fid)  # type: ignore[return-value]


_PARENT_UNCHANGED = object()


def update_folder(
    folder_id: str,
    *,
    name: Optional[str] = None,
    position: Optional[float] = None,
    collapsed: Optional[bool] = None,
    muted: Optional[bool] = None,
    parent_id=_PARENT_UNCHANGED,
) -> bool:
    """Update a folder's mutable fields.

    `parent_id` is treated as a sentinel: pass `None` to make the folder a
    root; pass a folder id to reparent. Omit (default sentinel) to leave the
    parent unchanged. Reparenting validates depth + cycle constraints and
    recomputes `depth` for the moved folder and every descendant in the same
    transaction.
    """
    from .db import MAX_FOLDER_DEPTH

    current = get_folder(folder_id)
    if current is None:
        return False

    parent_change = parent_id is not _PARENT_UNCHANGED and parent_id != current["parent_id"]
    if parent_change:
        # Cycle guard.
        if parent_id is not None and _is_descendant_of(parent_id, folder_id):
            raise CycleViolation("cannot move a folder under one of its own descendants")
        # Depth-cap guard.
        new_root_depth = _depth_of(parent_id)
        offset = _max_subtree_depth_offset(folder_id)
        if new_root_depth + offset > MAX_FOLDER_DEPTH:
            raise DepthLimitExceeded(
                f"move would push subtree max-depth to {new_root_depth + offset}, "
                f"cap is {MAX_FOLDER_DEPTH}"
            )

    sets: list[str] = []
    params: list = []
    if name is not None:
        sets.append("name = ?")
        params.append(name)
    if position is not None:
        sets.append("position = ?")
        params.append(float(position))
    if collapsed is not None:
        sets.append("collapsed = ?")
        params.append(1 if collapsed else 0)
    if muted is not None:
        sets.append("muted = ?")
        params.append(1 if muted else 0)
    if parent_change:
        sets.append("parent_id = ?")
        params.append(parent_id)
        sets.append("depth = ?")
        params.append(_depth_of(parent_id))
    if not sets:
        return False
    params.append(folder_id)
    with transaction() as conn:
        cur = conn.execute(
            f"UPDATE folder SET {', '.join(sets)} WHERE id = ?", params
        )
        if parent_change and cur.rowcount > 0:
            # Recompute depth for the entire moved subtree. Walk top-down
            # so each child sees its parent's updated depth.
            _recompute_subtree_depth(conn, folder_id)
    return cur.rowcount > 0


def _recompute_subtree_depth(conn: sqlite3.Connection, root_id: str) -> None:
    """Recompute `Folder.depth` for every descendant of `root_id` (exclusive).

    Assumes `root_id` already has its correct depth set.
    """
    # Walk BFS so parents are processed before children.
    cur = conn.execute("SELECT depth FROM folder WHERE id = ?", (root_id,))
    row = cur.fetchone()
    if row is None:
        return
    queue = [(root_id, int(row["depth"]))]
    while queue:
        pid, pdepth = queue.pop(0)
        cur = conn.execute(
            "SELECT id FROM folder WHERE parent_id = ?", (pid,)
        )
        for child in cur.fetchall():
            new_d = pdepth + 1
            conn.execute(
                "UPDATE folder SET depth = ? WHERE id = ?", (new_d, child["id"])
            )
            queue.append((child["id"], new_d))


def delete_folder(folder_id: str) -> bool:
    """Delete a folder. FK CASCADE drops the entire descendant subtree;
    FK SET NULL detaches every source whose `folder_id` references any
    deleted folder (sources return to Ungrouped)."""
    with transaction() as conn:
        # Belt-and-braces: explicitly detach sources whose folder_id sits in
        # the subtree, so we don't rely solely on FK SET NULL after the
        # cascade.
        conn.execute(
            "UPDATE source SET folder_id = NULL WHERE folder_id IN ("
            "  WITH RECURSIVE sub(id) AS ("
            "    SELECT id FROM folder WHERE id = ?"
            "    UNION ALL"
            "    SELECT f.id FROM folder f JOIN sub s ON f.parent_id = s.id"
            "  ) SELECT id FROM sub"
            ")",
            (folder_id,),
        )
        cur = conn.execute("DELETE FROM folder WHERE id = ?", (folder_id,))
    return cur.rowcount > 0


def set_source_folder(
    source_id: str,
    *,
    folder_id: Optional[str],
    position: Optional[float] = None,
) -> bool:
    """Reassign a Source's `folder_id` and optionally its `position`."""
    if folder_id is not None and get_folder(folder_id) is None:
        raise ValueError("folder not found")
    sets = ["folder_id = ?"]
    params: list = [folder_id]
    if position is not None:
        sets.append("position = ?")
        params.append(float(position))
    params.append(source_id)
    with transaction() as conn:
        cur = conn.execute(
            f"UPDATE source SET {', '.join(sets)} WHERE id = ?",
            params,
        )
    return cur.rowcount > 0


def muted_folder_subtree_ids() -> set[str]:
    """Return the set of folder ids whose subtree should be considered muted.

    A folder is in the muted-subtree set if it is itself muted OR any of its
    ancestors is muted (cascade per DATA_MODEL.md §2.3).
    """
    cur = get_connection().cursor()
    cur.execute(
        "WITH RECURSIVE muted_subtree(id) AS ("
        "  SELECT id FROM folder WHERE muted = 1"
        "  UNION"
        "  SELECT f.id FROM folder f JOIN muted_subtree m ON f.parent_id = m.id"
        ") SELECT id FROM muted_subtree"
    )
    return {row["id"] for row in cur.fetchall()}


# ---------- Settings helpers (FT05 banner) ----------


def get_grouping_banner_dismissed() -> bool:
    cur = get_connection().cursor()
    cur.execute(
        "SELECT value FROM settings WHERE key = 'grouping_banner_dismissed'"
    )
    row = cur.fetchone()
    if row is None:
        return False
    return row["value"] in ("1", "true", "True")


def set_grouping_banner_dismissed(value: bool) -> None:
    with transaction() as conn:
        conn.execute(
            "INSERT INTO settings(key, value) VALUES ('grouping_banner_dismissed', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            ("1" if value else "0",),
        )


def latest_poll_at() -> Optional[datetime]:
    """Return MAX(source.last_polled_at) across all sources, or None if none polled.

    Source of truth for the header last-sync indicator (BUG-260521-2051-001
    defect #3 — persisted across sessions, surviving process restarts).
    """
    cur = get_connection().cursor()
    cur.execute("SELECT MAX(last_polled_at) AS m FROM source")
    row = cur.fetchone()
    if row is None or row["m"] is None:
        return None
    raw = row["m"]
    try:
        dt = datetime.fromisoformat(raw.replace("Z", ""))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt
