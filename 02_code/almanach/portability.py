"""Data Portability (EP — Data Portability).

Moves the source library (folders + sources + ratings) in and out as a single
versioned YAML (`almanach-portability/v1`), mirroring Filum's DB↔YAML sync:

  - **Export** serialises the live folder tree + sources (+ ratings) to
    `<ALMANACH_DATA_DIR>/almanach-library.yaml` and flags the sync file.
  - **Import** never writes the live tables — it stages proposed changes
    (`import_staging`, DATA_MODEL.md §11) for human review/approve.
  - The sync-control file (`almanach-sync.yaml`, DATA_MODEL.md §10) carries the
    `status: ready|import` handshake the watcher reacts to.

`feed_url` / `discovery_method` / `display_name` / `colour` are NOT stored — the
discovery waterfall (§1.1) resolves them on approval, exactly as add-source does.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import yaml

from . import config, discovery, models, scheduler, settings_store
from .naming import resolve_display_name
from .urls import canonical_source_url

log = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------- Export: live DB → portability dict / file ----------------


def build_library_dict() -> dict:
    """Serialise the live folder tree + sources (+ ratings) to a
    `almanach-portability/v1` dict (DATA_MODEL.md §9)."""
    folders = models.list_folders()
    sources = models.list_sources()

    children_of: dict[Optional[str], list[dict]] = {}
    for f in folders:
        children_of.setdefault(f["parent_id"], []).append(f)
    sources_of: dict[Optional[str], list[dict]] = {}
    for s in sources:
        sources_of.setdefault(s.get("folder_id"), []).append(s)

    def source_entry(s: dict) -> dict:
        return {
            "url": s["url"],
            "reliability": s.get("reliability") or "medium",
            "impact": s.get("impact") or "medium",
        }

    def folder_node(f: dict) -> dict:
        node: dict = {"name": f["name"]}
        kids = [folder_node(c) for c in children_of.get(f["id"], [])]
        if kids:
            node["children"] = kids
        srcs = [source_entry(s) for s in sources_of.get(f["id"], [])]
        if srcs:
            node["sources"] = srcs
        return node

    roots = [folder_node(f) for f in children_of.get(None, [])]
    ungrouped = [source_entry(s) for s in sources_of.get(None, [])]
    if ungrouped:
        # Ungrouped sources export under a synthetic top-level bucket so they
        # survive the round-trip without a folder.
        roots.append({"name": "Ungrouped", "sources": ungrouped})

    return {
        "meta": {
            "schema": config.PORTABILITY_SCHEMA,
            "exported_at": _now_iso(),
            "generated_by": "ALMANACH",
        },
        "folders": roots,
    }


def write_library_file(data: Optional[dict] = None) -> Path:
    """Write the portability dict to `almanach-library.yaml`. Returns the path."""
    if data is None:
        data = build_library_dict()
    path = config.library_path()
    with open(path, "w", encoding="utf-8") as fh:
        yaml.safe_dump(data, fh, sort_keys=False, allow_unicode=True)
    return path


def export_library() -> Path:
    """Export the live library to YAML and flag the sync file `new_export`
    (US-260525-1200-001). Returns the written path. Raises on I/O failure so the
    caller can surface a clear error (AC-260525-1200-011)."""
    path = write_library_file()
    write_sync(export_status="new_export")
    log.info("library exported to %s", path)
    return path


# ---------------- Sync control file (almanach-sync.yaml, §10) ----------------


def read_sync() -> dict:
    path = config.sync_path()
    if not path.exists():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return yaml.safe_load(fh) or {}
    except (OSError, yaml.YAMLError) as e:
        log.warning("could not read sync file: %s", e)
        return {}


def write_sync(
    *, status: Optional[str] = None, export_status: Optional[str] = "__keep__"
) -> None:
    """Write the sync control file. `status` defaults to 'ready' when creating.
    Pass export_status='__keep__' (default) to leave the existing value."""
    current = read_sync()
    new_status = status if status is not None else (current.get("status") or "ready")
    if export_status == "__keep__":
        new_export = current.get("export_status")
    else:
        new_export = export_status
    payload = {
        "status": new_status,
        "export_status": new_export,
        "updated_at": _now_iso(),
        "updated_by": "ALMANACH",
    }
    with open(config.sync_path(), "w", encoding="utf-8") as fh:
        yaml.safe_dump(payload, fh, sort_keys=False, allow_unicode=True)


# ---------------- Import: parse + diff → staging (§11) ----------------


def load_library(path: Path) -> Optional[dict]:
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
        return data if isinstance(data, dict) else None
    except (OSError, yaml.YAMLError) as e:
        log.warning("could not parse library file %s: %s", path, e)
        return None


def _iter_library(data: dict):
    """Walk a portability dict, yielding ('folder', path) for every folder and
    ('source', path, entry) for every source. `path` is a tuple of folder names
    root→leaf (the source's path is its containing folder's path)."""
    folders = data.get("folders") or []

    def walk(nodes: list, prefix: tuple):
        for node in nodes:
            if not isinstance(node, dict):
                continue
            name = (node.get("name") or "").strip()
            if not name:
                continue
            path = prefix + (name,)
            yield ("folder", path)
            for src in node.get("sources") or []:
                if isinstance(src, dict) and src.get("url"):
                    yield ("source", path, src)
            yield from walk(node.get("children") or [], path)

    yield from walk(folders, ())


def _normalise_rating(value, default="medium") -> str:
    return value if value in models.RATING_VALUES else default


def stage_import(data: dict) -> int:
    """Diff a parsed portability dict against the live DB and (re)write the
    staging zone (DATA_MODEL.md §11). Returns the number of staged rows.

    Two-zone safeguard: this NEVER touches the live folder/source tables
    (AC-260525-1200-002). Re-import replaces the prior staging snapshot.
    """
    live_sources = models.list_sources()
    live_by_url = {s["url"]: s for s in live_sources}

    live_folder_paths = _live_folder_paths()

    seen_folder_paths: set[tuple] = set()
    yaml_urls: set[str] = set()

    folder_rows: list[dict] = []
    source_rows: list[dict] = []

    for item in _iter_library(data):
        if item[0] == "folder":
            _, path = item
            if path in seen_folder_paths:
                continue
            seen_folder_paths.add(path)
            if path not in live_folder_paths:
                folder_rows.append(
                    {"path": list(path), "name": path[-1]}
                )
        else:
            _, path, src = item
            raw_url = (src.get("url") or "").strip()
            if not raw_url:
                continue
            canonical = canonical_source_url(raw_url)
            yaml_urls.add(canonical)
            rel = _normalise_rating(src.get("reliability"))
            imp = _normalise_rating(src.get("impact"))
            existing = live_by_url.get(canonical)
            staged = {
                "url": canonical,
                "reliability": rel,
                "impact": imp,
                "folder_path": list(path),
            }
            if existing is None:
                source_rows.append({"change_type": "ADDED", "data": staged})
            elif (existing.get("reliability") != rel
                  or existing.get("impact") != imp):
                staged["display_name"] = existing["display_name"]
                staged["source_id"] = existing["id"]
                source_rows.append({"change_type": "MODIFIED", "data": staged})

    # Sources present live but absent from the incoming library → REMOVED.
    removed_rows: list[dict] = []
    for url, s in live_by_url.items():
        if url not in yaml_urls:
            removed_rows.append(
                {
                    "change_type": "REMOVED",
                    "data": {
                        "url": url,
                        "display_name": s["display_name"],
                        "source_id": s["id"],
                    },
                }
            )

    # Commit the new snapshot atomically — clear + insert in one transaction so
    # a concurrent Review render never sees a partial set (BUG-260704-0735-003).
    rows: list[tuple[str, str, dict]] = (
        [("folder", "ADDED", fr) for fr in folder_rows]
        + [("source", sr["change_type"], sr["data"]) for sr in source_rows]
        + [("source", "REMOVED", rr["data"]) for rr in removed_rows]
    )
    count = models.replace_staging(rows)
    log.info("staged %d proposed changes from library import", count)
    return count


def _live_folder_paths() -> set[tuple]:
    """Compute the set of name-paths (root→leaf) of every live folder."""
    folders = {f["id"]: f for f in models.list_folders()}
    paths: set[tuple] = set()

    def path_of(fid: str) -> tuple:
        chain: list[str] = []
        cur = folders.get(fid)
        guard = 0
        while cur is not None and guard < 16:
            chain.append(cur["name"])
            cur = folders.get(cur["parent_id"]) if cur["parent_id"] else None
            guard += 1
        return tuple(reversed(chain))

    for fid in folders:
        paths.add(path_of(fid))
    return paths


def stage_from_file(path: Optional[Path] = None) -> int:
    """Load the library file (defaulting to the live library path) and stage it.
    Returns the number of staged rows (0 if the file is missing/unparseable)."""
    if path is None:
        path = config.library_path()
    data = load_library(path)
    if data is None:
        log.info("no parseable library at %s — nothing staged", path)
        return 0
    return stage_import(data)


# ---------------- Approval: staged item → live tables ----------------


class ApprovalError(Exception):
    """Raised when a staged item cannot be applied (e.g. discovery failed)."""


def apply_staging(
    staging_id: str,
    *,
    reliability: Optional[str] = None,
    impact: Optional[str] = None,
) -> dict:
    """Apply one staged item to the live tables, then drop the staging row
    (US-260525-1200-004). Optional reliability/impact override the staged values
    (AC-260525-1200-041). Raises ApprovalError on discovery failure (the row is
    left staged so the user can retry)."""
    row = models.get_staging(staging_id)
    if row is None:
        raise ApprovalError("staged item not found")
    kind = row["object_kind"]
    change = row["change_type"]
    data = row["staged_data"] or {}

    if kind == "folder":
        models.get_or_create_folder_path(data.get("path") or [data.get("name")])
        models.delete_staging(staging_id)
        return {"applied": "folder", "change": change}

    # kind == source
    if change == "REMOVED":
        existing = models.find_source_by_canonical_url(data.get("url", ""))
        if existing:
            models.delete_source(existing["id"])
        models.delete_staging(staging_id)
        return {"applied": "source", "change": "REMOVED"}

    canonical = canonical_source_url(data["url"])
    rel = reliability if models.is_valid_rating(reliability) else _normalise_rating(data.get("reliability"))
    imp = impact if models.is_valid_rating(impact) else _normalise_rating(data.get("impact"))

    existing = models.find_source_by_canonical_url(canonical)
    if existing is not None:
        folder_id = models.get_or_create_folder_path(data.get("folder_path") or [])
        models.set_source_ratings(existing["id"], reliability=rel, impact=imp)
        if folder_id and existing.get("folder_id") != folder_id:
            models.set_source_folder(existing["id"], folder_id=folder_id)
        models.delete_staging(staging_id)
        return {"applied": "source", "change": change, "source_id": existing["id"]}

    result = discovery.discover(canonical)
    if not result.success:
        # BUG-260704-0735-003: nothing written yet on this path — folders are
        # materialised only after discovery succeeds, so a failed approval
        # leaves the live tables untouched and the row staged for retry.
        raise ApprovalError(discovery.humanise(result.error))
    display_name = resolve_display_name(result.feed_url, canonical)
    folder_id = models.get_or_create_folder_path(data.get("folder_path") or [])
    colour = settings_store.next_palette_colour()
    src = models.insert_source(
        url=canonical,
        feed_url=result.feed_url,
        discovery_method=result.method,
        display_name=display_name,
        colour=colour,
        reliability=rel,
        impact=imp,
    )
    if folder_id:
        models.set_source_folder(src["id"], folder_id=folder_id)
    models.delete_staging(staging_id)
    # Populate the new source's feed immediately.
    scheduler.trigger_manual_poll()
    return {"applied": "source", "change": change, "source_id": src["id"]}


def reject_staging(staging_id: str) -> bool:
    """Discard a staged item without applying it (US-260525-1200-004)."""
    return models.delete_staging(staging_id)
