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
Flow). Polled by EP03. Rendered by FT03. Mutated by FT04.

| Field | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| `id` | TEXT PK | not null | UUID v4 generated on insert. |
| `url` | TEXT | not null, unique | Canonical homepage URL pasted by the user. Immutable after creation (FT04 rename does NOT touch this). |
| `feed_url` | TEXT | not null | Resolved feed URL from FT02 waterfall (the `<link rel="alternate">` href, a `/feed`-style path, or the discovered sitemap URL). |
| `discovery_method` | TEXT | not null, enum | `alternate_link` \| `common_path` \| `sitemap`. Set by FT01 from FT02's response. Determines how EP02 ingests articles for this source. |
| `display_name` | TEXT | not null | Sidebar label. Defaults to the feed's `<title>` element on creation; falls back to the URL hostname if absent. Mutated by FT04 rename. |
| `colour` | TEXT | not null | Hex string from the curated 12-palette (e.g. `#378ADD`). Auto-assigned by FT01 (round-robin through the palette, collisions allowed only after exhaustion). No user override in MVP. |
| `muted` | INTEGER | not null, default 0 | Boolean. Toggled by FT04 mute / unmute. When 1: source is hidden from the combined feed (EP04 filter), but EP03 polling continues normally. |
| `created_at` | TEXT (ISO8601) | not null | Set by FT01 on insert. |
| `last_polled_at` | TEXT (ISO8601) | nullable | Updated by EP03 at the end of every successful poll cycle. NULL on a never-polled source. |
| `last_error` | TEXT | nullable | Human-readable error message from EP03's most recent failed poll. Cleared (set to NULL) on the next successful poll. |
| `consecutive_failure_count` | INTEGER | not null, default 0 | Incremented on every poll failure. Reset to 0 on success. EP03 may use this to back off or surface the source as broken in the UI (future). |

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

---

## §3. Indexes

| Index | Table | Columns | Purpose |
| :--- | :--- | :--- | :--- |
| `idx_source_url` | source | `url` | Dedup check during FT01 add. Unique. |
| `idx_article_url` | article | `url` | Dedup key during EP02 ingestion. Unique. |
| `idx_article_published_at` | article | `published_at DESC` | Newest-first sort for the EP04 feed pagination (50 per page). |
| `idx_article_source_id` | article | `source_id` | Filter the feed pane to one source (FT03 source-row click). |
| `idx_article_read_at_null` | article | `(read_at) WHERE read_at IS NULL` | Unread-count aggregation for FT03 sidebar counts and the "All sources" sum. Partial index keeps it small even at high article volume. |

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

The app reads these on startup and on Settings-page save. EP03 reloads the
polling interval at the start of every poll cycle (no app restart needed).

---

## §7. Migrations

First-run schema bootstrap is owned by EP05 (Setup & Self-Hosting). The
bootstrap script:

1. Creates the `source`, `article`, and `settings` tables with the schemas
   above.
2. Creates the indexes in §3.
3. Inserts the §6 default settings.
4. Loads the 10–15 seed sources (EP05 feature).

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

*End of document.*
