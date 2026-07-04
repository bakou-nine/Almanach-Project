# DATA_MODEL.md — Almanach

Authoritative reference for the Almanach data layer. Every USER STORY under
EP01–EP05 references this document by section number (e.g. `§1.1`, `§Source.muted`).

Storage backend: SQLite (single file). All timestamps stored as ISO 8601 strings
in UTC (`'2026-05-12T22:50:00.000000'`-style). Booleans stored as INTEGER (0/1)
per SQLite convention.

---

## §1. Entities

### §1.1 Source

Represents a single news source the user follows. Created via FT01 (Source Add
Flow). Polled by EP03. Rendered by FT03 (flat) or FT05 (in a recursive Folder
tree, depth ≤ 5). Mutated by FT04.

| Field | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| `id` | TEXT PK | not null | UUID v4 generated on insert. |
| `url` | TEXT | not null, unique | Canonical homepage URL pasted by the user. Immutable after creation (FT04 rename does NOT touch this). |
| `feed_url` | TEXT | not null | Resolved feed URL from FT02 waterfall (the `<link rel="alternate">` href, a `/feed`-style path, or the discovered sitemap URL). |
| `discovery_method` | TEXT | not null, enum | `alternate_link` \| `common_path` \| `sitemap`. Set by FT01 from FT02's response. Determines how EP02 ingests articles for this source. |
| `display_name` | TEXT | not null | Sidebar label. Defaults to the feed's `<title>` element on creation; falls back to the URL hostname if absent. Mutated by FT04 rename. |
| `colour` | TEXT | not null | Hex string from the curated 12-palette (e.g. `#378ADD`). Auto-assigned by FT01 (round-robin through the palette, collisions allowed only after exhaustion). No user override in MVP. |
| `muted` | INTEGER | not null, default 0 | Boolean. Toggled by FT04 mute / unmute. When 1: source is hidden from the combined feed (EP04 filter), but EP03 polling continues normally. |
| `folder_id` | TEXT FK | nullable, → `folder.id`, `ON DELETE SET NULL` | FT05 parent folder (recursive — points to a folder at any depth 1..5). NULL = Ungrouped zone. Added by CR-260522-2101-001 iteration 3, replacing the iteration-1 pair `group_id` + `subgroup_id`. |
| `position` | REAL | not null, default 0 | Sort order among siblings sharing the same `folder_id`. Reassigned by drag-and-drop (US-260522-2116-008). |
| `created_at` | TEXT (ISO8601) | not null | Set by FT01 on insert. |
| `last_polled_at` | TEXT (ISO8601) | nullable | Updated by EP03 at the end of every successful poll cycle. NULL on a never-polled source. |
| `last_error` | TEXT | nullable | Human-readable error message from EP03's most recent failed poll. Cleared (set to NULL) on the next successful poll. |
| `consecutive_failure_count` | INTEGER | not null, default 0 | Incremented on every poll failure. Reset to 0 on success. EP03 may use this to back off or surface the source as broken in the UI (future). |
| `reliability` | TEXT | not null, enum, default `'medium'` | Curation rating — how established / trustworthy the source is: `high` \| `medium` \| `low`. Set by the ALMANACH source-curation process (CLAUDE.md §A1) at import; user-editable via the row ⋮ menu (FT — Source Ratings). Drives the feed filter / sort. |
| `impact` | TEXT | not null, enum, default `'medium'` | Curation rating — how unique / strong the source's news is and how well it serves the user's purpose: `high` \| `medium` \| `low`. User-editable. Drives the feed filter / sort. |

### §1.2 Article

A single article ingested from a Source's feed. Created by EP02 ingestion.
Displayed by EP04. Deleted on Source removal (cascade, §2.1) or retention
sweep (§5).

| Field | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| `id` | TEXT PK | not null | UUID v4 generated on insert. |
| `source_id` | TEXT FK | not null, → `source.id`, `ON DELETE CASCADE` | See §2.1. |
| `url` | TEXT | not null, unique | Canonical article URL. The deduplication key for EP02 — re-ingesting the same URL is a no-op. |
| `title` | TEXT | not null | Article headline as published in the feed entry (`<title>`). |
| `summary` | TEXT | nullable | Short description. Sourced from RSS `<description>` / Atom `<summary>`, then Open Graph `og:description`, then Trafilatura readability extract (first ~280 chars). NULL if no source provides one. |
| `published_at` | TEXT (ISO8601) | not null | From the feed entry's `pubDate` / `<published>`. Used for newest-first sort in EP04 pagination. Falls back to `fetched_at` if the feed omits it. |
| `fetched_at` | TEXT (ISO8601) | not null | When EP02 first ingested this URL. Used by the retention sweep (§5) — NOT `published_at`. |
| `read_at` | TEXT (ISO8601) | nullable | Set to the current timestamp on click-through (EP04 click-to-read). One-way: never reset to NULL once written. NULL = unread. |

### §1.3 Settings (key/value)

A flat key/value store for user-configurable runtime values. Single-row-per-key.

| Field | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| `key` | TEXT PK | not null | See §6 for the canonical key list. |
| `value` | TEXT | not null | Stored as string; the app coerces to int / bool as needed per key. |

### §1.4 Folder (FT05)

A node in the recursive folder tree that organises Sources in the sidebar.
Owned by FT05 (CR-260522-2101-001 iteration 3 — replaces the iteration-1
two-table `Group` + `Subgroup` model with a single self-referential table).

| Field | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| `id` | TEXT PK | not null | UUID v4. |
| `parent_id` | TEXT FK | nullable, → `folder.id`, `ON DELETE CASCADE` | Self-referential parent pointer. NULL = root folder. Deleting a folder cascades every descendant folder; descendant sources detach to Ungrouped (FK SET NULL on `Source.folder_id`). |
| `name` | TEXT | not null | Sidebar label. 1–60 chars after trim (enforced by US-260522-2116-002). Editable via inline rename (US-260522-2116-007) or the ⋮ Rename action (US-260522-2230-001). |
| `position` | REAL | not null, default 0 | Sort order among siblings sharing the same `parent_id` (ascending). REAL so Notion-style drag-and-drop midpoints (US-260522-2116-008) don't need renormalisation on every drop. |
| `collapsed` | INTEGER | not null, default 0 | Boolean. 1 = sidebar omits this folder's children (and recursively their subtree) from the render. Toggled via chevron click (US-260522-2116-004). |
| `muted` | INTEGER | not null, default 0 | Boolean. 1 = hides every descendant source's articles from the combined feed (cascade per §2.3). Polling unaffected. Toggled via the ⋮ Mute / Unmute action (US-260522-2230-001 / US-260522-2230-002). |
| `depth` | INTEGER | not null, default 1 | Cached depth (root folder = 1, deepest leaf folder = 5). Application-enforced cap of 5 — see §2.4 invariants. |
| `created_at` | TEXT (ISO8601) | not null | Set on insert. |

§1.5 (Subgroup) is **retired** by CR-260522-2101-001 iteration 3. The
two-level Group + Subgroup model is collapsed into the recursive Folder
table above. See §7 for the iteration-3 migration that walks the
transition.

### §1.6 Project (FT-260704-1620-001 — Media Content Projects)

A named collection of saved articles ("save for a project"). Flat — no
nesting, no folder membership. Rendered in the sidebar PROJECTS section.

| Field | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| `id` | TEXT PK | not null | UUID v4. |
| `name` | TEXT | not null | Sidebar label. 1–60 chars after trim (mirrors `Folder.name`); empty commit reverts (AC-260704-1620-008). Inline rename per handoff screen 3. |
| `position` | REAL | not null, default 0 | Sort order among projects (ascending, creation order by default). |
| `created_at` | TEXT (ISO8601) | not null | Set on insert. |

### §1.7 ProjectArticle (junction) — FT-260704-1620-001

N:M membership of Articles in Projects.

| Field | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| `project_id` | TEXT FK | not null, → `project.id`, `ON DELETE CASCADE` | Deleting a project removes only membership rows (AC-260704-1620-004). |
| `article_id` | TEXT FK | not null, → `article.id`, `ON DELETE CASCADE` | Article deletion (retention §5, source removal §2.1) silently drops membership. |
| `added_at` | TEXT (ISO8601) | not null | Set on insert. |

Primary key: `(project_id, article_id)` — an article is in a project at
most once; saving is idempotent.

---

## §2. Relationships

### §2.1 Source → Article (1:N, ON DELETE CASCADE)

One Source has many Articles. `Article.source_id` references `Source.id`.

**Cascade rule:** When a Source is deleted (FT04 Remove, AC-007 verification),
every Article whose `source_id` matches is deleted in the same transaction.
There is no orphan Article state — Articles cannot outlive their Source.

SQLite enforcement: declare the foreign key with `ON DELETE CASCADE` and enable
`PRAGMA foreign_keys = ON;` at connection time (SQLite's default is OFF, which
silently no-ops the cascade).

```sql
CREATE TABLE article (
  ...
  source_id TEXT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  ...
);
```

### §2.2 Folder → Folder (recursive 1:N, ON DELETE CASCADE) — FT05

A Folder has zero or more child Folders via `Folder.parent_id`. Deleting a
Folder cascades every descendant Folder in the same transaction (the entire
subtree disappears). Member Sources at any depth detach via §2.3 (SET NULL
on `Source.folder_id`).

Tree depth is application-capped at 5 (root = 1, deepest leaf = 5) — see
§2.4 invariants.

### §2.3 Folder → Source (N:1, ON DELETE SET NULL) — FT05

`Source.folder_id` references `Folder.id`. When a Folder is deleted, every
matching Source row is preserved with its FK column set to NULL — those
sources return to the Ungrouped zone (rendering contract per
US-260522-2116-003 / AC-260522-2118-010).

A Source attaches to exactly one Folder (its `folder_id`) at any depth from
1 to 5 — there is no chain of FKs to maintain.

**Cascade-mute predicate (CR-260522-2101-001 iteration 2 + iteration 3,
US-260522-2230-002):** a Source's articles are visible in the combined
"All sources" feed iff

```
Source.muted = 0
  AND no ancestor folder of Source.folder_id (inclusive: the folder itself,
      its parent, grandparent, … up to the root) has muted = 1
```

Equivalently: walk the chain `Source.folder_id → Folder.parent_id → … →
NULL` and require every Folder in that chain to have `muted = 0`. The walk
is bounded by depth 5 so it has at most 5 steps.

Explicit per-source filtered views (sidebar source-row click) ignore the
cascade — they show that source's articles regardless of its ancestors'
mute state, mirroring FT04 behaviour where clicking a muted source row
still navigates to its own filtered feed.

Polling (EP03) is unaffected by folder mute — articles for sources under
muted folders continue to be ingested into the DB, matching the charter
§3 source-mute rule (mute hides but does not pause).

Folder mute toggles do NOT modify `Source.muted` — that field is preserved
verbatim through any number of folder-mute cycles.

### §2.4 Tree invariants — FT05

Application-enforced (server-side) on every POST /folders + PATCH
/folders/{id} that changes `parent_id`:

- **Depth cap:** `Folder.depth ≤ 5` after the write. Violations return
  422 `error: depth_limit`. Cached `Folder.depth` is recomputed for the
  moved folder and every descendant in the same transaction.
- **Acyclic:** moving a folder F under one of F's own descendants is
  rejected. Violations return 422 `error: cycle`.
- **Position:** REAL field; client computes midpoints between adjacent
  siblings. The server accepts any real value; renormalisation is a
  future, opportunistic concern (not blocking).

### §2.5 Project ↔ Article (N:M via `project_article`) — FT-260704-1620-001

An Article can belong to any number of Projects and vice versa, through
the §1.7 junction. Cascades are junction-only in both directions: deleting
a Project never deletes Articles (AC-260704-1620-004); deleting an Article
(source removal §2.1, retention §5) never deletes Projects — the affected
membership rows disappear and project counts shrink accordingly. Feed
visibility rules (§2.3 cascade-mute) do NOT apply inside a project view:
a saved article stays listed in its projects regardless of source/folder
mute state.

---

## §3. Indexes

| Index | Table | Columns | Purpose |
| :--- | :--- | :--- | :--- |
| `idx_source_url` | source | `url` | Dedup check during FT01 add. Unique. |
| `idx_article_url` | article | `url` | Dedup key during EP02 ingestion. Unique. |
| `idx_article_published_at` | article | `published_at DESC` | Newest-first sort for the EP04 feed pagination (50 per page). |
| `idx_article_source_id` | article | `source_id` | Filter the feed pane to one source (FT03 source-row click). |
| `idx_article_read_at_null` | article | `(read_at) WHERE read_at IS NULL` | Unread-count aggregation for FT03 sidebar counts and the "All sources" sum. Partial index keeps it small even at high article volume. |
| `idx_source_folder_id` | source | `folder_id` | Recursive tree rendering — fetch sources per folder (FT05 / US-260522-2116-003). |
| `idx_folder_parent_id` | folder | `parent_id` | Recursive tree walk — fetch children per folder; supports cascade walks for delete + drag + depth recomputation. |
| `idx_project_article_project_id` | project_article | `project_id` | Project view listing + sidebar count pills (FT-260704-1620-001). |
| `idx_project_article_article_id` | project_article | `article_id` | Per-row folder tags + bookmark fill state in the feed (FT-260704-1620-001). |

---

## §4. Read-state model

Per charter §3 and the §read-state decision locked in during charter review:
read state is **one-way**.

- Click on an article in the feed (EP04) → `Article.read_at = current_timestamp`.
- No UI flips `read_at` back to NULL (charter §3 out-of-scope: "Manual
  mark-as-unread").
- Unread count for one source: `SELECT COUNT(*) FROM article WHERE source_id = ?
  AND read_at IS NULL`.
- "All sources" total: `SELECT COUNT(*) FROM article WHERE read_at IS NULL`.

The `idx_article_read_at_null` partial index makes both queries cheap.

---

## §5. Retention

Per charter §3: articles older than `retention_days` (default 30, §6) are pruned
by a daily background cleanup job (EP02 feature).

```sql
DELETE FROM article WHERE fetched_at < datetime('now', '-' || ? || ' days');
```

**Important:** the retention check uses `fetched_at`, not `published_at`. An
old article (published 2 years ago) ingested today must not be pruned for 30
more days, regardless of its publish date.

Read state (`read_at`) does not affect retention — read and unread articles are
pruned identically once they age out.

---

## §6. Settings — canonical keys

| Key | Coerced type | Default | Range | Owner |
| :--- | :--- | :--- | :--- | :--- |
| `polling_interval_minutes` | INTEGER | 20 | 5–120 | EP03 |
| `retention_days` | INTEGER | 30 | 1–365 | EP02 |
| `grouping_banner_dismissed` | BOOL (0/1) | 0 | 0–1 | FT05 (US-260522-2116-009) — set to 1 by `×` click OR auto-set by the POST /groups handler on the first Group create. Once 1, never resets. |

The app reads these on startup and on Settings-page save. EP03 reloads the
polling interval at the start of every poll cycle (no app restart needed).

---

## §7. Migrations

First-run schema bootstrap is owned by EP05 (Setup & Self-Hosting). The
bootstrap script:

1. Creates the `source`, `article`, `settings`, `group`, and `subgroup`
   tables with the schemas above.
2. Creates the indexes in §3.
3. Inserts the §6 default settings (including `grouping_banner_dismissed`
   defaulted to 0).
4. Loads the 10–15 seed sources (EP05 feature). Seed sources land with
   both `group_id` and `subgroup_id` NULL (Ungrouped zone).

**FT05 additive migration (CR-260522-2101-001, iteration 1):** on databases
bootstrapped before FT05 landed, the migration step is purely additive:

- `CREATE TABLE "group" (...)` per §1.4.
- `CREATE TABLE subgroup (...)` per §1.5 with FK to group.id ON DELETE
  CASCADE.
- `ALTER TABLE source ADD COLUMN group_id TEXT REFERENCES "group"(id)
  ON DELETE SET NULL` (nullable, defaults to NULL on existing rows).
- `ALTER TABLE source ADD COLUMN subgroup_id TEXT REFERENCES subgroup(id)
  ON DELETE SET NULL`.
- Create §3 indexes `idx_source_group_id`, `idx_source_subgroup_id`,
  `idx_subgroup_group_id`.
- INSERT the `grouping_banner_dismissed = 0` settings row.

**FT05 additive migration (CR-260522-2101-001, iteration 2):** on databases
that already carry the iteration-1 schema, iteration 2 is purely additive
on top of it:

- `ALTER TABLE "group" ADD COLUMN muted INTEGER NOT NULL DEFAULT 0`
  (idempotent — skipped when the column already exists; existing rows
  backfill with 0).
- `ALTER TABLE subgroup ADD COLUMN muted INTEGER NOT NULL DEFAULT 0`
  (same).

**FT05 collapse migration (CR-260522-2101-001, iteration 3):** the two-table
Group + Subgroup model is collapsed into a single recursive `folder` table.
Migration is idempotent (skipped when `folder` table already exists with
the iteration-3 shape):

1. `CREATE TABLE folder (id, parent_id, name, position, collapsed, muted,
   depth, created_at)` with FK `parent_id → folder(id) ON DELETE CASCADE`.
2. `ALTER TABLE source ADD COLUMN folder_id TEXT REFERENCES folder(id) ON
   DELETE SET NULL` if missing.
3. `INSERT INTO folder` one row per existing `group` row, with `depth=1`,
   `parent_id=NULL`, copying `id`/`name`/`position`/`collapsed`/`muted`/
   `created_at`.
4. `INSERT INTO folder` one row per existing `subgroup` row, with
   `depth=2`, `parent_id = <the matched group's new folder id>`,
   copying the rest.
5. `UPDATE source SET folder_id = COALESCE(<matched subgroup folder>,
   <matched group folder>)`. Subgroup-attached sources win over
   group-attached sources, preserving iteration-1 invariants.
6. `CREATE INDEX idx_folder_parent_id ON folder(parent_id)`;
   `CREATE INDEX idx_source_folder_id ON source(folder_id)`.
7. `DROP TABLE subgroup`; `DROP TABLE "group"`.
8. `ALTER TABLE source DROP COLUMN subgroup_id`; `DROP COLUMN group_id`.

No source or article row is rewritten or deleted. Folder-row count after
migration equals (group rows + subgroup rows) before migration. Verified
by AC-260522-2117-007 and AC-260522-2400-002.

**Source ratings migration (FT — Source Ratings):** additive.

- `ALTER TABLE source ADD COLUMN reliability TEXT NOT NULL DEFAULT 'medium'` (idempotent — skipped when present; existing rows backfill `'medium'`).
- `ALTER TABLE source ADD COLUMN impact TEXT NOT NULL DEFAULT 'medium'` (same).
- Allowed values `('high','medium','low')` enforced application-side (optional SQL CHECK), mirroring the `discovery_method` pattern.

**Import-staging migration (EP — Data Portability):** create the `import_staging` table (§11) + its index if missing. Additive; no existing row is touched.

**Media Content Projects migration (FT-260704-1620-001):** additive, idempotent (skipped when the tables exist).

- `CREATE TABLE project (id, name, position, created_at)` per §1.6.
- `CREATE TABLE project_article (project_id, article_id, added_at, PRIMARY KEY (project_id, article_id))` per §1.7, FKs `ON DELETE CASCADE` both ways (`PRAGMA foreign_keys = ON` required, as §2.1).
- Create §3 indexes `idx_project_article_project_id`, `idx_project_article_article_id`.

No existing table or row is touched.

Subsequent migrations are versioned (`schema_version` column in `settings` or a
dedicated `migrations` table — to be specified when EP05 stories are authored).

---

## §8. Forward references — not yet authored

The following will be added when the relevant epic gets its story tier:

- **AUDIT_MODEL.md** — `PollEvent`, `IngestEvent`, `CleanupEvent` audit records.
  Referenced by EP03 and EP02. Skeleton to be authored alongside EP03 stories.
- **§Source.discovery_method enum constraints** — exact SQL check constraint or
  application-level enforcement. To be decided when FT01 stories are authored.

---

## §9. Import / Export — portability format (`almanach-portability/v1`)

Moves the source library (folders + sources + ratings) in and out as a single YAML
file. Mirrors the Filum DB↔YAML mechanism: export writes the file, a sync flag
(§10) requests import, import stages changes (§11) for human review in the app.

- **Single file**, not status-partitioned (sources have no draft/active/closed
  lifecycle). Carries an envelope + versioned schema.
- **Shape:** top-level `meta` (`schema: almanach-portability/v1`, `exported_at`,
  `generated_by`) and `folders` — a recursive tree (`name`, `children`,
  `sources`). Each source carries `url` (homepage, required), `reliability`,
  `impact`. `feed_url` / `discovery_method` / `display_name` / `colour` are NOT
  stored — resolved at import via the discovery waterfall (§1.1), exactly as the
  add-source flow does.
- **First-run seed:** bundled `02_code/almanach/data/default_library.yaml` loads
  when the DB has no sources (folder-aware). The curated set nests under an
  `AI news proposal` parent → `Specialized` / `General` → category folders; the
  legacy flat seed is unaffected (additive).
- **Export:** live DB → `<ALMANACH_DATA_DIR>/almanach-library.yaml` (+ sync flag §10).
- **Versioning:** `v1` = folders + sources + ratings. A future `v2` adds an
  `articles` block (the news store) additively; v1 readers ignore unknown blocks.

---

## §10. Sync control file (`almanach-sync.yaml`)

Mirrors Filum's `project-sync.yaml`. A small control file in `<ALMANACH_DATA_DIR>`.

| Field | Values | Notes |
| :--- | :--- | :--- |
| `status` | `ready` \| `import` | `import` requests ingestion of `almanach-library.yaml`; reset to `ready` after staging. |
| `export_status` | `new_export` \| `reviewed` \| null | Set `new_export` after an export; cleared on review. |
| `updated_at` | ISO8601 | last write time. |
| `updated_by` | `ALMANACH` \| `CLAUDE` | who last wrote. |

A live `watchdog` monitor watches this file (debounced); on `status: import` it
runs the staged import (§11) then resets to `ready`. The ALMANACH source-curation
process (CLAUDE.md §A1) sets `status: import` after writing the library YAML.

---

## §11. Staging zone — `import_staging`

Mirrors Filum's two-zone safeguard: **import never writes the live `folder` /
`source` tables.** Proposed changes land here until the user approves them in the
Review screen.

| Field | Type | Notes |
| :--- | :--- | :--- |
| `id` | TEXT PK | UUID. |
| `object_kind` | TEXT | `folder` \| `source`. |
| `change_type` | TEXT | `ADDED` \| `MODIFIED` \| `REMOVED`. |
| `staged_data` | TEXT (JSON) | full proposed state (incl. `reliability` / `impact` for sources); null for `REMOVED`. |
| `created_at` | TEXT (ISO8601) | insert time. |

Index `idx_import_staging_kind` on `object_kind`. Re-import replaces existing
staging rows for the same object. On approval the staged state is applied to the
live tables (the user may adjust `reliability` / `impact` during review); on
reject the row is discarded.

---

## §12. Excel source hierarchy import / export (CR-260704-1825-001)

A second, user-owned portability path alongside §9–§11 (YAML + staged review):
export / template / upload via the header **Sources data** menu, as an Excel
`.xlsx` workbook (chosen over XML for hand-editability). **Upload REPLACES the
live `folder` tree + `source` list immediately — no staging, no approval.** This
is the documented exception to §11's two-zone safeguard; the YAML sync path keeps
staging mandatory.

Module `almanach/excel_io.py`; endpoints `GET /io/export`, `GET /io/template`,
`POST /io/import` (raw `.xlsx` bytes as the request body). Media type
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`. Depends on
`openpyxl`.

Workbook shape — one `Sources` sheet, **one row per source, row order = display
order**; the template adds a second `How to use` sheet. Columns (matched on
import by header name, so a user may reorder/omit them):

| Column | Maps to | Notes |
| :--- | :--- | :--- |
| `Folder` | `folder` tree | `/`-separated path, e.g. `AI / Generalist-Daily`; blank = ungrouped; ≤5 levels. An empty folder exports as a folder-only row. |
| `Source name` | `Source.display_name` | defaults to the URL host if blank. |
| `URL` | `Source.url` (canonicalised) | **required** for a new source. |
| `Feed URL` | `Source.feed_url` | defaults to the homepage URL if blank. |
| `Color` | `Source.colour` | palette colour picked if blank. |
| `Muted` | `Source.muted` | `yes`/`no`. |
| `Reliability` / `Impact` | `Source.reliability` / `.impact` | invalid → `medium`. |
| `Article count` | — | export-only (derived); ignored on import. |

Hierarchy = the `Folder` path column (no nesting in the file); folders are
(re)created from the paths in first-appearance order. There is **no id column** —
a source's identity is its **URL**.

Replace semantics (single IMMEDIATE transaction — an invalid workbook changes
nothing): existing sources match by canonical `url` and are **updated in place**
(articles + read state survive the round-trip); a live source whose URL is absent
from the sheet is **deleted (articles cascade)**; a new row requires a valid
`url` (skipped + reported otherwise); changing a row's URL makes it a new
provider (old one deleted). No discovery dispatch — `Feed URL` is taken as-is, so
a missing feed may poll with errors until corrected.

---

*End of document.*
