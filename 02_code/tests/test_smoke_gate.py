"""Launcher smoke-gate helpers (CR-260704-0800-005).

The launchers run this suite before starting the app. For UAT of the failure
path (AC-260704-0800-011), set the environment variable ALMANACH_SMOKE_FAIL=1
before launching — this test then fails deliberately, the launcher aborts with
the failing check name visible, and the app does not open.
"""
from __future__ import annotations

import os


def test_app_imports():
    """The application package and its entry module import cleanly."""
    import almanach.app  # noqa: F401


def test_deliberate_failure_toggle():
    assert os.environ.get("ALMANACH_SMOKE_FAIL") != "1", (
        "Deliberate smoke-gate failure requested via ALMANACH_SMOKE_FAIL=1 "
        "(AC-260704-0800-011 UAT toggle) — unset it to launch normally."
    )
