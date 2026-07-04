"""Import-staging CRUD (EP — Data Portability, DATA_MODEL.md §11).

Extracted from models.py (CR-260704-0800-003); models.py re-exports these so
`models.list_staging` etc. keep working for every existing caller.
"""
from __future__ import annotations

import json
import sqlite3
from typing import Optional

from .db import get_connection, new_id, now_iso, transaction


def clear_staging() -> None:
    with transaction() as conn:
        conn.execute("DELETE FROM import_staging")


def replace_staging(rows: list[tuple[str, str, Optional[dict]]]) -> int:
    """Atomically replace the whole staging snapshot (BUG-260704-0735-003).

    Clear + insert run in ONE immediate transaction, so a concurrent /review
    read sees either the previous complete proposal set or the new complete
    set — never an empty or half-filled intermediate (AC-260704-0735-006).
    `rows` are (object_kind, change_type, staged_data) tuples.
    """
    with transaction() as conn:
        conn.execute("DELETE FROM import_staging")
        for object_kind, change_type, staged_data in rows:
            conn.execute(
                "INSERT INTO import_staging (id, object_kind, change_type, "
                "staged_data, created_at) VALUES (?, ?, ?, ?, ?)",
                (
                    new_id(),
                    object_kind,
                    change_type,
                    json.dumps(staged_data) if staged_data is not None else None,
                    now_iso(),
                ),
            )
    return len(rows)


def insert_staging(
    object_kind: str, change_type: str, staged_data: Optional[dict]
) -> str:
    sid = new_id()
    payload = json.dumps(staged_data) if staged_data is not None else None
    with transaction() as conn:
        conn.execute(
            "INSERT INTO import_staging (id, object_kind, change_type, staged_data, "
            "created_at) VALUES (?, ?, ?, ?, ?)",
            (sid, object_kind, change_type, payload, now_iso()),
        )
    return sid


def _staging_row(row: sqlite3.Row) -> dict:
    d = dict(row)
    raw = d.get("staged_data")
    d["staged_data"] = json.loads(raw) if raw else None
    return d


def list_staging() -> list[dict]:
    cur = get_connection().cursor()
    cur.execute(
        "SELECT id, object_kind, change_type, staged_data, created_at "
        "FROM import_staging ORDER BY object_kind DESC, created_at ASC"
    )
    return [_staging_row(r) for r in cur.fetchall()]


def get_staging(staging_id: str) -> Optional[dict]:
    cur = get_connection().cursor()
    cur.execute("SELECT * FROM import_staging WHERE id = ?", (staging_id,))
    row = cur.fetchone()
    return _staging_row(row) if row else None


def delete_staging(staging_id: str) -> bool:
    with transaction() as conn:
        cur = conn.execute("DELETE FROM import_staging WHERE id = ?", (staging_id,))
    return cur.rowcount > 0


def count_staging() -> int:
    cur = get_connection().cursor()
    cur.execute("SELECT COUNT(*) AS n FROM import_staging")
    return int(cur.fetchone()["n"])
