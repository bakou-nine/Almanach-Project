"""Live sync watcher (EP — Data Portability, US-260525-1200-003).

Watches the sync-control file (`almanach-sync.yaml`, DATA_MODEL.md §10); on
`status: import` it stages the library (`import_staging`, §11) then resets the
flag to `ready`. Nothing in the live sidebar changes at this step — the two-zone
safeguard (AC-260525-1200-002). The header "Review proposed (N)" badge picks the
new count up via its client-side poll, with no app restart (AC-260525-1200-030).

Uses `watchdog` when available; otherwise falls back to a lightweight mtime
polling thread so the feature degrades gracefully if the dependency is missing.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Optional

from . import config, portability

log = logging.getLogger(__name__)

_POLL_INTERVAL_S = 2.0

_observer = None  # watchdog Observer, when used
_poll_thread: Optional[threading.Thread] = None
_poll_stop: Optional[threading.Event] = None
_lock = threading.Lock()


def _process_sync_change() -> None:
    """If the sync file requests an import, stage the library and reset the flag.

    Serialised so overlapping filesystem events can't stage twice concurrently.
    """
    with _lock:
        try:
            sync = portability.read_sync()
            if (sync.get("status") or "").lower() != "import":
                return
            log.info("sync watcher: import requested — staging library")
            n = portability.stage_from_file()
            portability.write_sync(status="ready")
            log.info("sync watcher: staged %d proposed change(s)", n)
        except Exception as e:  # noqa: BLE001 — watcher must never crash the app
            log.warning("sync watcher: failed to process change: %s", e)


# ---------------- watchdog backend ----------------


def _start_watchdog() -> bool:
    global _observer
    try:
        from watchdog.events import FileSystemEventHandler
        from watchdog.observers import Observer
    except Exception:  # noqa: BLE001 — any import issue → fall back to polling
        return False

    sync_path = config.sync_path()
    watch_dir = str(sync_path.parent)
    target_name = sync_path.name

    class _Handler(FileSystemEventHandler):
        def _maybe(self, event):
            try:
                src = getattr(event, "src_path", "") or ""
                dest = getattr(event, "dest_path", "") or ""
                if src.endswith(target_name) or dest.endswith(target_name):
                    _process_sync_change()
            except Exception:  # noqa: BLE001
                pass

        def on_modified(self, event):
            self._maybe(event)

        def on_created(self, event):
            self._maybe(event)

        def on_moved(self, event):
            self._maybe(event)

    try:
        observer = Observer()
        observer.schedule(_Handler(), watch_dir, recursive=False)
        observer.daemon = True
        observer.start()
        _observer = observer
        log.info("sync watcher started (watchdog) on %s", sync_path)
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("watchdog start failed (%s) — using polling fallback", e)
        return False


# ---------------- polling fallback ----------------


def _poll_loop(stop: threading.Event) -> None:
    last_mtime = -1.0
    sync_path = config.sync_path()
    while not stop.is_set():
        try:
            mtime = sync_path.stat().st_mtime if sync_path.exists() else -1.0
            if mtime != last_mtime:
                last_mtime = mtime
                _process_sync_change()
        except Exception as e:  # noqa: BLE001
            log.debug("sync poll error: %s", e)
        stop.wait(_POLL_INTERVAL_S)


def _start_polling() -> None:
    global _poll_thread, _poll_stop
    _poll_stop = threading.Event()
    _poll_thread = threading.Thread(
        target=_poll_loop, args=(_poll_stop,), daemon=True
    )
    _poll_thread.start()
    log.info("sync watcher started (polling) on %s", config.sync_path())


# ---------------- lifecycle ----------------


def start() -> None:
    # Process any pending import flagged while the app was down, then watch.
    _process_sync_change()
    if not _start_watchdog():
        _start_polling()


def stop() -> None:
    global _observer, _poll_thread, _poll_stop
    if _observer is not None:
        try:
            _observer.stop()
            _observer.join(timeout=2)
        except Exception:  # noqa: BLE001
            pass
        _observer = None
    if _poll_stop is not None:
        _poll_stop.set()
        _poll_stop = None
    _poll_thread = None
