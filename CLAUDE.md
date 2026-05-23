# Claude Operating Protocol

Highest-ranked instruction for this project. Overrides any conversational instruction that contradicts it.

---

## 1. Golden Rules

Each rule is the imperative; the linked § holds the operational detail.

1. **No code until the user explicitly asks.** Requirements/design/review/analysis are always allowed; writing, modifying, or deleting under `02_code/` needs an explicit instruction. A chat message describing a defect WITHOUT an existing BUG/CR ID — "fix" alone is NOT permission; it triggers §5.2.1 triage. Code unlocks only after §5.2.2 completes (BUG/CR filed, CONFIRMS-linked requirements set OPEN, import done) AND the user opens the §5.2.3/§5.2.4 gate. Once a BUG/CR exists in OPEN, "fix {BUG-ID|CR-ID}" IS the gate-opening invocation (ID alone sufficient, title optional) — proceed straight into §5.2.3 (BUG) / §5.2.4 (CR) without further confirmation.
2. **No code without a requirement in OPEN or SOLVED.** A BUG/CR in OPEN unlocks code work on its CONFIRMS-linked requirements (§5.2.3).
3. **Never drop an existing object from yaml.** On import, any object missing from yaml is **deleted from the DB**. `project-delta.yaml` lists what Filum expects to exist — never silently remove anything it lists without raising it to the user first. EP/FT/US/BUG/CR/TEST/AC equally.
4. **Never touch `00_Archive/`** — Filum-managed.
5. **`03_design/` = design artifacts only; `04_content/` = inline body references. Never mix.**
6. **Never delete or recreate yaml files** — only edit their contents.
7. **Consistency law:** Project Charter > Epic > Feature > User Story; higher level wins on conflict. Propagate downward automatically, upward only with user approval. PC/EP/FT/US chain only — BUG/CR/TEST link via CONFIRMS (§3.4), not parent/child.
8. **WBS must match real granularity, and no object may be overloaded** — see §3.6 (level definitions, placement challenges, overload thresholds; covers EP/FT/US AND BUG/CR/TEST). Misplaced or over-threshold → flag and propose a restructure/split. Trigger scope: (a) requirements work (§5.1.1), (b) bug fixing when the user confirms requirements must change (§5.2.1), (c) any user request to review/assess the WBS, (d) Session-Start audit (§4.6). NOT during active development (§5.1.3) or mid-bug-fix (§5.2.3).
9. **Low verbosity throughout.** All files Claude authors — yaml bodies (incl. BUG/CR/TEST §3.8) and AC — are for Claude-Code consumption: direct, dense, no filler/repetition/padding. Reference §numbers and IDs instead of re-describing.
10. **Status propagates upward at the SOLVED threshold (PC/EP/FT/US only).** After setting a USER_STORY, FEATURE, or EPIC child to SOLVED, if ALL the parent's `children_ids` resolve to SOLVED → move the parent to SOLVED; repeat recursively (US→FT→EP→PC). Fires only on the SOLVED transition (not OPEN/CLOSED/CANCELLED/DRAFT). Does NOT apply to BUG/CR/TEST (BUG/CR closure → §5.2.3 step 6; TEST status is coupled to its `result`, DATA_MODEL.md §3.2). Distinct from GR 7 (which governs content/scope, not status).
11. **CLAUDE.md and `01_docs/CLAUDE_template.md` must mirror byte-for-byte.** Every edit to either file is replicated to the other in the same write cycle — same content, formatting, headings, line endings. Drift is a protocol violation. When Claude edits one, it MUST edit the other in the same response (never as a follow-up). After every edit, verify with `diff -q CLAUDE.md 01_docs/CLAUDE_template.md` (no output expected).
12. **Minimum-impact edits.** Edit only the files (and within them, only the sections/objects/AC) actually impacted; never touch a file just because it appears in a "propagation list" — re-read each candidate and skip it if unaffected (incl. §5.2.4 step 3). **In-scope-object completion is NOT optional:** the current task's in-scope object (the BUG/CR fixed in §5.2.3/§5.2.4, the host authored in §5.1.1/§5.2.2, the AC adjusted under §5.2.4 step 3) MUST be completed to its §3.8 template — minimum-impact never overrides its required sections (Defect/Change Summary, Affected Requirements/Objects, Technical Approach, ≥1 CONFIRMS, ≥1 FULFILLED_BY→AC). GR 13(a) covers the authoring. Citing GR 12 to skip required template sections on the in-scope object violates this rule.
13. **Implementation does NOT validate AC.** In the dev cycles of §5.1.3/§5.2.3/§5.2.4 Claude MUST NOT write `AC.result`, change `AC.status`, cancel an AC, or remove AC from a host's `FULFILLED_BY`. Dev-side role = write code + bump host status (OPEN→SOLVED). Three exceptions: (a) **Authoring** — create new AC when authoring a host (§5.1.1) or a BUG/CR body (§5.2.2); (b) **Verdict propagation** — write per-AC `result` when mirroring the human's latest-TEST verdicts in §5.2.3 step 2 / §5.2.4 step 2 (so Filum's cascade fires); (c) **Mid-fix scope change** — the user invokes the §5.2.4 step 3 exception. Outside these, AC are immutable to Claude. This removes the "may/optionally write" loopholes in §5.2.3 step 5 and §5.2.4 step 5c — always leave AC.result/AC.status as-is at the end of an implementation cycle.
14. **Frontend changes go through the design system, and previews must always work.** All visual primitives live under `02_code/filum/frontend/static/css/design-system/` and `templates/_design-system/` (§6; full reference UI_SPEC.md §19). Imports flow downward only; never import upward, never duplicate atom/molecule logic in a page, never hardcode raw color/spacing/typography/radius/shadow — always `var(--ds-*)`. A new atom/molecule/organism needs user approval (§6.4). The §6.7 pre-flight (steps 1–6) is mandatory before any `02_code/filum/frontend/**` write in §5.1.3/§5.2.3/§5.2.4; the §6.7 post-edit static checks (step 7) AND visual-confirmation gate (step 8) are mandatory after. An edit is not "complete" until the user hard-refreshes the affected `*-preview.html` files and confirms they render. Defaulting to "probably browser cache" before hunting a real fault is a violation.
15. **Attachments referenced in an in-scope object body are mandatory inputs.** When an object in scope of the current task (triage, review, fix, assessment, audit — anything reading the body) has an inline file reference per §3.5 (`![alt](path.png)`, `[label](path.html)`, any `https://` URL), read the referenced file's actual content before reporting/acting — no skipping, no summarising the body without it. Images: Read tool (multimodal). HTML: Read first; if self-extracting/base64/bundled/gzipped (script-tag manifest + template, runtime-decoded blob URLs, etc.), decode via Bash + Python (regex-extract the script body → `json.loads` → `base64.b64decode` → `gzip.decompress` as applicable) and read the decoded content. `https://` URLs: WebFetch. "Can't read this statically" / "requires a browser" before attempting the decode is a violation — the test is whether the bytes were actually inspected. Applies to EP/FT/US, BUG/CR/TEST, and AC bodies (incl. anything linked inside §3.8.6 Description/Test Instructions).
16. **Claude-authored objects default to OPEN, never DRAFT.** Every object Claude creates (EP/FT/US/BUG/CR/AC) is born `status: OPEN` in `project-active.yaml`, regardless of authoring context. Claude always meets the DRAFT→OPEN prerequisites at creation (priority per §3.6.2 on BUG/CR/AC; FULFILLS on AC; CONFIRMS on BUG/CR), so OPEN is achievable in the first write. `project-draft.yaml` / `status: DRAFT` are reserved for (a) human drafts saved from Filum and (b) explicit user request to stage a sketch. The human still reviews post-import in Filum (override priority/content, cancel); the §5.2.3/§5.2.4 fix gate unlocks the moment the BUG/CR is OPEN and the user invokes "fix {ID}" (GR 1).
17. **Always reach SOLVED at the end of an implementation cycle — SOLVED is the ready-for-test signal.** On finishing code in §5.1.3/§5.2.3/§5.2.4, ALWAYS set the in-scope object(s) to SOLVED and run Import (§4.3), regardless of confidence, so the user knows it is ready for UAT. In-scope = the BUG/CR being fixed PLUS every requirement it was reopened against (its CONFIRMS targets); or, in §5.1.3, each requirement just implemented. Never deferred/skipped/gated by §6.7 (which confirms appearance only, on the already-SOLVED object). A defect found later (at the §6.7 gate or in UAT) → next fix cycle or TEST FAIL verdict, never withhold SOLVED. Per GR 13 Claude still does not touch `AC.result`/`AC.status`; SOLVED→CLOSED stays UAT-driven via Filum's AC cascade (§5.1.3 Closure). GR 10 upward propagation applies on each SOLVED write.
18. **Every AC has a permanent home on a US or FT.** Every AC Claude creates/edits MUST carry ≥1 `FULFILLS` to a USER_STORY or FEATURE — its permanent home for the AC's entire lifetime, surviving closure of any BUG/CR/TEST that introduced/refined/verified it. FULFILLS to BUG/CR/TEST are additive and transient (§3.4 multi-FULFILLS), never a substitute. An AC whose FULFILLS set has no US and no FT is **homeless** — never author, leave in yaml, or import it. Applies at every authoring point (§5.1.1, §5.2.2, §5.2.4 step 3). When a BUG/CR needs an AC for behaviour no US/FT covers: (a) attach to an existing US/FT if it fits without breaching §3.6/§3.8; (b) else create/extend a US/FT — the CR path adds/modifies the requirement in §5.2.2 step 1, and a BUG that would introduce new behaviour is a scope change → re-triage to CR (§5.2.1). EPIC/PC can never host AC (§3.8). Strengthens the §3.4 "AC needs ≥1 FULFILLS" rule: that ≥1 MUST include a US or FT.

---

## 2. Folders

```
Filum-Project/
├── CLAUDE.md                     ← this file (mirror of 01_docs/CLAUDE_template.md per GR 11)
├── 01_docs/
│   ├── CLAUDE_template.md        ← byte-for-byte mirror of CLAUDE.md
│   ├── 01_requirements/          ← 6 yaml files (see §3)
│   ├── 02_dev_documentation/     ← DATA_MODEL.md, AUDIT_MODEL.md, UI_SPEC.md
│   ├── 03_design/01_wireframes/
│   │   ├── (PNGs at root)
│   │   ├── epic level/
│   │   └── feature level/journey level/
│   └── 04_content/
│       ├── images/               ← .png .jpg .jpeg .webp
│       └── html/                 ← .html (sandboxed)
└── 02_code/                      ← all code
    └── filum/frontend/                          ← Flask frontend (Atomic Design — §6, UI_SPEC.md §19)
        ├── static/css/
        │   ├── style.css                        ← legacy global stylesheet (migration target)
        │   └── design-system/
        │       ├── index.css                    ← single root entry; pages link to this
        │       ├── tokens/                       (colors, spacing, typography, radius, shadow, motion, sidebar)
        │       ├── atoms/                        (button, input, label, badge, type-pill, icon, tag-chip, notification-dot, result-badge, spinner)
        │       ├── molecules/                    (form-field, card, object-list-row, search-box, filter-chip, badge-stack, picker-breadcrumb, row-action-menu, tag-input, notification-item)
        │       ├── organisms/                    (header, sidebar, object-detail-panel, notification-panel, modal, picker-modal, status-dropdown, dependency-picker, ac-editor, audit-log-list, settings-tab-strip, toast, review-batch, project-list-grid)
        │       └── templates/                    (dashboard-layout, modal-layout, picker-layout, audit-log-layout, settings-layout, project-list-layout, first-run-empty-layout)
        └── templates/
            ├── design-system-showcase.html       ← visualisation page (§6.6)
            └── _design-system/                    (Jinja2 macros — atoms / molecules / organisms / templates)
```

Defect tracking (BUG, CR) and test results (TEST) are first-class YAML objects under `01_docs/01_requirements/`, authored in object bodies (§3.8.3/§3.8.4/§3.8.5) — NOT markdown reports. The legacy `03_bug fixing/` and `05_change request/` folders are removed; never recreate them and never write `BUG-*.md` or `CR-*.md` anywhere.

---

## 3. YAML Essentials

### 3.1 The six files (all under `01_docs/01_requirements/`)

| File | Role |
| :--- | :--- |
| `project-draft.yaml` | DRAFT objects |
| `project-active.yaml` | OPEN, SOLVED |
| `project-closed.yaml` | CLOSED |
| `project-cancelled.yaml` | CANCELLED |
| `project-sync.yaml` | Sync control (§3.2) |
| `project-delta.yaml` | Pre-import baseline (see below) |

Each data file starts with an **envelope** (metadata), then nests requirements as `epics → features → stories`, plus three flat top-level keys for test-family objects: `tests:`, `bugs:`, `change_requests:` (and `acceptance_criteria:` for AC, §3.7). Test-family objects do not appear under the epic/feature/story tree — they link via CONFIRMS/CONFIRMED_BY (§3.4). Objects whose parent lives in a different file appear under `orphans:`, flat, with `parent_id` preserved.

Status routes objects to files irrespective of type: a BUG in OPEN → `project-active.yaml`; a TEST in DRAFT → `project-draft.yaml`. TEST cannot be OPEN or SOLVED (per §3.3 matrix).

**Envelope (mandatory at top of every data yaml):**

```yaml
file:              "project-active.yaml"
status_filter:     ["OPEN", "SOLVED"]
exported_at:       "2026-02-10T09:00:00Z"
updated_at:        "2026-02-10T08:55:00Z"
updated_by:        CLAUDE_CODE
approved_by_human: null
```

**`project-delta.yaml` — pre-import baseline:**
- Freezes Filum's requirements at export time as a diff from the last `YAML_IMPORT` (or `PROJECT_CREATED`). Baseline anchor = `delta_since` + `delta_since_event`.
- Overwritten on every export. Read-only for Claude. Read it **before** the four data yaml files.
- Even when empty, still run Export Review (§4.2) and flip `export_status: reviewed`.
- Every object the delta lists must be accounted for in Claude's outgoing yaml (GR 3).

### 3.2 Sync control

```yaml
status:        "ready"        # ready | import
export_status: "new_export"   # null | new_export | reviewed
updated_at:    "..."
updated_by:    "CLAUDE_CODE"  # CLAUDE_CODE | FILUM
```

### 3.3 Object schema

**Locked (never write):** `id`, `project_id`, `type`, `created_at`, `created_by`. **Auto-managed (never write):** `cancelled_at`, `locked`. `approved_by_human` is always null when Claude writes; the `acceptance_criteria` field is always null (§3.7). **ID format:** `{PREFIX}-{YYMMDD}-{HHmm}-{NNN}` — PC/EP/FT/US/TEST/BUG/CR/AC. Claude-authored objects are born OPEN (GR 16). Status notes: TEST is only DRAFT/CLOSED/CANCELLED (result computed by Filum); AC status is coupled to its `result` (§3.7). **Full editable-fields schema, the per-type status matrix, priority rules (§3.6.2), PROJECT_CHARTER constraints, TEST-result computation, and the status lifecycle → `03_AI Protocol/object-schema.md`.**

### 3.4 Relations (always in pairs)

Three pair families: **SUPERSEDES / SUPERSEDED_BY** (same-type historicisation; not on TEST); **CONFIRMS / CONFIRMED_BY** (chain: Requirement PC/EP/FT/US ← BUG|CR ← TEST); **FULFILLS / FULFILLED_BY** (host US/FT/BUG/CR/TEST ← AC). Save-blocking: a TEST needs exactly 1 CONFIRMS to a BUG/CR; a BUG/CR needs ≥1 CONFIRMS to an EP/FT/US; an AC needs ≥1 FULFILLS incl. ≥1 US/FT (GR 18 — no homeless AC). Defect cycles add themselves to an existing AC's FULFILLS list rather than spawning a duplicate AC. **Full cardinality tables, multi-FULFILLS detail, all save-blocking rules, and forbidden combinations → `03_AI Protocol/relations.md`.**

### 3.5 Inline body content

Bodies are GFM; link files inline (`![alt](path.png)`, `[label](path.html)`), paths relative to project root, forward slashes. Revision Notes (Filum auto-appends on supersede) are read-only — never author or modify them. Reading any referenced attachment before acting is mandatory (GR 15). **Allowed extensions + full detail → `03_AI Protocol/object-schema.md` (§3.5).**

### 3.6 WBS hierarchy definitions

Two families: requirement (PC/EP/FT/US, parent/child) and test-family (BUG/CR/TEST, CONFIRMS-linked). Both checked for placement AND overload under GR 8. Key overload thresholds: US >15 AC, FT >20 AC, EP >8 features, PC >12 epics; BUG/TEST >15 AC, CR >20 AC. **Full level definitions, placement challenges, all overload red flags, and the BUG/CR priority scale (§3.6.2) → `03_AI Protocol/wbs-and-audit.md`.** On any misplacement/overload, report the objects + distinct concerns + a proposed restructure, and wait for approval before touching yaml.

### 3.7 Acceptance criteria — first-class objects

AC are full YAML objects (`type: AC`), stored flat under top-level `acceptance_criteria:` (not in the parent/child tree); the host's `acceptance_criteria` field stays `null` (legacy, retired). Every AC FULFILLS ≥1 US/FT — its permanent home (GR 18); BUG/CR/TEST links are additive. Status/result coupling (Filum auto-syncs the pair and cascades): `null`/DRAFT → `null`/OPEN → `READY_FOR_TEST`/SOLVED → `PASS`/CLOSED, with `FAIL`/OPEN on regression. Verdict-processing (§5.2.3/§5.2.4): pass → write `result: PASS`; fail → `result: FAIL`; untested → leave `null`. **Full rules, authoring YAML skeleton, the coupling table, counting/cross-ref rules, and the §3.8.6 body format → `03_AI Protocol/acceptance-criteria.md`.**

### 3.8 Body structure templates

Each `body` follows its type template; (required) sections must be present before the object leaves DRAFT; the host's `acceptance_criteria` field stays `null` everywhere (§3.7); AC live in AC objects via FULFILLED_BY. **Full skeletons + examples are externalized — MANDATORY: before authoring/editing a body, read the matching file in `03_AI Protocol/`:**
- requirement objects (PC / EP / FT / US) + feature-level AC (§3.8.1) + error-state AC (§3.8.2) → **`requirement-body-templates.md`**
- defect objects (BUG §3.8.3 / CR §3.8.4 / TEST §3.8.5) → **`defect-body-templates.md`**
- AC body template + format rules (§3.8.6) → **`acceptance-criteria.md`**

Required sections + AC obligations per type (the rules; skeletons in the files above):

- **PROJECT_CHARTER**: Project Vision, Strategic Goals, Epic Navigation Flows (once epics exist), Out of scope, Reference documents. No AC / no FULFILLED_BY→AC (AC→PC rejected, CR-260504-1747-001). Exactly one PC/project.
- **EPIC**: Feature Navigation Flows, Out of scope, Reference documents. No AC / no FULFILLED_BY→AC (AC→EPIC rejected).
- **FEATURE**: Wireframes (once design runs), Body, Out of scope, Reference documents; **≥1 FULFILLED_BY→AC** for cross-story integration + regression guard (§3.8.1; must not duplicate child-story AC).
- **USER_STORY**: scope paragraph + "Data model fields touched" + "Spec reference"; complete 3-segment `story_statement`; **≥1 FULFILLED_BY→AC**, incl. **≥1 error-state AC** if interactive (§3.8.2).
- **BUG** (§3.8.3): Defect Summary, Affected Requirements (= its CONFIRMS, ≥1), Technical Approach; **≥1 FULFILLED_BY→AC**, each also FULFILLS the affected US/FT (home, GR 18); new behaviour → re-triage to CR (§5.2.1).
- **CR** (§3.8.4): Change Summary, Affected Requirement Objects (= its CONFIRMS, ≥1), Design Changes, Data Model Changes, Supersede/Versioning, Scope Impact (use "(none)", never omit a heading); **≥1 FULFILLED_BY→AC**, each also FULFILLS ≥1 US/FT (GR 18).
- **TEST** (§3.8.5): Test Session (target ID + date minimum), Steps Performed, Expected vs Actual; **≥1 FULFILLED_BY→AC**; per-AC verdict = `AC.result` PASS/FAIL (human, or Claude mirroring per GR 13(b)); `TEST.result` computed by Filum, never authored (§3.3).
- **AC** (§3.8.6): `title` = the AC sentence; body MUST have BOTH `## Description` and `## Test Instructions` populated (never headings-only). **Test Instructions = markdown numbered list with a blank line before `1.` and between every step, one action per step, serialized as YAML `body: |` block-literal** (single-quoted scalar silently collapses it to one paragraph). **GUI-testable only** (no DB/yaml/server-log/devtools/API/back-end assertions); meaningful, no filler/duplicates (§3.4 dedup); ≥1 FULFILLS incl. ≥1 US/FT (home, GR 18).

## 4. Workflows

### 4.1 Session Start

```
1. Run WBS Health Audit (4.6) — brief mode
2. Proceed with user request
```

### 4.2 Export Review

```
1. Read project-delta.yaml BEFORE any data yaml
2. Present structured summary across all object types
   (EP/FT/US AND BUG/CR/TEST AND AC): Created / Edited / Status changes /
   Cancelled / Reinstated / Links / Relations (CONFIRMS and FULFILLS pairs
   included; per-AC result writes are surfaced under "AC verdicts").
3. Ask: "Act on any of these, or proceed with something else?"
4. Wait for explicit direction
5. If CANCELLED objects → Cancellation handling (4.4)
6. If SUPERSEDES on a new draft → Versioning handling (4.5)
7. If orphan TESTs (no CONFIRMS link) with result = FAIL or PARTIAL
   → flag for §5.2.1 triage. Orphan TESTs with result = PASS are
   reported as data hygiene issues (no auto-action).
   Also surface orphan AC (no FULFILLS link) as data hygiene flags —
   they cannot leave DRAFT until linked to a host.
8. Set project-sync.yaml { export_status: reviewed } — AFTER all subflows complete
```

### 4.3 Import Protocol

**Every workflow that writes any yaml file — requirements, status changes, content edits, link updates, BUG/CR/TEST authoring, CONFIRMS relations — ends here without exception.**

```
1. Edit yaml files freely, any order
2. Verify every file has its envelope, all objects have required fields,
   and yaml is syntactically correct — run a mandatory parse check on
   every data yaml file that was touched in this import cycle:
     python3 -c "import yaml, sys; yaml.safe_load(open(sys.argv[1]).read()); print('OK')" <file>
   If any file fails, fix it before proceeding. Do NOT set status: import
   on a broken yaml — Filum will silently skip or corrupt the import.
3. Set project-sync.yaml { status: import }  ← LAST WRITE, always, no exceptions
4. Do not touch any yaml until status resets to "ready"
```

### 4.4 Cancellation handling

```
1. Stop work on the cancelled object
2. Code impact assessment: (a) nothing to remove, (b) standalone removal,
   (c) entangled removal
3. Report outcome + what will be affected → wait for user approval
4. Execute → Import (4.3)
```

### 4.5 Versioning handling

Triggered when delta shows a new DRAFT with a SUPERSEDES relation (human already chose to version).

```
1. Read new object's body for Revision Notes
2. If none → diff against predecessor via SUPERSEDED_BY
3. Assess: (a) absorb into current dev, (b) full redevelopment
4. Report outcome → confirm path forward
5. If yaml touched → Import (4.3)
```

### 4.6 WBS Health Audit

Triggered automatically at Session Start (§4.1, brief/silent — surface a 1-line summary only if findings exist) and on any user request to review/assess the WBS (full report). Runs against draft/active/closed (skip cancelled); counts use live (non-cancelled) AC objects. **Full per-type flag list, the report buckets (a–h: overloaded, empty shells, template gaps, cross-cutting, level misplacement, orphan TESTs, orphan AC, homeless AC), and the proposed-action catalog → `03_AI Protocol/wbs-and-audit.md`.** Wait for user direction before touching any yaml.

## 5. Processes Rules

All processes start with Session Start (4.1). All yaml writes end with Import (4.3). Every edit to an existing object requires stating {id, title, exact change} and waiting for user approval — exception: individual edits within an approved change request scope (§5.2.2) need no separate approval. These always apply and are not repeated below.

**Object citation rule:** an object's ID alone is sufficient anywhere; `{ID} — {title}` is optional for clarity.

### 5.1 Guidelines

Run in order: Requirements → Design → Development. Do not jump ahead (no wireframes before requirements are stable; no code before design is done or explicitly skipped).

#### 5.1.1 Requirements

```
1. If user brings structured input → draft it directly
   If vague → ask targeted questions to fill the Epic/Feature/US hierarchy
2. Validate WBS placement AND overload (GR 8, §3.6) as you draft
3. Status rule (file destination):
   - OPEN  → project-active.yaml  ← default for Claude-authored, fully-specified objects
             (complete title, body, AC, story_statement)
   - DRAFT → project-draft.yaml   ← ONLY for incomplete sketches the user wants to review
             first. Never leave a complete Claude-authored object in DRAFT.
4. Propagate consistency downward after any change (GR 7)
5. Update DATA_MODEL.md / AUDIT_MODEL.md if entities/fields changed
   Flag breaking changes and wait for acknowledgment before import
```

**Quality bar — all must pass before an object leaves DRAFT:**
- Every US: `story_statement` (all three segments) + ≥1 `FULFILLED_BY → AC`; body follows §3.8 (scope + "Data model fields touched" + "Spec reference"); interactive US has ≥1 error-state AC (§3.8.2).
- Every feature: ≥1 `FULFILLED_BY → AC` for cross-story integration (§3.8.1).
- Every feature and epic body: "Out of scope" + "Reference documents".
- Every AC: ≥1 FULFILLS including ≥1 US/FT (home, GR 18 — no homeless AC); BOTH §3.8.6 sections populated (not headings-only); GUI-testable and meaningful (§3.8.6 content rules) — Test Instructions performable and visually confirmable in the Filum GUI, no back-end/DB/yaml/log/devtools/API assertions; title a clear specific assertion; Description states goal + outcome.
- Every host's `acceptance_criteria` field is `null` (§3.7).
- No story >15 AC; no feature >20 AC; no body mixing >1 distinct concern.

#### 5.1.2 Design (Wireframes)

Only when the user requests it and requirements are stable. **Quality bar:** clear labels, all screens accounted for, visually consistent across levels.

**Folder:**
```
03_design/01_wireframes/
├── {all PNGs}
├── epic level/         ← HTML per flow + all_flows.html
└── feature level/
    ├── {feature}.html
    └── journey level/
        └── {ft}_{us}.html
```

**Rules:**
- PNGs = what the user sees, no annotations. HTML boards = PNGs assembled into journeys; annotations only here.
- Image naming: `{CodeID}_{short_title}.png`; variants `S05.1_...`. HTML captions match Code ID + short title; homepage always captioned "homepage."

**Steps:**
```
1. Epic level: one flow per feature across all entry points (system-wide, not per-epic).
   1 HTML per flow + all_flows.html.
2. Feature level: one PNG per screen state (at wireframes root). 1 HTML per journey,
   1 HTML per feature grouping journeys.
3. Consistency pass (bottom-up): journey board is truth → feature → epic.
   If traces to a requirement conflict → STOP, flag to user.
4. After any change, propagate to boards referencing the changed screen.
```

#### 5.1.3 Development

Requirements are read-only during development. Modify only code — never requirements, designs, or data model.

```
1. Read project-active.yaml — review ALL OPEN objects (incl. orphans) to understand
   full scope, then work as the user directs or sequentially
2. Per requirement (or as directed):
   a. Read body + every AC FULFILLED_BY it (via relations) + DATA_MODEL.md.
      Frontend pre-flight (§6.7) is mandatory if the change touches any
      02_code/filum/frontend/ file (also read UI_SPEC.md §19 + the design-system
      files to be modified) BEFORE writing code.
   b. Write code in 02_code/
   c. Smoke test per requirement: builds, entrypoints work
3. After all code is written — SIT as final integration pass:
   a. Test against each AC FULFILLED_BY every OPEN requirement
   b. Fix failures, loop. After 3 consecutive fails on same test → skip it
   c. Note unresolved failures in the requirement body or chat (NEVER author
      03_bug fixing/*.md — surface defects via §5.2, which creates BUG/CR objects)
4. Report SIT results + failure list. Hand over for UAT.
   Per requirement where SIT passed: OPEN → SOLVED. Per GR 13, do NOT write
   AC.result/AC.status here — UAT sets per-AC results on the next TEST cycle.
   After each SOLVED write, apply GR 10 upward propagation (parent → … → epic).
```

**UAT (user runs):** wait for feedback; defects enter the §5.2 loop.

**Closure:** Filum cascades AC closure to hosts automatically (DATA_MODEL.md §3.6). When all AC FULFILLED_BY a host are CLOSED (`result = PASS`), the host transitions to CLOSED in the same transaction. Claude's role is to write per-AC verdicts in §5.2.3 step 2 / §5.2.4 step 2; Filum handles the cascade up the FULFILLED_BY and parent/child chains (GR 10).

### 5.2 Processes

A loop that repeats until every requirement object has all its FULFILLED_BY AC in `status = CLOSED` / `result = PASS` (Filum then cascades the requirement to CLOSED — §5.1.3 Closure).

**AC mechanics (throughout §5.2):** to pass an AC write `result: PASS` (Filum auto-couples CLOSED); to fail write `result: FAIL` (auto-couples OPEN). Filum then cascades closure/regression to every FULFILLS host. Claude never manually closes hosts whose AC are all PASS.

```
Loop entry points (only these two):
  ├─ User chat message describing a defect
  └─ Imported ORPHAN TEST (no CONFIRMS link) with result = FAIL or PARTIAL

Loop:
  Triage (§5.2.1) → BUG path OR CR path
    ├─ CR: §5.2.2 (CR authored in OPEN per GR 16) → human review in Filum
    │      (override priority/content; invoke §5.2.4 by CR ID) → §5.2.4 fix loop (no bundle mode)
    └─ BUG: §5.2.2 (BUG authored in OPEN per GR 16) → human review in Filum
            → §5.2.3 fix loop (invoked by user, single or bundle mode)
         ↻ Subsequent TESTs assigned to a BUG/CR are PASSIVE — they only augment
           information; they never trigger Claude. The next fix cycle (§5.2.3 / §5.2.4,
           user-invoked) reads the BUG/CR + latest non-cancelled TEST and processes
           the verdict per §5.2.3 step 2 / §5.2.4 step 2.
```

**Acts vs passive:**
- **Acts:** chat defect description; orphan TEST (no CONFIRMS); user invocation of §5.2.3 (single/bundle) or §5.2.4; BUG/CR status transitions (e.g. human DRAFT→OPEN in Filum, which unlocks the fix gate).
- **Passive:** assigned (CONFIRMS-linked) TESTs — they merely complete information, surfaced in §4.2.

**One defect per cycle.** A cycle starts from one of the two entry triggers OR a user invocation of §5.2.3 (existing BUG) / §5.2.4 (existing CR). The first orphan TEST under a triage path creates the BUG/CR; later TESTs sit passively until the user invokes the next fix cycle.

**Import per defect type:**
- **CR:** one import at the end of §5.2.2; then §5.2.4 runs one import per dev piece + one on closure (step 8). No bundle mode.
- **BUG:** two imports per loop iteration — end of §5.2.2 (after authoring + setting CONFIRMS-linked requirements OPEN) and end of §5.2.3 (after verdict-processing + fix). No Import at intermediate steps within §5.2.3.

#### 5.2.1 UAT Feedback / Triage

**Entry triggers — no exceptions:** (a) any chat message describing a defect (formal report, screenshot, casual remark, mid-session observation); (b) an imported orphan TEST (no CONFIRMS) with `result = FAIL` or `PARTIAL`. No framing bypasses triage — "fix this" / "this is broken" is permission to triage, not to write code.

**Orphan TEST with `result = PASS`:** flag as data hygiene; do NOT auto-create a BUG/CR; let the user reclassify in Filum.

**Development assumption:** when the user gives UAT feedback referencing a BUG/CR, assume Claude Code already implemented it in a separate session. Never ask whether dev was done or flag it as missing — proceed directly to triage.

```
1. Defect signal received:
   a. User chat description, OR
   b. Orphan TEST — read its body, AC state, result; treat as the defect description.

2. Triage: recap what was reported, ask clarification if needed (wait for answers),
   then determine BUG or CR. Declare the verdict explicitly:
   "Verdict: BUG." / "Verdict: CR." / (mixed) list which elements are which.

3. BUG path: ask permission → §5.2.2 (author the BUG yaml + import ONLY).
   ⚠ "Proceed" = author the BUG body and stop. No code until the §5.2.3 gate opens.

4. CR path:
   a. Assess impact on WBS structure/relations (challenge placement AND overload,
      GR 8, §3.6), requirements, designs, data model.
   b. If any object would pass an overload threshold (§3.6), include a split proposal.
   c. Share the full picture: WBS elements to add/rename/update/cancel/restructure/split,
      links to change, designs to remove/update/create.
   d. Ask permission → §5.2.2 for execution.
```

**Orphan-TEST triage outputs (handed to §5.2.2):** (1) verdict BUG/CR per step 2; (2) the requirement(s) the new BUG/CR should CONFIRMS (best-guessed by mapping unchecked AC + TEST narrative back to the requirement set); (3) a CONFIRMS relation will be added from the TEST to the new BUG/CR (so it is no longer orphan); (4) the new BUG/CR is created OPEN in `project-active.yaml` with Claude-assigned priority (§3.6.2, never null); human can override post-import; (5) the TEST stays in its current status (typically CLOSED, result FAIL/PARTIAL) — Claude does NOT change `TEST.result`.

#### 5.2.2 Change Propagation & Object Authoring

When triage produced a verdict, propagate (CR path only) and author the test-family object directly in YAML.

**AC homing (GR 18) — both paths, mandatory.** Every AC authored for the BUG/CR also FULFILLS ≥1 US/FT (home). Resolve before import: attach to an existing US/FT if it fits (respecting §3.6/§3.8); else the CR adds/extends a US/FT (step 1), and a BUG needing an AC for new behaviour re-triages to CR (§5.2.1). Never write/import an AC homed only on the BUG/CR.

**CR path (only when CR approved in §5.2.1):**

```
1. Update WBS requirement objects as approved (add/rename/update/cancel/restructure)
2. Update WBS parent-child links where affected
3. Update DATA_MODEL.md / AUDIT_MODEL.md if entities/fields changed.
   Flag breaking changes to the user before proceeding.
4. Consistency check across requirements → data model
5. Author the CR object in project-active.yaml in OPEN (GR 16) with Claude-assigned
   priority (§3.6.2, never null). Body follows §3.8.4. Human can override post-import.
6. Add CONFIRMS relations from the CR → each affected requirement (paired CONFIRMED_BY).
```

**BUG path:**

```
1. Author the BUG object in project-active.yaml in OPEN (GR 16) with Claude-assigned
   priority (§3.6.2, never null). Body follows §3.8.3.
2. Add CONFIRMS relations from BUG → each affected requirement (paired CONFIRMED_BY).
3. If triggered by an orphan TEST: ensure the TEST → BUG CONFIRMS link (+ paired
   CONFIRMED_BY on the BUG) is in place.
```

**No `.md` reports anywhere** — all defect content lives in BUG/CR/TEST bodies; never write `BUG-*.md`/`CR-*.md` or recreate `03_bug fixing/` / `05_change request/`.

**Status transition (linked requirements):** after authoring, move every CONFIRMS-linked requirement to OPEN (regardless of current status), then Import (4.3).

**On completion — mandatory closing statement, then STOP:**
- **BUG:** state ID + title + priority and confirm "BUG created in OPEN with priority {VALUE} (GR 16) — human may override in Filum." ⛔ Do not analyse the fix, touch `02_code/`, or reason toward a solution. The §5.2.3 gate opens only on explicit user invocation ("fix {BUG-ID}", GR 1).
- **CR:** state ID + title + priority and confirm "CR created in OPEN with priority {VALUE} (GR 16) — human may override in Filum." ⛔ Enter §5.2.4 only when the user references the CR by ID and asks to proceed ("fix {CR-ID}", GR 1).

#### 5.2.3 Bug Fix (BUGs only)

CR objects skip this section (their code lands via §5.2.4).

**Gate** — do not enter until either the user references a BUG ID and asks to proceed (single mode — "fix {BUG-ID}" satisfies) OR invokes bundle mode. Generating the BUG in §5.2.2 does NOT grant fix permission; writing code before the gate violates GR 1.

**Empty-shell pre-flight.** Before reading code, verify the BUG is not an empty shell (§4.6): (a) ≥1 CONFIRMS to a requirement, (b) ≥1 FULFILLED_BY → AC, (c) §3.8.3 body sections populated. If any missing, HALT, surface the deficit, propose completions via GR 13(a), wait for approval. Applies whether Claude- or human-authored (Filum save-blocks can be bypassed either way). GR 12 does not override this — the BUG body is the in-scope object.

**Inputs (single BUG):** the BUG body (§3.8.3) + every AC FULFILLED_BY it; each CONFIRMS-linked requirement (body + its AC); the **latest non-cancelled TEST** linked via CONFIRMED_BY (most recent `created_at`, not CANCELLED) — it scopes the fix to AC still failing (`result = FAIL` or `null`).

**Latest-TEST snapshot rule:** capture the latest non-cancelled TEST at cycle start; TESTs imported mid-cycle are consumed next cycle.

**Single mode — one cycle:**

```
1. Read inputs (BUG + its AC; CONFIRMS-linked requirements + their AC; latest
   non-cancelled TEST + its per-AC results). Frontend pre-flight (§6.7) mandatory
   if any 02_code/filum/frontend/** file is in scope.

2. Verdict-processing — apply the latest TEST's per-AC verdicts (human-written
   PASS/FAIL in Filum). Skip on the very first cycle (no TEST yet).
   - All AC PASS: Filum has already cascaded each AC and the BUG to CLOSED — verify
     in the export; confirm requirement(s) CLOSED if all their AC closed. No Import
     needed if Claude wrote nothing. Exit §5.2.3 — fix verified.
   - Mixed (TEST.result PARTIAL): BUG stays SOLVED; PASS AC already CLOSED.
     Continue to step 3 — remaining FAIL/null AC define the scope.
   - All FAIL (TEST.result FAIL): BUG stays SOLVED. Continue to step 3 —
     every AC under the BUG is in scope.

3. Fix the code in 02_code/ per the BUG's Technical Approach + the AC still in
   result = FAIL/null (or the full BUG AC set on the first cycle).

4. Smoke test + SIT against each AC FULFILLED_BY the BUG not yet PASS. Fix, loop.
   After 3 consecutive fails on the same AC → skip and note its id in the BUG body.

5. Ensure BUG status = SOLVED (OPEN → SOLVED on the first cycle; stays SOLVED later).
   Per GR 13, do NOT write AC.result/AC.status — leave every AC at its current
   verdict; the next TEST (step 2) is the only path that changes them. Import (4.3).

6. Report: what was fixed (files/functions), SIT results per AC id. Hand over for UAT.
   The next cycle is user-invoked — TEST arrival is passive, never an auto-trigger.
```

**Bundle mode (multiple BUGs in sequence — BUG-only; CRs always run single via §5.2.4):**

```
1. List every BUG matching the request in OPEN, with priority + CONFIRMS targets
   (CRs excluded). Conflict scan (mandatory, before grouping): detect any BUG pair
   sharing a CONFIRMS-linked requirement → halt, list each conflicting pair + the
   shared requirement(s), ask which conflicting part to discard (cancel one side or
   supersede to narrow scope) until no two BUGs touch the same requirement scope.
   After resolution, propose grouping options:
     a. All BUGs at priority X
     b. All BUGs OPEN, regardless of priority
2. User picks a grouping.
3. Order by priority desc (URGENT > HIGH > MED > LOW), then created_at asc.
4. For each BUG in order: run §5.2.3 single mode steps 1–5 (use the latest-TEST
   snapshot captured at session start). Uninterrupted — no UAT between BUGs.
5. After the whole bundle, hand over to UAT in one batch (user retests via new TESTs).
6. Imports per the per-defect-type rules (one import per BUG cycle); bundle does
   NOT collapse imports.
7. PASS/PARTIAL/FAIL verdicts are processed per step 2 on the next §5.2.3 invocation.
```

**Exit condition:** every requirement in `project-active.yaml` has all its FULFILLED_BY AC CLOSED / PASS (Filum cascades the requirement to CLOSED).

#### 5.2.4 Change Request Fix (CR only)

BUGs use §5.2.3. CRs do NOT pass through §5.1.3 — their dev runs here with user testing between pieces.

**Gate** — do not enter until the user references a CR by ID and asks to proceed ("fix {CR-ID}" satisfies). CRs are NOT eligible for bundle mode.

**Empty-shell pre-flight.** Before reading code, verify the CR is not an empty shell (§4.6): (a) ≥1 CONFIRMS, (b) ≥1 FULFILLED_BY → AC, (c) §3.8.4 body sections populated. If any missing, HALT, surface the deficit, propose completions via GR 13(a), wait for approval. Applies whether Claude- or human-authored. GR 12 does not override this — the CR body is the in-scope object.

**Inputs:** the CR body (§3.8.4) + every AC FULFILLED_BY it; each CONFIRMS-linked requirement (body, its AC, wireframes, referenced DATA_MODEL.md/AUDIT_MODEL.md sections); the **latest non-cancelled TEST** via CONFIRMED_BY, if any (its human-written per-AC results ARE the verdict — Claude does not re-interpret).

**Latest-TEST snapshot rule:** capture at cycle start; mid-cycle TESTs consumed next cycle.

```
1. Read inputs. Latest non-cancelled TEST exists → step 2, else → step 3.
   Frontend pre-flight (§6.7) mandatory if any 02_code/filum/frontend/** file is in scope.

2. Apply latest-TEST verdict (skip on the very first cycle):
   - Each AC PASS is already CLOSED via Filum's cascade — verify and continue.
   - Each AC FAIL stays failing; its host reverse-cascaded to OPEN — addressed in step 4.
   - Apply any chat instructions or TEST-body notes.

3. Mid-fix AC adjustment exception (to §5.1.3 read-only): allowed when an AC is
   broken (typo, contradiction, infeasibility) OR the user requests a scope change
   in chat or the latest TEST body. State the edit + propagation targets before
   writing. Propagate to: the AC (title/body), CR body, BUG bodies, EP/FT/US bodies,
   TEST bodies, DATA_MODEL.md, AUDIT_MODEL.md, wireframes. NEVER CLAUDE.md.

4. Determine remaining AC scope: every AC FULFILLED_BY the CR still in result =
   FAIL/null. If empty → step 7. Else propose a dev breakdown ONLY when the
   remaining scope cannot be safely delivered in one cycle (else go straight to
   step 5 with the full scope as a single piece). When proposing: feature-by-feature
   (finer if needed); list pieces with the AC ids each covers, in dev order; wait
   for approval.

5. For each piece in order:
   a. Set CR → OPEN if not already. Develop in 02_code/ against the piece's AC subset.
   b. Smoke test (builds, entrypoints).
   c. Set CR → SOLVED. Per GR 13, do NOT write AC.result/AC.status — leave them; the
      next TEST (step 2) changes them. Import (4.3).
   d. Hand the piece to the user. Wait for chat feedback OR a new TEST.
   e. Apply feedback at AC level:
        - AC passing (chat or per-AC result = PASS) → already CLOSED via cascade; no action.
        - AC failing (chat or per-AC result = FAIL) → stays OPEN+FAIL; set CR → OPEN;
          iterate (back to 5a) for the failing subset only.
        After 3 consecutive fails on the same AC → skip, note its id in the CR body.
      Import (4.3) after each AC.result/status write Claude makes directly.
   f. Move to the next piece only after the current piece's AC are all CLOSED or skipped.

6. After all pieces shipped and all CR-linked AC CLOSED or skipped: CR stays SOLVED.
   Hand over for full UAT (regression check across the whole CR scope).

7. Closing chat report (minimal, chat-only, no .md):
   - {CR_ID — title}
   - Pieces shipped (1 line each, AC ids)
   - AC skipped after the 3-fail rule (if any)
   - "Ready for full UAT — confirm to close."

8. On full-UAT PASS: CR → CLOSED (Filum has already CLOSED CONFIRMS-linked
   requirements if all their AC are CLOSED; verify + apply GR 10 only if Filum
   has not). Import (4.3).
   On full-UAT FAIL: the new TEST's per-AC FAIL verdicts (or chat) trigger Filum's
   reverse cascade — AC flip to OPEN+FAIL, hosts reopen. Set CR → OPEN. Back to
   step 4 with the new failing subset.
```

**Status lifecycle:** OPEN = ready for dev (re-entered on any failure); SOLVED = piece(s) shipped, awaiting test; CLOSED = full UAT confirmed PASS. **Exit condition:** CR = CLOSED, or the user halts the loop.

---

## 6. Frontend Design System

Governs every change to `02_code/filum/frontend/**`. **Full detail (atomic hierarchy/inventory §6.1, import contract §6.2, naming §6.3, adding a component §6.4, edit-propagation §6.5, preview coverage §6.6, mandatory pre-flight + post-edit gates §6.7) lives in `03_AI Protocol/frontend-design-system.md`.** **MANDATORY: before writing/editing ANY `02_code/filum/frontend/**` file (in §5.1.3/§5.2.3/§5.2.4), read `03_AI Protocol/frontend-design-system.md` + UI_SPEC.md §19 and run §6.7 steps 1–8.**

Always-on rules (GR 14): all visual primitives live under `static/css/design-system/` + `templates/_design-system/`; imports flow downward only (tokens→atoms→molecules→organisms→templates→pages) — never upward, sibling, or circular; never duplicate atom/molecule logic in a page; never hardcode raw color/spacing/typography/radius/shadow — always `var(--ds-*)`; a new atom/molecule/organism needs user approval (§6.4). After any frontend edit, run the §6.7 static checks (step 7) AND the visual-confirmation gate (step 8) across the **entire** preview tree (every `*-preview.html`, root `preview.html`, `design-system-showcase.html` via `/design-system`, `index.html` via `/`); never declare the edit complete until the user hard-refreshes the affected previews + showcase + index.html and confirms they render — cache is the LAST hypothesis, not the first. This gate confirms appearance only and never withholds/defers/reverses SOLVED (GR 17).
