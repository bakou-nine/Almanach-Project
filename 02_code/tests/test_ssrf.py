"""SSRF guard (CR-260704-0800-001): private-address rejection in source add
and feed discovery, including redirect-hop coverage via the client hook."""
from __future__ import annotations

from almanach import discovery
from almanach.urls import private_target_reason


def test_private_literals_rejected():
    for url in (
        "http://127.0.0.1:8000",
        "http://192.168.1.10",
        "http://10.0.0.5/feed",
        "http://169.254.169.254/latest/meta-data",
        "http://[::1]:8000",
        "http://0.0.0.0",
    ):
        assert private_target_reason(url), url


def test_public_literal_accepted():
    assert private_target_reason("http://93.184.216.34") is None


def test_localhost_hostname_rejected():
    assert private_target_reason("http://localhost:8000")


def test_unresolvable_host_passes_through():
    # Not an SSRF risk — the fetch itself will fail with its own error.
    assert private_target_reason("http://definitely-not-a-real-host.invalid") is None


def test_no_host_rejected():
    assert private_target_reason("http:///path-only")


def test_discovery_client_blocks_private_target():
    # The real client's request hook fires before any connection is made, so
    # this needs no network: every waterfall step degrades to fetch_error.
    r = discovery.head_scan("http://127.0.0.1:1")
    assert not r.success and r.reason == "fetch_error"
    assert "private" in (r.details or "")
