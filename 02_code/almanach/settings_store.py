from __future__ import annotations

from typing import Optional

from . import config
from .db import get_connection, transaction


def get(key: str, default: Optional[str] = None) -> Optional[str]:
    cur = get_connection().cursor()
    cur.execute("SELECT value FROM settings WHERE key = ?", (key,))
    row = cur.fetchone()
    if row is None:
        return default
    return row["value"]


def get_int(key: str, default: int) -> int:
    raw = get(key)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def set_value(key: str, value: str) -> None:
    with transaction() as conn:
        conn.execute(
            "INSERT INTO settings(key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )


def polling_interval_minutes() -> int:
    return max(5, min(120, get_int("polling_interval_minutes", 20)))


def retention_days() -> int:
    return max(1, min(365, get_int("retention_days", 30)))


def next_palette_colour() -> str:
    """Atomically pop the next palette colour and advance the persisted pointer.

    Round-robin through config.PALETTE; pointer survives app restarts.
    """
    with transaction() as conn:
        cur = conn.execute(
            "SELECT value FROM settings WHERE key = 'next_palette_index'"
        )
        row = cur.fetchone()
        idx = int(row["value"]) if row else 0
        colour = config.PALETTE[idx % len(config.PALETTE)]
        next_idx = (idx + 1) % len(config.PALETTE)
        conn.execute(
            "INSERT INTO settings(key, value) VALUES ('next_palette_index', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (str(next_idx),),
        )
        return colour
