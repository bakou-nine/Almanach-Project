from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from typing import Iterator

from . import config

_local = threading.local()

SCHEMA = """
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
    consecutive_failure_count INTEGER NOT NULL DEFAULT 0
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
"""

DEFAULT_SETTINGS = {
    "polling_interval_minutes": "20",
    "retention_days": "30",
    "next_palette_index": "0",
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
    conn.commit()


def close() -> None:
    conn = getattr(_local, "conn", None)
    if conn is not None:
        conn.close()
        _local.conn = None
