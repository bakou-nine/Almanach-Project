from __future__ import annotations

import re
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator

from . import config

_local = threading.local()


# Canonical row-identity + timestamp helpers (CR-260704-0800-003 — moved here
# from models.py so leaf modules like staging.py can use them without cycles;
# models.py re-exports both).


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")


def new_id() -> str:
    return str(uuid.uuid4())


def _kw_match(haystack, needle, case_sensitive: int, whole_word: int) -> int:
    """Per-keyword filter match (CR-260524-1315-001), registered as the SQL
    function `alm_kw_match(text, needle, case_sensitive, whole_word)`.

    Used only when a keyword carries the Match case and/or Match whole word
    option (AC-260524-1315-002 / -003); the no-option default keeps the prior
    LIKE-based case-insensitive substring path in `models._build_article_query`
    (AC-260524-0650-001 regression guard). Returns 1 on match, else 0.

    - Match whole word: the term must be bounded by non-letter characters on
      both sides (a Unicode letter is `[^\\W\\d_]`), i.e. it matches only as a
      standalone word, never inside a longer word.
    - Match case off: case-insensitive (Unicode-aware via `re.IGNORECASE` /
      `str.lower`); on: exact letter case.
    """
    if haystack is None or not needle:
        return 0
    if whole_word:
        flags = 0 if case_sensitive else re.IGNORECASE
        pattern = r"(?<![^\W\d_])" + re.escape(needle) + r"(?![^\W\d_])"
        return 1 if re.search(pattern, haystack, flags) else 0
    if case_sensitive:
        return 1 if needle in haystack else 0
    return 1 if needle.lower() in haystack.lower() else 0

SCHEMA = """
CREATE TABLE IF NOT EXISTS folder (
    id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES folder(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position REAL NOT NULL DEFAULT 0,
    collapsed INTEGER NOT NULL DEFAULT 0,
    muted INTEGER NOT NULL DEFAULT 0,
    depth INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    feed_url TEXT NOT NULL,
    discovery_method TEXT NOT NULL CHECK (discovery_method IN ('alternate_link','common_path','sitemap')),
    display_name TEXT NOT NULL,
    colour TEXT NOT NULL,
    muted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_polled_at TEXT,
    last_error TEXT,
    consecutive_failure_count INTEGER NOT NULL DEFAULT 0,
    folder_id TEXT REFERENCES folder(id) ON DELETE SET NULL,
    position REAL NOT NULL DEFAULT 0,
    reliability TEXT NOT NULL DEFAULT 'medium' CHECK (reliability IN ('high','medium','low')),
    impact TEXT NOT NULL DEFAULT 'medium' CHECK (impact IN ('high','medium','low'))
);

CREATE TABLE IF NOT EXISTS article (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
    url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    summary TEXT,
    published_at TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    read_at TEXT,
    folder_id TEXT REFERENCES folder(id) ON DELETE SET NULL,
    position REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Import staging zone (EP — Data Portability, DATA_MODEL.md §11). Two-zone
-- safeguard: import never writes the live folder/source tables; proposed
-- changes land here until approved in the Review screen.
CREATE TABLE IF NOT EXISTS import_staging (
    id TEXT PRIMARY KEY,
    object_kind TEXT NOT NULL CHECK (object_kind IN ('folder','source')),
    change_type TEXT NOT NULL CHECK (change_type IN ('ADDED','MODIFIED','REMOVED')),
    staged_data TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_import_staging_kind ON import_staging(object_kind);

-- Media Content Projects (FT-260704-1620-001, DATA_MODEL.md §1.6/§1.7/§2.5).
-- Junction cascades are junction-only in both directions: deleting a project
-- never deletes articles; deleting an article silently drops its memberships.
CREATE TABLE IF NOT EXISTS project (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    position REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_article (
    project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    article_id TEXT NOT NULL REFERENCES article(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL,
    PRIMARY KEY (project_id, article_id)
);

CREATE INDEX IF NOT EXISTS idx_project_article_project_id ON project_article(project_id);
CREATE INDEX IF NOT EXISTS idx_project_article_article_id ON project_article(article_id);

CREATE INDEX IF NOT EXISTS idx_source_url ON source(url);
CREATE INDEX IF NOT EXISTS idx_article_url ON article(url);
CREATE INDEX IF NOT EXISTS idx_article_published_at ON article(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_source_id ON article(source_id);
CREATE INDEX IF NOT EXISTS idx_article_read_at_null ON article(read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_folder_parent_id ON folder(parent_id);
-- idx_source_folder_id is created by `_ensure_source_iter3_columns` so that
-- it runs AFTER the legacy-to-iter3 ALTER adds the column to a pre-FT05 DB.
-- idx_article_folder_id is created by `_ensure_article_hierarchy_columns`
-- so it runs AFTER the additive ALTER on pre-CR-260523-0900-001 DBs.
"""

# Iteration-3 depth cap (CR-260522-2101-001 / AC-260522-2400-001).
MAX_FOLDER_DEPTH = 5

DEFAULT_SETTINGS = {
    # BUG-260704-0735-009: seeded from the single default in config.py.
    "polling_interval_minutes": str(config.POLLING_INTERVAL_DEFAULT_MIN),
    "retention_days": "30",
    "next_palette_index": "0",
    "grouping_banner_dismissed": "0",
    "sidebar_width_px": "260",
}


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(
        str(config.db_path()),
        detect_types=sqlite3.PARSE_DECLTYPES,
        check_same_thread=False,
        # BUG-260704-0735-003: autocommit mode — transaction() below issues an
        # explicit BEGIN IMMEDIATE so write transactions take the write lock at
        # BEGIN, not at first DML. Deferred locks let read-modify-write
        # sequences from the three writer threads (event loop, scheduler,
        # watcher) interleave and violate check-then-act invariants.
        isolation_level=None,
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    # Writers waiting on the lock retry for up to 5 s instead of failing
    # immediately with SQLITE_BUSY (BUG-260704-0735-003).
    conn.execute("PRAGMA busy_timeout = 5000")
    # Per-keyword Match case / Match whole word matching (CR-260524-1315-001).
    conn.create_function("alm_kw_match", 4, _kw_match, deterministic=True)
    return conn


def get_connection() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = _connect()
        _local.conn = conn
    return conn


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    """Write transaction under an IMMEDIATE lock (BUG-260704-0735-003).

    BEGIN IMMEDIATE serialises writers up front, so a read-modify-write inside
    one transaction() block (palette pointer, staging replace) cannot interleave
    with another thread's writes. Not re-entrant — never nest transaction()."""
    conn = get_connection()
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def initialise() -> None:
    conn = get_connection()
    conn.executescript(SCHEMA)
    cur = conn.cursor()
    for k, v in DEFAULT_SETTINGS.items():
        cur.execute(
            "INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)",
            (k, v),
        )
    # One-shot migration: BUG-260521-2051-001 reset the default polling cadence
    # from 20 min to 10 min. Existing DBs that still carry the prior default
    # (20) are flipped to 10; user-customised values (anything else) are left
    # untouched.
    cur.execute(
        "UPDATE settings SET value = '10' "
        "WHERE key = 'polling_interval_minutes' AND value = '20'"
    )
    # CR-260522-2101-001 iteration 3: collapse legacy group + subgroup tables
    # into the single recursive `folder` table; rewire Source.folder_id.
    # Idempotent — skipped on a DB that already has the iteration-3 shape.
    _ensure_source_iter3_columns(cur)
    _migrate_legacy_groups_to_folder(cur)
    _drop_legacy_source_grouping_columns(cur)
    _ensure_article_hierarchy_columns(cur)
    _ensure_source_rating_columns(cur)
    conn.commit()


def _ensure_source_rating_columns(cur: sqlite3.Cursor) -> None:
    """Add Source.reliability + Source.impact if missing (FT — Source Ratings).

    Additive migration (DATA_MODEL.md §7) — on a fresh DB created from SCHEMA
    both columns already exist (no-op); on a pre-ratings DB the SCHEMA CREATE is
    skipped (table exists) so the columns are added here, backfilling existing
    rows with 'medium'. SQLite cannot add a NOT NULL column with a CHECK in one
    step on every version, so the value enum is enforced application-side
    (models.set_source_ratings) mirroring discovery_method.
    """
    cur.execute("PRAGMA table_info(source)")
    existing = {row["name"] for row in cur.fetchall()}
    if "reliability" not in existing:
        cur.execute(
            "ALTER TABLE source ADD COLUMN reliability TEXT NOT NULL DEFAULT 'medium'"
        )
    if "impact" not in existing:
        cur.execute(
            "ALTER TABLE source ADD COLUMN impact TEXT NOT NULL DEFAULT 'medium'"
        )


def _ensure_article_hierarchy_columns(cur: sqlite3.Cursor) -> None:
    """Add Article.folder_id + Article.position if missing (CR-260523-0900-001).

    Additive migration — pre-CR Article rows land with folder_id=NULL
    (inherit grouping from Source) and position=0.
    """
    cur.execute("PRAGMA table_info(article)")
    existing = {row["name"] for row in cur.fetchall()}
    if "folder_id" not in existing:
        cur.execute(
            "ALTER TABLE article ADD COLUMN folder_id TEXT "
            "REFERENCES folder(id) ON DELETE SET NULL"
        )
    if "position" not in existing:
        cur.execute("ALTER TABLE article ADD COLUMN position REAL NOT NULL DEFAULT 0")
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_article_folder_id ON article(folder_id)"
    )


def _ensure_source_iter3_columns(cur: sqlite3.Cursor) -> None:
    """Add Source.folder_id + Source.position if missing.

    On a fresh DB created from SCHEMA, both columns are already present;
    this is a no-op. On an iteration-1/2 DB the SCHEMA's CREATE TABLE is
    skipped (table exists), so the columns are added here.
    """
    cur.execute("PRAGMA table_info(source)")
    existing = {row["name"] for row in cur.fetchall()}
    if "folder_id" not in existing:
        cur.execute(
            "ALTER TABLE source ADD COLUMN folder_id TEXT "
            "REFERENCES folder(id) ON DELETE SET NULL"
        )
    if "position" not in existing:
        cur.execute("ALTER TABLE source ADD COLUMN position REAL NOT NULL DEFAULT 0")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_source_folder_id ON source(folder_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_folder_parent_id ON folder(parent_id)")


def _legacy_tables_exist(cur: sqlite3.Cursor) -> bool:
    cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('group','subgroup')"
    )
    return len(cur.fetchall()) > 0


def _migrate_legacy_groups_to_folder(cur: sqlite3.Cursor) -> None:
    """Walk the iteration-1/2 → iteration-3 transition exactly once.

    Steps (per DATA_MODEL.md §7):
      1. Copy every `group` row → folder with depth=1, parent_id=NULL.
      2. Copy every `subgroup` row → folder with depth=2,
         parent_id = matched group's folder id.
      3. Backfill source.folder_id from subgroup_id (preferred) or group_id.
      4. Drop subgroup + group tables.
    """
    if not _legacy_tables_exist(cur):
        return
    # Copy groups → folder (id preserved so source.group_id can be used as
    # the folder-id lookup directly; FT05 ids are UUIDs, no collision risk).
    cur.execute(
        'INSERT OR IGNORE INTO folder (id, parent_id, name, position, '
        'collapsed, muted, depth, created_at) '
        'SELECT id, NULL, name, position, collapsed, muted, 1, created_at '
        'FROM "group"'
    )
    cur.execute(
        "INSERT OR IGNORE INTO folder (id, parent_id, name, position, "
        "collapsed, muted, depth, created_at) "
        "SELECT id, group_id, name, position, collapsed, muted, 2, created_at "
        "FROM subgroup"
    )
    # Backfill Source.folder_id: subgroup wins over group when both set.
    cur.execute(
        "UPDATE source SET folder_id = COALESCE(subgroup_id, group_id) "
        "WHERE folder_id IS NULL AND (subgroup_id IS NOT NULL OR group_id IS NOT NULL)"
    )
    # Drop legacy tables.
    cur.execute("DROP TABLE IF EXISTS subgroup")
    cur.execute('DROP TABLE IF EXISTS "group"')


def _drop_legacy_source_grouping_columns(cur: sqlite3.Cursor) -> None:
    """Drop source.group_id / source.subgroup_id if they still exist.

    Requires SQLite ≥ 3.35 (ALTER TABLE DROP COLUMN). Python 3.11+ on
    modern OSes ships with ≥ 3.40. The drop is purely cosmetic — if it
    fails on an old SQLite the columns remain present but unused.
    """
    cur.execute("PRAGMA table_info(source)")
    existing = {row["name"] for row in cur.fetchall()}
    # Drop the auxiliary indexes first so the column drops don't fail on
    # outstanding index references (SQLite would otherwise refuse).
    cur.execute("DROP INDEX IF EXISTS idx_source_group_id")
    cur.execute("DROP INDEX IF EXISTS idx_source_subgroup_id")
    if "subgroup_id" in existing:
        try:
            cur.execute("ALTER TABLE source DROP COLUMN subgroup_id")
        except sqlite3.OperationalError:
            pass
    if "group_id" in existing:
        try:
            cur.execute("ALTER TABLE source DROP COLUMN group_id")
        except sqlite3.OperationalError:
            pass


def close() -> None:
    conn = getattr(_local, "conn", None)
    if conn is not None:
        conn.close()
        _local.conn = None
