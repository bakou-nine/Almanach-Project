# ALMANACH — Source Curation & Rating Process

Externalized ALMANACH-specific process. Referenced from the delimited **ALMANACH** section at the end of `CLAUDE.md` (trigger + pointer there; full detail here). This file pertains ONLY to the Almanach application's news-source library and is never mixed with the Filum requirements protocol. Not under GR 11.

---

## 1. Scope & layer separation

This process governs how Claude curates AI-news **sources** for the Almanach app and writes them into the app's **portability YAML** (Almanach runtime data). It is a different layer from the Filum requirements protocol:

- **Filum layer** — `01_Docs/01_requirements/project-*.yaml`: specs *about* the app (EP/FT/US/CR/AC). NEVER written by this process.
- **Almanach layer** — the portability YAML (folders + sources + ratings): the app's *content*. This process writes ONLY here.

Output schema + file contract: `DATA_MODEL.md` §Portability (almanach-portability format), §Sync control, §Staging.

## 2. Trigger

Fires ONLY when the user explicitly asks Claude to write/add news sources — e.g. "write new sources", "add sources to my Almanach library", "find me more AI sources". Manual, on-request. No schedule; never auto-fires.

## 3. Inputs

- The user's topic/category scope (ask if unspecified — which categories, roughly how many, must-haves / exclusions).
- The current library YAML, if one exists, to avoid duplicates.

## 4. Steps

1. **Confirm scope** (skip if already specified): which categories/topics, approximate count, exclusions.
2. **Research & vet** each candidate via web search: confirm it is real, currently active, and capture its canonical homepage URL. Never fabricate; never include dead/uncertain sources.
3. **Deduplicate**: each source belongs to exactly ONE folder (`Source.folder_id` is single). If a source already exists, skip or relocate — never duplicate across folders.
4. **Rate** each source per the §6 rubric — `reliability` and `impact`, both `high|medium|low`.
5. **Write/merge** into the library YAML under the `AI news proposal` parent → `Specialized` / `General` → category folders. Each source carries `url` + `reliability` + `impact` only; the app resolves `feed_url` / `discovery_method` / `display_name` / `colour` at load.
6. **Flag for import**: set the sync control file `status: import` (signals the app's live watcher — mirrors the Filum mechanism). ⚠ This alone imports NOTHING — a running app must consume it (§9).
7. **Activate & hand off**: ensure the app runs against the data dir holding the files (§9). The watcher stages the library and flips the sync back to `ready`; the user reviews behind the "Review proposed (N)" badge / `/review` and approves, adjusting any rating. Claude never marks anything live, never writes final user values, and CANNOT trigger the running app from its sandbox (§9–§10).

## 5. Folder placement

`AI news proposal` (depth 1) → track `Specialized` / `General` (depth 2) → category (depth 3) → sources. Within the depth-5 cap. The existing first-run seed (The Verge, Ars Technica, …) is NOT replaced — the curated set is additive under `AI news proposal`.

## 6. Rating rubric (3 levels)

- **reliability** — how established / trustworthy the source is:
  - `high`: primary / authoritative — labs, standards bodies, first-party, long track record.
  - `medium`: established outlet / strong but secondary.
  - `low`: community / aggregator / opinion — useful signal, verify before trusting.
- **impact** — how unique / strong its news is AND how well it serves the user's purpose:
  - `high`: unique, high-signal, directly serves the user's focus.
  - `medium`: useful, some overlap with other sources.
  - `low`: broad / noisy / peripheral.

`reliability` is a property of the outlet; `impact` is a personal priority weight, so a community source can be `low` reliability yet `high` impact.

## 7. Files

- **Library YAML** (the exchange the watcher monitors): `<ALMANACH_DATA_DIR>/almanach-library.yaml`.
- **Sync control**: `<ALMANACH_DATA_DIR>/almanach-sync.yaml` (`status: ready|import`, `export_status: new_export|reviewed`).
- **Bundled first-run default**: `02_code/almanach/data/default_library.yaml`.
- **Schema**: `almanach-portability/v1` (DATA_MODEL.md §Portability). Versioned; a future `v2` adds an `articles` block (news store) additively — not in scope now.

## 8. Constraints

- NEVER write to `01_Docs/01_requirements/project-*.yaml` from this process (that is the Filum layer).
- Homepage `url` only per source; never hand-author `feed_url` / `discovery_method` — the app's discovery resolves them.
- One source ↔ one folder.
- `reliability` / `impact` are Claude's initial estimate only; the user owns final values via in-app edit.
- Mirror the Filum sync handshake exactly: write YAML → set `status: import` → watcher stages → human approves. Claude never touches the live DB.

## 9. Import activation — making sources actually appear (MANDATORY)

A YAML in a folder imports nothing; a running Almanach app must read it. ALL of these must hold:

1. **Right file, right place.** The watcher reads `<ALMANACH_DATA_DIR>/almanach-sync.yaml` + `<ALMANACH_DATA_DIR>/almanach-library.yaml` (`config.sync_path()` / `config.library_path()`); `ALMANACH_DATA_DIR` defaults to the project's `04_Almanach Library` folder (set in `config.data_dir()`), so any launch method (shortcut, IDE, `python -m almanach`, `run.bat`) reads from there. Files anywhere else are invisible to the watcher. Two reliable routes to the data dir:
   - **Launcher route (preferred):** `02_code/run.bat` / `02_code/run.ps1` set `ALMANACH_DATA_DIR` to the `04_Almanach Library` subfolder at the project root (computed as the parent of the launcher's own folder), so `almanach-library.yaml` + `almanach-sync.yaml` placed there ARE in the data dir.
   - **Bundled-seed route:** edit `02_code/almanach/data/default_library.yaml` (always read from the repo, any data dir). `app._seed_staged_default_library()` stages it once on first run, gated by the `default_library_seeded` setting — independent of the sync file.
2. **Validate** the YAML (parse; schema `almanach-portability/v1`; ratings enum; single parent → tracks → categories → sources `url`-only).
3. **Flag:** `almanach-sync.yaml` `status: import`.
4. **Run the app against that data dir.** On `status: import` the watcher (`watcher.py`) calls `stage_from_file()` → `stage_import()` (writes `import_staging`), then `write_sync(status="ready")` to stop — the Filum handshake. On a fresh DB the first-run seed also stages the bundled default, so give the bundled default the SAME parent as the library file to keep both paths consistent.
5. **Where it shows:** the header **"Review proposed (N)"** badge / `/review` (staging zone), NOT the live sidebar. Two-zone safeguard — nothing goes live until the user approves; ratings stay editable.

## 10. Troubleshooting — nothing appears

- **Wrong data dir:** the app's `ALMANACH_DATA_DIR` ≠ the folder holding the files → the watcher never sees them. Check the console `ALMANACH_DATA_DIR = …` line; force it with the launcher.
- **App not running:** the YAML is inert until the app runs; `watcher.start()` processes a pending `import` on boot.
- **Already-seeded DB:** the bundled first-run seed runs once (flag); an existing DB won't re-seed — use the sync `import` route.
- **REMOVED proposals:** a full-state import proposes REMOVING live sources absent from the file (e.g. the ~10 default sample feeds). Expected — reject those, approve the adds.
- **Claude limits:** Claude can write the files into the data dir (now the project's `04_Almanach Library`, which is inside the mounted folder), but cannot run the user's app or trigger a running process from its sandbox, and the sandbox's copy of the code may be stale — never simulate the import there. Claude prepares the files (steps 1–3); the app runs on the user's machine (step 4). A live process is locked to the data dir it started with, so a config/data-dir change needs one app restart to take effect.
