from __future__ import annotations

import os
from pathlib import Path


def data_dir() -> Path:
    p = Path(os.environ.get("ALMANACH_DATA_DIR", Path.home() / ".almanach"))
    p.mkdir(parents=True, exist_ok=True)
    return p


def db_path() -> Path:
    return data_dir() / "almanach.sqlite3"


USER_AGENT = "Almanach/0.1 (+https://github.com/local/almanach personal news aggregator)"

REQUEST_TIMEOUT_S = 10
HEAD_SCAN_TIMEOUT_S = 5
COMMON_PATH_TIMEOUT_S = 2
SITEMAP_TIMEOUT_S = 3
DISCOVERY_TOTAL_BUDGET_S = 10

POLITE_DELAY_PER_DOMAIN_S = 2.0

PAGE_SIZE_DEFAULT = 50
PAGE_SIZE_MAX = 200

PALETTE = [
    "#378ADD",
    "#D4537E",
    "#1D9E75",
    "#BA7517",
    "#7F77DD",
    "#0F6E56",
    "#C44A4A",
    "#5B8DEF",
    "#9B5DA8",
    "#3FA9B0",
    "#E08A2A",
    "#5A7D2C",
]
