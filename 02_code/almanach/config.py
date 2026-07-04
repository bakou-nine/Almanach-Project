from __future__ import annotations

import os
from pathlib import Path


def data_dir() -> Path:
    # Default data dir = the project's "04_Almanach Library" folder (this file is
    # almanach/config.py, so parents[2] is the project root: almanach -> 02_code ->
    # root). This keeps the live DB and the sync/library files together in the same
    # organized folder no matter how the app is launched (shortcut, IDE, run.bat).
    # ALMANACH_DATA_DIR still overrides the default when set.
    default = Path(__file__).resolve().parents[2] / "04_Almanach Library"
    p = Path(os.environ.get("ALMANACH_DATA_DIR", default))
    p.mkdir(parents=True, exist_ok=True)
    return p


def db_path() -> Path:
    return data_dir() / "almanach.sqlite3"


# --- Data Portability (EP — Data Portability, DATA_MODEL.md §9/§10) ---

PORTABILITY_SCHEMA = "almanach-portability/v1"


def library_path() -> Path:
    """The portability YAML the watcher monitors and Export writes."""
    return data_dir() / "almanach-library.yaml"


def sync_path() -> Path:
    """The sync-control file mirroring Filum's project-sync.yaml."""
    return data_dir() / "almanach-sync.yaml"


def default_library_path() -> Path:
    """Bundled first-run default library (curated `AI news proposal` tree)."""
    return Path(__file__).parent / "data" / "default_library.yaml"


USER_AGENT = "Almanach/0.1 (+https://github.com/local/almanach personal news aggregator)"

REQUEST_TIMEOUT_S = 10
HEAD_SCAN_TIMEOUT_S = 5
COMMON_PATH_TIMEOUT_S = 2
SITEMAP_TIMEOUT_S = 3
DISCOVERY_TOTAL_BUDGET_S = 10

POLITE_DELAY_PER_DOMAIN_S = 2.0

# Single source of truth for the default polling cadence (BUG-260704-0735-009):
# referenced by BOTH the DB seed (db.DEFAULT_SETTINGS) and the settings reader
# (settings_store.polling_interval_minutes). Runtime default 10 min per
# BUG-260521-2051-001; charter range 5-120 min.
POLLING_INTERVAL_DEFAULT_MIN = 10

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
