"""Shared fixtures for the Almanach regression suite (CR-260704-0800-005).

Every test runs against a throwaway data directory: the fixture points
ALMANACH_DATA_DIR at pytest's tmp_path, drops the thread-local DB connection so
the next access opens the fresh database, and initialises the schema. No test
touches the real 04_Almanach Library data.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

# Make the `almanach` package importable regardless of pytest's rootdir.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture()
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("ALMANACH_DATA_DIR", str(tmp_path))
    from almanach import db

    db.close()
    db.initialise()
    yield tmp_path
    db.close()
