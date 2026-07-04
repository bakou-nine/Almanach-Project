"""models.py query composer + timestamp seams (CR-260704-0800-005).

Guards the seams the 2026-07-04 review found unguarded: newest-first ordering,
the infinite-scroll `after` cursor, date bounds, keyword matching (LIKE and
alm_kw_match paths), rating filter/sort, timestamp normalisation
(BUG-260704-0735-002), and the retention prune boundary.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from almanach import db, models


def _mk_source(url="https://s.test", rel="medium", imp="medium"):
    return models.insert_source(
        url=url,
        feed_url=url + "/feed",
        discovery_method="common_path",
        display_name=url.split("//")[1],
        colour="#111111",
        reliability=rel,
        impact=imp,
    )


def _mk_article(source_id, n, title="Story", summary=None, published=None):
    return models.insert_article(
        source_id=source_id,
        url=f"https://s.test/a{n}",
        title=f"{title} {n}",
        summary=summary,
        published_at=published or f"2026-07-0{1 + n % 3}T0{n % 10}:00:00.000000",
    )


def test_list_articles_newest_first_and_cursor(data_dir):
    src = _mk_source()
    for i in range(5):
        _mk_article(src["id"], i, published=f"2026-07-01T0{i}:00:00.000000")
    arts = models.list_articles(limit=3)
    times = [a["published_at"] for a in arts]
    assert times == sorted(times, reverse=True)
    # Cursor: the next batch starts strictly after the last row — no dup/skip.
    rest = models.list_articles(limit=10, after=arts[-1]["published_at"])
    assert len(rest) == 2
    assert set(a["id"] for a in arts).isdisjoint(a["id"] for a in rest)


def test_date_bounds_inclusive(data_dir):
    src = _mk_source()
    _mk_article(src["id"], 1, published="2026-07-01T12:00:00.000000")
    _mk_article(src["id"], 2, published="2026-07-02T12:00:00.000000")
    _mk_article(src["id"], 3, published="2026-07-03T12:00:00.000000")
    hit = models.list_articles(
        from_date="2026-07-02T00:00:00.000000", to_date="2026-07-02T23:59:59.999999"
    )
    assert [a["url"] for a in hit] == ["https://s.test/a2"]
    assert models.count_articles(
        from_date="2026-07-02T00:00:00.000000", to_date="2026-07-02T23:59:59.999999"
    ) == 1


def test_keyword_like_and_whole_word(data_dir):
    src = _mk_source()
    _mk_article(src["id"], 1, title="Superintelligence rising")
    _mk_article(src["id"], 2, title="An intelligence report")
    loose = models.list_articles(keywords=[{"word": "intelligence"}])
    assert len(loose) == 2  # substring matches both
    exact = models.list_articles(
        keywords=[{"word": "intelligence", "whole_word": True}]
    )
    assert [a["title"] for a in exact] == ["An intelligence report 2"]


def test_keyword_mode_all_vs_any(data_dir):
    src = _mk_source()
    _mk_article(src["id"], 1, title="AI and chips")
    _mk_article(src["id"], 2, title="AI only")
    kws = [{"word": "AI"}, {"word": "chips"}]
    assert len(models.list_articles(keywords=kws, keyword_mode="any")) == 2
    assert len(models.list_articles(keywords=kws, keyword_mode="all")) == 1


def test_reliability_filter_and_impact_sort(data_dir):
    hi = _mk_source("https://hi.test", rel="high", imp="high")
    lo = _mk_source("https://lo.test", rel="low", imp="low")
    models.insert_article(source_id=hi["id"], url="https://hi.test/a", title="hi",
                          summary=None, published_at="2026-07-01T00:00:00.000000")
    models.insert_article(source_id=lo["id"], url="https://lo.test/a", title="lo",
                          summary=None, published_at="2026-07-02T00:00:00.000000")
    only_high = models.list_articles(reliability_min="high")
    assert [a["title"] for a in only_high] == ["hi"]
    by_impact = models.list_articles(sort="impact")
    assert [a["title"] for a in by_impact] == ["hi", "lo"]  # high impact first


def test_muted_source_excluded_from_combined_feed(data_dir):
    src = _mk_source()
    _mk_article(src["id"], 1)
    models.set_muted(src["id"], True)
    assert models.list_articles() == []
    # Explicit source view ignores the mute (FT04 contract).
    assert len(models.list_articles(source_id=src["id"])) == 1


def test_normalise_timestamp_canonicalises(data_dir):
    f = models.normalise_timestamp
    assert f("2026-07-03T14:00:00+02:00") == "2026-07-03T12:00:00.000000"
    assert f("2026-07-03T12:00:00Z") == "2026-07-03T12:00:00.000000"
    assert f("2026-07-03") == "2026-07-03T00:00:00.000000"
    assert f("2026-07-03T12:00:00.123456") == "2026-07-03T12:00:00.123456"
    assert f("garbage") is None
    assert f(None) is None


def test_published_at_migration_is_gated(data_dir):
    src = _mk_source()
    models.insert_article(source_id=src["id"], url="https://s.test/legacy", title="t",
                          summary=None, published_at="2026-07-03T10:00:00+02:00")
    assert models.migrate_published_at_formats() == 1
    art = models.list_articles(source_id=src["id"])[0]
    assert art["published_at"] == "2026-07-03T08:00:00.000000"
    assert models.migrate_published_at_formats() == 0  # settings-gated no-op


def test_prune_boundary_uses_canonical_format(data_dir):
    src = _mk_source()
    fresh = models.insert_article(source_id=src["id"], url="https://s.test/new",
                                  title="new", summary=None,
                                  published_at="2026-07-01T00:00:00.000000")
    stale = models.insert_article(source_id=src["id"], url="https://s.test/old",
                                  title="old", summary=None,
                                  published_at="2026-05-01T00:00:00.000000")
    old_fetch = (datetime.now(timezone.utc) - timedelta(days=40)).strftime(
        "%Y-%m-%dT%H:%M:%S.%f"
    )
    with db.transaction() as conn:
        conn.execute("UPDATE article SET fetched_at = ? WHERE id = ?",
                     (old_fetch, stale["id"]))
    assert models.prune_old_articles(30) == 1
    left = models.list_articles(source_id=src["id"])
    assert [a["id"] for a in left] == [fresh["id"]]
