"""Excel (.xlsx) source hierarchy import/export (CR-260704-1825-001).

Guards the serialize→parse→replace round-trip (identical tree, ratings/colours
preserved, articles of URL-matched sources kept), replace semantics (absent
sources deleted), the forgiving parse (defaults, skipped url-less rows,
reordered columns), and the invalid-workbook error path leaving the DB
untouched.
"""
from __future__ import annotations

import io

import openpyxl
import pytest

from almanach import excel_io, models


def _seed_live():
    fid = models.get_or_create_folder_path(["News", "Tech"])
    src = models.insert_source(
        url="https://live.test",
        feed_url="https://live.test/feed",
        discovery_method="common_path",
        display_name="Live",
        colour="#111111",
        reliability="high",
        impact="low",
    )
    models.set_source_folder(src["id"], folder_id=fid)
    ungrouped = models.insert_source(
        url="https://loose.test",
        feed_url="https://loose.test/feed",
        discovery_method="common_path",
        display_name="Loose",
        colour="#222222",
    )
    return src, ungrouped


def _wb_bytes(header, rows, sheet="Sources"):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet
    ws.append(header)
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_round_trip_reproduces_tree(data_dir):
    src, ungrouped = _seed_live()
    models.insert_article(
        source_id=src["id"],
        url="https://live.test/a1",
        title="A1",
        summary=None,
        published_at="2026-07-01T00:00:00.000000",
    )
    data = excel_io.serialize_to_xlsx()
    summary = excel_io.replace_hierarchy(excel_io.parse_xlsx(data))
    assert summary["sources"] == 2
    assert summary["removed"] == 0
    assert summary["skipped"] == []

    folders = {f["name"]: f for f in models.list_folders()}
    assert set(folders) == {"News", "Tech"}
    assert folders["Tech"]["parent_id"] == folders["News"]["id"]

    live = models.get_source(src["id"])
    assert live is not None, "URL-matched source must survive the round-trip"
    assert live["display_name"] == "Live"
    assert live["colour"] == "#111111"
    assert live["reliability"] == "high"
    assert live["impact"] == "low"
    assert live["folder_id"] == folders["Tech"]["id"]
    assert models.get_source(ungrouped["id"])["folder_id"] is None
    # Articles of URL-matched sources are kept (update-in-place, not recreate).
    assert models.count_articles() == 1


def test_folder_path_column_builds_hierarchy(data_dir):
    xlsx = _wb_bytes(
        excel_io.HEADERS,
        [
            ["AI / Generalist-Daily", "Rundown", "https://rundown.test", "", "#f97316", "no", "high", "medium", 0],
            ["AI", "Direct", "https://direct.test", "", "", "no", "medium", "medium", 0],
            ["", "Loose one", "https://loose1.test", "", "", "yes", "low", "low", 0],
        ],
    )
    summary = excel_io.replace_hierarchy(excel_io.parse_xlsx(xlsx))
    assert summary["sources"] == 3
    assert summary["groups"] == 1  # one top-level group "AI"

    folders = {f["name"]: f for f in models.list_folders()}
    assert set(folders) == {"AI", "Generalist-Daily"}
    assert folders["Generalist-Daily"]["parent_id"] == folders["AI"]["id"]

    by_name = {s["display_name"]: s for s in models.list_sources()}
    assert by_name["Rundown"]["folder_id"] == folders["Generalist-Daily"]["id"]
    assert by_name["Direct"]["folder_id"] == folders["AI"]["id"]
    assert by_name["Loose one"]["folder_id"] is None
    assert by_name["Loose one"]["muted"] == 1


def test_replace_deletes_absent_sources(data_dir):
    src, ungrouped = _seed_live()
    xlsx = _wb_bytes(
        excel_io.HEADERS,
        [["Only", "Fresh", "https://fresh.test", "https://fresh.test/rss", "", "no", "low", "high", 0]],
    )
    summary = excel_io.replace_hierarchy(excel_io.parse_xlsx(xlsx))
    assert summary["sources"] == 1
    assert summary["removed"] == 2
    assert models.get_source(src["id"]) is None
    assert models.get_source(ungrouped["id"]) is None
    sources = models.list_sources()
    assert len(sources) == 1
    fresh = sources[0]
    assert fresh["display_name"] == "Fresh"
    assert fresh["url"] == "https://fresh.test"
    assert fresh["feed_url"] == "https://fresh.test/rss"
    assert fresh["reliability"] == "low"
    assert fresh["impact"] == "high"
    assert fresh["colour"]  # palette default assigned
    assert [f["name"] for f in models.list_folders()] == ["Only"]


def test_new_source_without_url_is_skipped(data_dir):
    xlsx = _wb_bytes(
        excel_io.HEADERS,
        [
            ["", "No url here", "", "", "", "", "", "", ""],
            ["", "Good", "https://good.test", "", "", "", "", "", ""],
        ],
    )
    summary = excel_io.replace_hierarchy(excel_io.parse_xlsx(xlsx))
    assert summary["sources"] == 1
    assert summary["skipped"] == ["No url here"]
    assert len(models.list_sources()) == 1


def test_reordered_and_partial_columns_parse_by_header(data_dir):
    # Columns reordered and several omitted — parsing keys off header names.
    xlsx = _wb_bytes(
        ["URL", "Source name", "Folder"],
        [["https://x.test", "X", "Group A"]],
    )
    summary = excel_io.replace_hierarchy(excel_io.parse_xlsx(xlsx))
    assert summary["sources"] == 1
    s = models.list_sources()[0]
    assert s["display_name"] == "X"
    assert s["reliability"] == "medium"  # default
    assert [f["name"] for f in models.list_folders()] == ["Group A"]


def test_name_defaults_to_host_when_blank(data_dir):
    xlsx = _wb_bytes(excel_io.HEADERS,
                     [["", "", "https://sub.example.com/news", "", "", "", "", "", ""]])
    excel_io.replace_hierarchy(excel_io.parse_xlsx(xlsx))
    assert models.list_sources()[0]["display_name"] == "sub.example.com"


def test_invalid_workbook_raises_and_leaves_db_untouched(data_dir):
    _seed_live()
    with pytest.raises(ValueError):
        excel_io.parse_xlsx(b"this is not an xlsx file at all")
    assert len(models.list_sources()) == 2


def test_depth_cap_rejected(data_dir):
    deep = " / ".join(f"L{i}" for i in range(6))  # 6 levels > cap of 5
    xlsx = _wb_bytes(excel_io.HEADERS,
                     [[deep, "Deep", "https://deep.test", "", "", "", "", "", ""]])
    with pytest.raises(ValueError):
        excel_io.parse_xlsx(xlsx)


def test_template_parses_and_imports(data_dir):
    parsed = excel_io.parse_xlsx(excel_io.build_template_xlsx())
    summary = excel_io.replace_hierarchy(parsed)
    # Every template example row carries a url, so all import.
    assert summary["sources"] == 4
    assert summary["skipped"] == []
    names = {f["name"] for f in models.list_folders()}
    assert {"AI", "Generalist-Daily"} <= names
