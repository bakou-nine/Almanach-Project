from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from typing import Iterator

from . import config

_local = threading.local()

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
    position REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS article (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
    url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    summary TEXT,
    published_at TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    read_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_source_url ON source(url);
CREATE INDEX IF NOT EXISTS idx_article_url ON article(url);
CREATE INDEX IF NOT EXISTS idx_article_published_at ON article(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_source_id ON article(source_id);
CREATE INDEX IF NOT EXISTS idx_article_read_at_null ON article(read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_folder_parent_id ON folder(parent_id);
-- idx_source_folder_id is created by `_ensure_source_iter3_columns` so that
-- it runs AFTER the legacy-to-iter3 ALTER adds the column to a pre-FT05 DB.
"""

# Iteration-3 depth cap (CR-260522-2101-001 / AC-260522-2400-001).
MAX_FOLDER_DEPTH = 5

DEFAULT_SETTINGS = {
    "polling_interval_minutes": "10",
    "retention_days": "30",
    "next_palette_index": "0",
    "grouping_banner_dismissed": "0",
}


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(
        str(config.db_path()),
        detect_types=sqlite3.PARSE_DECLTYPES,
        check_same_thread=False,
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def get_connection() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = _connect()
        _local.conn = conn
    return conn


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    conn = get_connection()
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
    conn.commit()


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
