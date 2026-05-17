# Almanach

A personal multi-source news reader: paste any news website URL, Almanach finds
its RSS/Atom feed automatically, and shows a clean combined feed in a two-pane
interface.

Scope and design come from `01_Docs/01_requirements/project-active.yaml`
(`PC-260512-2041-001`, EP01–EP05) and `01_Docs/02_dev_documentation/DATA_MODEL.md`.

## Quick start

```bash
cd 02_code
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m almanach
```

Open <http://127.0.0.1:8000/>.

The first run creates the SQLite database at `~/.almanach/almanach.sqlite3`
(override with `ALMANACH_DATA_DIR`), bootstraps the schema, attempts to seed
~10 popular sources, and starts the background polling scheduler.

## What's implemented

- **EP01 Source Management** — full coverage of FT01–FT04: source add (with
  client + server-side URL validation, dedup by canonical URL, automatic feed
  discovery, palette-colour assignment), sidebar rendering with active and
  muted states, ⋮ action menu with rename / mute / remove and confirm dialog,
  partial sidebar refresh endpoint.
- **EP02 Article Ingestion** — feedparser-driven RSS/Atom parsing, dedup by
  article URL, summary extraction (RSS description → Atom summary → fallback),
  30-day retention sweep on a daily schedule.
- **EP03 Background Polling** — APScheduler runs an initial poll on boot and
  then every `polling_interval_minutes` (default 20, range 5–120). Polite
  fetcher throttles to one request per 2 seconds per domain. Manual refresh
  endpoint (`POST /refresh`) is wired to the header refresh button.
- **EP04 Feed Reading** — two-pane layout matching the mockup: sidebar with
  All-sources virtual entry + per-source rows + unread-count pills, paginated
  combined feed (50 per page, newest-first), click-through opens the article
  in a new tab and marks it read.
- **EP05 Setup** — `python -m almanach` launcher, first-run schema bootstrap,
  seeding, this README.

The discovery waterfall implements all three steps per FT02
(US-260513-0000-001..004): HTML head scan for `<link rel="alternate">`,
common-path probe (`/feed`, `/rss`, `/atom.xml`), sitemap fallback. A 10 s
total wall-clock budget bounds end-to-end latency.

## Charter scope cuts

Per the charter §3, the mockup's per-article tag pills (Economy, Tech, etc.)
and the sort dropdown are NOT in MVP. The implementation is newest-first only,
no tags.

## Files

```
02_code/
├── almanach/
│   ├── __main__.py            uvicorn entry point
│   ├── app.py                 FastAPI app, all routes
│   ├── config.py              paths, palette, timeouts
│   ├── db.py                  SQLite connection + schema
│   ├── settings_store.py      settings KV access + palette pointer
│   ├── urls.py                URL canonicalisation
│   ├── discovery.py           FT02 waterfall (head / common / sitemap)
│   ├── models.py              data-access layer (Source, Article)
│   ├── ingestion.py           feedparser + sitemap parsing
│   ├── scheduler.py           APScheduler + polite fetcher
│   ├── views.py               sidebar + feed view builders
│   ├── static/{css,js}/
│   └── templates/
└── requirements.txt
```
