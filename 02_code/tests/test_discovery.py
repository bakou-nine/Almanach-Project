"""Discovery waterfall with stubbed HTTP (CR-260704-0800-005).

No network: `discovery._client` is monkeypatched with a fake httpx-like client
serving canned responses per URL. Guards each step's success path, the failure
reasons, and the deepest-step error rule (AC-260513-0000-008).
"""
from __future__ import annotations

from typing import Optional

import pytest

from almanach import discovery


class FakeResponse:
    def __init__(self, status_code=200, text="", headers=None, url=None):
        self.status_code = status_code
        self.text = text
        self.content = text.encode()
        self.headers = headers or {}
        self.url = url or "https://x.test/"


class FakeClient:
    """Minimal httpx.Client stand-in: routes[url] -> FakeResponse (or callable)."""

    def __init__(self, routes):
        self.routes = routes

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def _resolve(self, url):
        hit = self.routes.get(url)
        if hit is None:
            return FakeResponse(status_code=404, url=url)
        if callable(hit):
            return hit()
        hit.url = hit.url or url
        return hit

    def get(self, url, **kw):
        return self._resolve(url)

    def head(self, url, **kw):
        return self._resolve(url)


def _stub(monkeypatch, routes):
    monkeypatch.setattr(discovery, "_client", lambda timeout: FakeClient(routes))


def test_head_scan_finds_alternate_link(monkeypatch):
    html = ('<html><head><link rel="alternate" type="application/rss+xml" '
            'href="/rss.xml"></head><body></body></html>')
    _stub(monkeypatch, {"https://x.test": FakeResponse(text=html, url="https://x.test/")})
    r = discovery.head_scan("https://x.test")
    assert r.success and r.feed_url == "https://x.test/rss.xml"
    assert r.step == "alternate_link"


def test_head_scan_prefers_rss_over_atom(monkeypatch):
    html = ('<html><head>'
            '<link rel="alternate" type="application/atom+xml" href="/atom.xml">'
            '<link rel="alternate" type="application/rss+xml" href="/rss.xml">'
            '</head></html>')
    _stub(monkeypatch, {"https://x.test": FakeResponse(text=html, url="https://x.test/")})
    assert discovery.head_scan("https://x.test").feed_url == "https://x.test/rss.xml"


def test_head_scan_no_link(monkeypatch):
    _stub(monkeypatch, {"https://x.test": FakeResponse(text="<html><head></head></html>")})
    r = discovery.head_scan("https://x.test")
    assert not r.success and r.reason == "no_alternate_link"


def test_common_path_probe_hits_feed_content_type(monkeypatch):
    _stub(monkeypatch, {
        "https://x.test/feed": FakeResponse(
            headers={"content-type": "application/rss+xml; charset=utf-8"}),
    })
    r = discovery.common_path_probe("https://x.test")
    assert r.success and r.feed_url == "https://x.test/feed"
    assert r.step == "common_path"


def test_common_path_probe_all_404(monkeypatch):
    _stub(monkeypatch, {})
    r = discovery.common_path_probe("https://x.test")
    assert not r.success and r.reason == "all_common_paths_404"


def test_sitemap_fallback_via_robots(monkeypatch):
    urlset = ('<?xml version="1.0"?>'
              '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
              '<url><loc>https://x.test/a</loc></url></urlset>')
    _stub(monkeypatch, {
        "https://x.test/robots.txt": FakeResponse(
            text="User-agent: *\nSitemap: https://x.test/news-map.xml\n"),
        "https://x.test/news-map.xml": FakeResponse(
            text=urlset, headers={"content-type": "application/xml"}),
    })
    r = discovery.sitemap_fallback("https://x.test")
    assert r.success and r.feed_url == "https://x.test/news-map.xml"
    assert r.step == "sitemap"


def test_sitemap_fallback_unparseable(monkeypatch):
    _stub(monkeypatch, {
        "https://x.test/sitemap.xml": FakeResponse(text="{not xml}"),
    })
    r = discovery.sitemap_fallback("https://x.test")
    assert not r.success and r.reason == "sitemap_unparsable"


def test_discover_reports_deepest_step_error(monkeypatch):
    # Every step fails; the surfaced error must be step 3's, never step 1's
    # no_alternate_link (AC-260513-0000-008).
    _stub(monkeypatch, {
        "https://x.test": FakeResponse(text="<html><head></head></html>"),
        "https://x.test/sitemap.xml": FakeResponse(text="{not xml}"),
    })
    result = discovery.discover("https://x.test")
    assert not result.success
    assert result.error == "sitemap_unparsable"
    assert [s.step for s in result.steps] == ["alternate_link", "common_path", "sitemap"]


def test_discover_short_circuits_on_first_success(monkeypatch):
    html = ('<html><head><link rel="alternate" type="application/rss+xml" '
            'href="https://x.test/rss.xml"></head></html>')
    _stub(monkeypatch, {"https://x.test": FakeResponse(text=html, url="https://x.test/")})
    result = discovery.discover("https://x.test")
    assert result.success and result.method == "alternate_link"
    assert len(result.steps) == 1


def test_humanise_covers_every_reason():
    for reason in ("no_alternate_link", "all_common_paths_404", "no_sitemap",
                   "sitemap_unparsable", "fetch_error"):
        assert discovery.humanise(reason)
    assert "unknown" in discovery.humanise(None)
