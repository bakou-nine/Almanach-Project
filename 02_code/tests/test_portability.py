"""Portability export/import staging round-trip (CR-260704-0800-005).

Guards the two-zone safeguard (staging never touches live tables), the
ADDED/MODIFIED/REMOVED diff, atomic staging replace (BUG-260704-0735-003), and
the export→import round-trip shape.
"""
from __future__ import annotations

from almanach import models, portability


def _seed_live():
    fid = models.get_or_create_folder_path(["News", "Tech"])
    src = models.insert_source(
        url="https://live.test",
        feed_url="https://live.test/feed",
        discovery_method="common_path",
        display_name="Live",
        colour="#111111",
        reliability="high",
        impact="medium",
    )
    models.set_source_folder(src["id"], folder_id=fid)
    return src


def test_export_round_trip_shape(data_dir):
    _seed_live()
    path = portability.export_library()
    data = portability.load_library(path)
    assert data["meta"]["schema"] == "almanach-portability/v1"
    entries = list(portability._iter_library(data))
    folders = [e for e in entries if e[0] == "folder"]
    sources = [e for e in entries if e[0] == "source"]
    assert ("folder", ("News",)) in folders
    assert ("folder", ("News", "Tech")) in folders
    assert len(sources) == 1
    _, path_, src = sources[0]
    assert src["url"] == "https://live.test"
    assert src["reliability"] == "high"
    # Export flags the sync file.
    assert portability.read_sync()["export_status"] == "new_export"


def test_stage_import_diff_and_two_zone(data_dir):
    live = _seed_live()
    incoming = {
        "meta": {"schema": "almanach-portability/v1"},
        "folders": [
            {
                "name": "News",
                "children": [
                    {
                        "name": "Tech",
                        "sources": [
                            # Same URL, changed rating -> MODIFIED
                            {"url": "https://live.test", "reliability": "low",
                             "impact": "medium"},
                            # New source -> ADDED
                            {"url": "https://new.test", "reliability": "high",
                             "impact": "high"},
                        ],
                    }
                ],
            },
            # New folder -> folder ADDED
            {"name": "Science"},
        ],
    }
    n = portability.stage_import(incoming)
    rows = models.list_staging()
    assert n == len(rows) == 3
    changes = {(r["object_kind"], r["change_type"]) for r in rows}
    assert ("folder", "ADDED") in changes      # Science
    assert ("source", "MODIFIED") in changes   # live.test rating change
    assert ("source", "ADDED") in changes      # new.test
    # Two-zone safeguard: live tables untouched by staging.
    assert len(models.list_sources()) == 1
    assert models.get_source(live["id"])["reliability"] == "high"


def test_stage_import_marks_missing_sources_removed(data_dir):
    _seed_live()
    n = portability.stage_import({"folders": []})
    rows = models.list_staging()
    assert n == len(rows) == 1
    assert rows[0]["change_type"] == "REMOVED"
    assert rows[0]["staged_data"]["url"] == "https://live.test"


def test_replace_staging_is_atomic_snapshot(data_dir):
    models.replace_staging(
        [("source", "ADDED", {"url": f"https://s{i}.test"}) for i in range(5)]
    )
    assert models.count_staging() == 5
    # A re-import replaces (not appends) the snapshot.
    models.replace_staging([("source", "ADDED", {"url": "https://only.test"})])
    rows = models.list_staging()
    assert len(rows) == 1
    assert rows[0]["staged_data"]["url"] == "https://only.test"


def test_apply_staging_modified_updates_live_without_discovery(data_dir):
    live = _seed_live()
    portability.stage_import({
        "folders": [{"name": "News", "children": [{"name": "Tech", "sources": [
            {"url": "https://live.test", "reliability": "low", "impact": "low"},
        ]}]}],
    })
    row = models.list_staging()[0]
    assert row["change_type"] == "MODIFIED"
    result = portability.apply_staging(row["id"])
    assert result["applied"] == "source"
    updated = models.get_source(live["id"])
    assert updated["reliability"] == "low" and updated["impact"] == "low"
    assert models.count_staging() == 0


def test_reject_staging_discards_without_live_change(data_dir):
    _seed_live()
    portability.stage_import({"folders": []})
    row = models.list_staging()[0]
    assert portability.reject_staging(row["id"]) is True
    assert models.count_staging() == 0
    assert len(models.list_sources()) == 1  # REMOVED proposal discarded
