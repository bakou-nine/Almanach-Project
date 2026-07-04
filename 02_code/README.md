# Almanach

A personal multi-source news reader: paste any news website URL, Almanach finds
its RSS/Atom feed automatically, and shows a clean combined feed in a two-pane
interface — infinite scroll, folders, filters, source ratings, and a staged
import/export of your whole library.

Scope and design come from `01_Docs/01_requirements/project-active.yaml`
(`PC-260512-2041-001`) and `01_Docs/02_dev_documentation/DATA_MODEL.md`.

## Quick start

**Recommended — the launcher (Windows):** double-click `02_code/run.bat`, or run

```powershell
powershell -ExecutionPolicy Bypass -File .\02_code\run.ps1
```

The launcher is self-bootstrapping: it creates `.venv` if missing, installs
dependencies, runs the automated pre-launch checks (the app only opens when
they pass), and starts the server. Open <http://127.0.0.1:8000/>.

**Manual:**

```bash
cd 02_code
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m almanach
```

## Data directory

All runtime data — the SQLite database (`almanach.sqlite3`), the portability
library file (`almanach-library.yaml`), and the sync-control file
(`almanach-sync.yaml`) — lives in the **`04_Almanach Library` folder at the
project root**. Every launch method uses it by default; the launcher prints the
active path as `ALMANACH_DATA_DIR = …` on startup. Set the `ALMANACH_DATA_DIR`
environment variable to override it.

On first run with an empty database, Almanach stages the bundled curated
library for review (header badge "Review proposed (N)") and seeds ~10 popular
sources in the background — the UI is usable immediately.

## Features

- **Add sources** — paste a homepage URL; the discovery waterfall (head-scan →
  common paths → sitemap, 10 s budget) finds the feed. Duplicates are detected
  by canonical URL; private/local addresses are rejected.
- **Two-pane reading** — resizable sidebar with folders (drag-and-drop, depth
  ≤ 5, mute cascade, unread pills) and a continuous-scroll combined feed
  (newest-first, batches load as you scroll). Clicking an article opens it in
  a new tab and marks it read.
- **Filter bar** — date shortcuts (1d/1w/1m) or a custom range (max 1 year),
  folder/source multi-select, keyword chips with Any/All combining and an
  Exact-match toggle, reliability threshold, and impact sort. Active filters
  show as removable chips with Clear-all.
- **Source ratings** — per-source `reliability` and `impact`
  (high/medium/low) badges on sidebar rows, editable from the row ⋮ menu,
  usable in the filter bar.
- **Sidebar selection drives the filter** — click scopes the feed to a
  source/folder; shift-click builds a cumulative multi-selection.
- **Background polling** — every source is polled on a configurable interval
  (default 10 min, range 5–120) plus a manual header refresh button; a
  last-sync indicator sits in the header. Polite fetching (≥2 s per domain).
- **Library portability** — Settings → Export library writes
  `almanach-library.yaml`; dropping an updated library file + flagging
  `almanach-sync.yaml` with `status: import` stages proposed changes for
  review (nothing goes live until you approve each item, ratings adjustable).
- **Keyboard support** — sidebar rows, article cards, menus, and modals are
  fully keyboard-operable (Tab/arrows/Enter/Escape) with visible focus.
- **Offline-friendly UI** — all assets, including the icon font, are served
  locally; no CDN dependency.

## Automated checks

`02_code/tests/` holds the pytest regression suite the launchers run before
every start (query composer, portability round-trip, ingestion normalisation,
discovery waterfall with stubbed HTTP, SSRF guard). Run it manually with:

```bash
cd 02_code
python -m pytest tests -q
```

To rehearse the failure path, set `ALMANACH_SMOKE_FAIL=1` before launching —
the launcher aborts with the failing check named and the app does not open.

## Files

```
02_code/
├── run.bat / run.ps1          self-bootstrapping launchers (venv + checks + start)
├── almanach/
│   ├── __main__.py            uvicorn entry point
│   ├── app.py                 FastAPI app, all routes
│   ├── config.py              paths, palette, timeouts, defaults
│   ├── db.py                  SQLite connection, schema, migrations
│   ├── settings_store.py      settings KV access + palette pointer
│   ├── urls.py                URL canonicalisation + SSRF guard
│   ├── discovery.py           feed discovery waterfall (head / common / sitemap)
│   ├── models.py              data-access layer (Source, Article, Folder)
│   ├── staging.py             import-staging zone (review before live)
│   ├── portability.py         library export/import (almanach-portability/v1)
│   ├── watcher.py             sync-file watcher (stages imports live)
│   ├── ingestion.py           feedparser + sitemap parsing
│   ├── scheduler.py           APScheduler + polite fetcher
│   ├── seeding.py             first-run seeding (background)
│   ├── naming.py              feed display-name resolution
│   ├── views.py               sidebar + feed view builders
│   ├── static/{css,js,vendor}/
│   └── templates/
├── tests/                     pytest regression suite (pre-launch smoke gate)
└── requirements.txt
```
