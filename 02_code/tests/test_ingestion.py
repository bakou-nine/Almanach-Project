"""Ingestion timestamp normalisation + parsing seams (CR-260704-0800-005).

Guards BUG-260704-0735-002 at the write path: sitemap entries land in the
canonical naive-UTC format, RSS entries dedupe on URL, summaries are cleaned.
"""
from __future__ import annotations

from almanach import ingestion, models

NEWS_SITEMAP = b"""<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
  <url>
    <loc>https://x.test/a</loc>
    <news:news>
      <news:title>Big Story</news:title>
      <news:publication_date>2026-07-03T10:00:00+02:00</news:publication_date>
    </news:news>
  </url>
  <url>
    <loc>https://x.test/some-slug-story</loc>
    <lastmod>2026-07-02</lastmod>
  </url>
  <url>
    <loc>https://x.test/undated-item</loc>
  </url>
</urlset>"""

RSS_DOC = b"""<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Feed Title</title>
  <item>
    <title>Item One</title>
    <link>https://r.test/one</link>
    <description>&lt;p&gt;Hello &amp;amp; goodbye&lt;/p&gt;</description>
    <pubDate>Fri, 03 Jul 2026 10:00:00 GMT</pubDate>
  </item>
</channel></rss>"""


def test_sitemap_entries_normalised(data_dir):
    entries = ingestion._parse_sitemap_entries(NEWS_SITEMAP)
    assert entries[0]["title"] == "Big Story"
    assert entries[0]["published"] == "2026-07-03T08:00:00.000000"
    assert entries[1]["published"] == "2026-07-02T00:00:00.000000"
    # Slug-derived title for entries without news:title.
    assert entries[1]["title"] == "Some Slug Story"
    # Undated entries fall back to "now" in the canonical format.
    assert "T" in entries[2]["published"] and "." in entries[2]["published"]


def test_sitemap_unparseable_returns_empty(data_dir):
    assert ingestion._parse_sitemap_entries(b"not xml at all") == []


def test_rss_ingest_inserts_once_and_cleans_summary(data_dir, monkeypatch):
    src = models.insert_source(
        url="https://r.test",
        feed_url="https://r.test/feed",
        discovery_method="alternate_link",
        display_name="R",
        colour="#111111",
    )
    monkeypatch.setattr(ingestion, "fetch_feed_bytes", lambda *a, **k: RSS_DOC)
    new, seen = ingestion._ingest_from(src, src["feed_url"], src["discovery_method"])
    assert (new, seen) == (1, 1)
    art = models.list_articles(source_id=src["id"])[0]
    assert art["title"] == "Item One"
    assert art["published_at"] == "2026-07-03T10:00:00.000000"
    assert art["summary"] == "Hello & goodbye"  # tags stripped, entities unescaped
    # Second ingest of the same document is a no-op (URL dedup).
    new2, seen2 = ingestion._ingest_from(src, src["feed_url"], src["discovery_method"])
    assert (new2, seen2) == (0, 1)


def test_slug_to_title():
    assert ingestion._slug_to_title("https://x.test/big-ai-news-2026.html") == "Big Ai News"
    assert ingestion._slug_to_title("https://x.test/") == "https://x.test/"
