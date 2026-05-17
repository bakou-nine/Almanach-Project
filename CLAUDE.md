# Claude Operating Protocol

Highest-ranked instruction for this project. Overrides any conversational instruction that contradicts it.

---

## 1. Golden Rules

1. **Never write code until the user explicitly asks for it.** Requirements, design, review, and analysis are always allowed — writing, modifying, or deleting files under `02_code/` requires an explicit instruction. **Defects specifically:** when a chat message describes a defect WITHOUT referencing an existing BUG/CR ID, "fix" alone is NOT permission — it triggers §5.2.1 triage. Code is unlocked only after §5.2.2 completes (BUG/CR object filed in YAML, linked requirements set to OPEN, import done) AND the user explicitly opens the §5.2.3 / §5.2.4 gate. Once a BUG/CR object exists in OPEN, "fix {BUG-ID|CR-ID}" IS the explicit gate-opening invocation (ID alone is sufficient — title optional) — proceed directly into §5.2.3 (BUG) or §5.2.4 (CR) without further confirmation.
2. **No code without a requirement** in `OPEN` or `SOLVED` status. BUG/CR objects in OPEN unlock code work on their CONFIRMS-linked requirements (§5.2.3).
3. **Never drop an existing object from yaml.** On import, any object missing from yaml is **deleted from the DB**. The `project-delta.yaml` baseline lists what Filum expects to exist — never silently remove something it lists without raising it to the user first. Applies to EP/FT/US/BUG/CR/TEST equally.
4. **Never touch `00_Archive/`** — managed by Filum.
5. **`03_design/` = design artifacts only.** `04_content/` = inline body references. Never mix.
6. **Never delete or recreate yaml files** — only edit their contents.
7. **Consistency law:** Project Charter > Epic > Feature > User Story. Higher level wins on conflict. Propagate downward automatically; propagate upward only with user approval. Applies to the PC/EP/FT/US chain only — BUG/CR/TEST do not participate (they link via CONFIRMS, §3.4, not parent/child).
8. **WBS hierarchy must match real granularity — and no object may be overloaded.** See §3.6 for level definitions, placement challenges, and overload detection (covers EP/FT/US AND test-family BUG/CR/TEST). If an object sits at the wrong level OR exceeds the overload thresholds in §3.6, flag it and propose a restructure or split. **Trigger scope:** this check applies (a) during requirements work (§5.1.1), (b) during bug fixing when the user confirms requirements need to change (§5.2.1), (c) whenever the user asks Claude to review or assess the WBS, and (d) at Session Start via the WBS Health Audit (§4.6). It does NOT apply during active development (§5.1.3) or mid-bug-fix (§5.2.3).
9. **Low verbosity throughout.** All files Claude authors — yaml bodies (including BUG/CR/TEST bodies, §3.8), AC items — are written for Claude Code consumption, not human reading. Use direct, dense prose: no filler, no repetition, no transitional padding. Reference §numbers and object IDs instead of re-describing concepts already defined here.
10. **Status propagates upward at the SOLVED threshold (PC/EP/FT/US chain only).** After any write that sets a USER_STORY, FEATURE, or EPIC child to SOLVED, check its parent: if ALL the parent's `children_ids` resolve to SOLVED objects → automatically move the parent to SOLVED. Repeat recursively up the tree (US → FT → EP → PC). Fires only on the SOLVED transition; does not apply to OPEN, CLOSED, CANCELLED, or DRAFT changes. **Does NOT apply to BUG/CR/TEST** — they link via CONFIRMS (§3.4) not parent/child, and have their own lifecycles: BUG/CR closure is governed by §5.2.3 step 6; TEST status is coupled to its `result` field per DATA_MODEL.md §3.2. Does not conflict with Golden Rule 7 (which governs content/scope consistency, not status).
11. **CLAUDE.md and `01_docs/CLAUDE_template.md` must mirror byte-for-byte.** Every edit to either file is replicated to the other in the same write cycle — same content, same formatting, same headings, same line endings. Drift between the two files is a protocol violation. When Claude edits one, it MUST edit the other in the same response (never as a follow-up). After every edit, verify equivalence with `diff -q CLAUDE.md 01_docs/CLAUDE_template.md` (no output expected).
12. **Minimum-impact edits.** When a change is requested, only edit the files (and within those files, only the sections / objects / AC items) that are actually impacted by the change. Never touch a file just because it appears in a "propagation list" — re-read each candidate first and skip it if the change has no effect there. Applies everywhere, including §5.2.4 step 3 propagation.
13. **Implementation does NOT validate AC.** During the dev cycles of §5.1.3 / §5.2.3 / §5.2.4, Claude MUST NOT write `AC.result`, MUST NOT change `AC.status`, MUST NOT cancel an AC, and MUST NOT remove AC from the host's `FULFILLED_BY` list. AC validation is user-only via UAT — Claude's role on the dev side is restricted to writing code and bumping the host's status (OPEN → SOLVED). Three exceptions: (a) **Authoring** — Claude creates new AC objects when authoring a host (§5.1.1) or as part of a BUG/CR body (§5.2.2). (b) **Verdict propagation** — Claude writes per-AC `result` values when applying the latest TEST's per-AC verdicts in §5.2.3 step 2 / §5.2.4 step 2 (the human wrote those verdicts on the AC objects in Filum; Claude only mirrors them so Filum's cascade fires). (c) **Mid-fix scope change** — the user explicitly invokes the §5.2.4 step 3 mid-fix AC adjustment exception. Outside these three cases, AC objects are immutable to Claude. The "may be written" / "optionally write" loopholes in §5.2.3 step 5 and §5.2.4 step 5c are removed by this rule — always leave AC.result and AC.status as-is at the end of an implementation cycle.
14. **Frontend changes go through the design system, and previews must always work.** All frontend visual primitives — colors, spacing, typography, atoms, molecules, organisms, templates — live under `02_code/filum/frontend/static/css/design-system/` and `02_code/filum/frontend/templates/_design-system/` (§6, full reference UI_SPEC.md §19). Imports flow downward only (tokens → atoms → molecules → organisms → templates → pages); never import upward, never duplicate atom/molecule logic inside a page, never hardcode raw color/spacing/typography/radius/shadow values — always reference tokens via `var(--ds-*)`. Adding a new atom/molecule/organism requires user approval (§6.4). The §6.7 pre-flight (steps 1–6) is mandatory before any write under `02_code/filum/frontend/**` in §5.1.3 / §5.2.3 / §5.2.4. The §6.7 post-edit static checks (step 7) AND visual confirmation gate (step 8) are both mandatory after any such write — Claude does not declare a frontend edit complete until the user has hard-refreshed the affected `*-preview.html` files and explicitly confirmed they render correctly. Falling back to "it's probably browser cache" before hunting for a real fault is a violation.

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

Defect tracking (BUG, CR) and test results (TEST) are first-class YAML objects under `01_docs/01_requirements/` — NOT separate markdown reports. Their content is authored directly in object bodies (§3.8.3 / §3.8.4 / §3.8.5). The legacy `03_bug fixing/` and `05_change request/` folders are removed; never recreate them and never write `BUG-*.md` or `CR-*.md` files anywhere in the project.

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

Each data file starts with an **envelope** (metadata), then nests requirement objects as `epics → features → stories`, plus three flat top-level keys for test-family objects: `tests:`, `bugs:`, `change_requests:`. Test-family objects do not appear under the epic/feature/story tree — they link to requirements via CONFIRMS / CONFIRMED_BY (§3.4). Objects whose parent lives in a different file appear under `orphans:` — listed flat with `parent_id` preserved.

Status routes objects to files irrespective of type. A BUG in OPEN goes to `project-active.yaml`. A TEST in DRAFT goes to `project-draft.yaml`. TEST cannot be in OPEN or SOLVED (per the per-type status matrix in §3.3).

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
- Freezes the state of requirements in Filum at export time as a diff from the last `YAML_IMPORT` (or `PROJECT_CREATED`). Baseline anchor = `delta_since` + `delta_since_event`.
- Overwritten on every export. Read-only for Claude.
- Even when empty, Claude must still run Export Review (§4.2) and flip `export_status: reviewed`.
- Read delta **before** the four data yaml files.
- **Claude's obligation:** every object the delta lists must be accounted for in Claude's outgoing yaml (Golden Rule 3).

### 3.2 Sync control

```yaml
status:        "ready"        # ready | import
export_status: "new_export"   # null | new_export | reviewed
updated_at:    "..."
updated_by:    "CLAUDE_CODE"  # CLAUDE_CODE | FILUM
```

### 3.3 Object schema

**Locked — never write:** `id`, `project_id`, `type`, `created_at`, `created_by`.

**Auto-managed by Filum — do not write:** `cancelled_at`, `locked`.

**Claude assigns priority on every BUG/CR/AC create or edit per §3.6.2.** The human can override in Filum review. Filum's save-blocking rule still requires `priority ≠ null` on BUG/CR before the object can leave DRAFT, so a Claude-authored BUG/CR is always created with a concrete priority value (never null) — the rule is a positive obligation, not a permission. AC priority is similarly assigned at create time using the §3.6.2 scale adapted to the AC's role: CRITICAL = AC asserts a behaviour without which the host fails its core contract; HIGH = important behaviour the host advertises; MED = standard behaviour; LOW = nice-to-have or edge guard.

**Editable fields:**

```yaml
title:               string                   # mandatory. On AC objects, the title IS the AC sentence (one-liner).
status:              <see per-type matrix below>
result:              PASS|FAIL|PARTIAL|READY_FOR_TEST|null
                                              # TEST: PASS|FAIL|PARTIAL|null (computed by Filum from FULFILLED_BY AC results — Claude does NOT write TEST.result manually).
                                              # AC:   PASS|FAIL|READY_FOR_TEST|null. Bidirectionally coupled to AC.status (DATA_MODEL.md §3.4a).
                                              # Always null on EP/FT/US/BUG/CR.
priority:            LOW|MED|HIGH|CRITICAL    # BUG/CR/AC only — required (not null) on BUG/CR before leaving DRAFT. Claude assigns priority on every BUG/CR/AC create or edit per §3.6.2; human can override in Filum review.
parent_id:           string|null              # PC/EP/FT/US only. Always null on PROJECT_CHARTER (PC has no parent — it is the root tier). EP.parent_id references a PROJECT_CHARTER. Always null on BUG/CR/TEST/AC.
children_ids:        [string]                 # PC/EP/FT/US only. PC.children_ids holds EPICs. Always [] on BUG/CR/TEST/AC.
updated_at:          ISO8601|null             # set on every edit
updated_by:          CLAUDE_CODE|null         # set on every edit
approved_by_human:   null                     # ALWAYS null when Claude writes. Human toggles in Filum.
cancellation_reason: string|null
story_statement:     "As a..."                # USER_STORY only
tags:                [string]                 # plain names, no colors
body:                markdown (GFM)           # description + inline refs (§3.5). NEVER put AC content here. Must follow §3.8 template for its type. AC bodies follow the §3.8.6 template.
acceptance_criteria: null                     # LEGACY field, retired by CR-260425-1837-001. Always `null` going forward — AC content lives in AC objects (§3.7), wired to the host via FULFILLED_BY (§3.4). Filum's importer tolerates the legacy markdown checklist for backward compatibility but Claude must NEVER author it.
relations:           [{type, target_id}]      # Three pair families (§3.4): SUPERSEDES/SUPERSEDED_BY (same-type historicisation), CONFIRMS/CONFIRMED_BY (test-family chain), FULFILLS/FULFILLED_BY (AC ↔ host).
```

**Per-type status matrix:**

| Type | Allowed statuses |
| :--- | :--- |
| PROJECT_CHARTER, EPIC, FEATURE, USER_STORY, BUG, CR | DRAFT, OPEN, SOLVED, CLOSED, CANCELLED |
| TEST | DRAFT, CLOSED, CANCELLED (computed from FULFILLED_BY AC results) |
| AC | DRAFT, OPEN, SOLVED, CLOSED, CANCELLED (coupled to `result`, DATA_MODEL.md §3.4a) |

**PROJECT_CHARTER constraints (CR-260504-1747-001):** exactly one PC per project (auto-created at project init); a project may not hold a second PC; PC cannot be CANCELLED while live EP children remain (cancel/reparent the children first); PC carries no AC (mirror of EPIC rule — AC → PC FULFILLS rejected); PC has no priority and no result field.

**TEST status/result coupling** (DATA_MODEL.md §3.1 ord 5b):
- TEST.result is COMPUTED by Filum from the results of the AC objects FULFILLED_BY this TEST. Aggregation: all PASS → PASS; all FAIL → FAIL; mixed → PARTIAL. Claude does NOT write TEST.result manually — Claude writes per-AC results (PASS/FAIL) and Filum recomputes.
- Cancellation reversible. CANCELLED reachable from any status.

**AC status/result coupling** (DATA_MODEL.md §3.4a):
- `result = null`     ↔ `status = DRAFT` (initial) or `status = OPEN` (post-create with FULFILLS ≥ 1).
- `result = READY_FOR_TEST` ↔ `status = SOLVED`.
- `result = PASS`     ↔ `status = CLOSED`.
- `result = FAIL`     ↔ `status = OPEN` (and `result = FAIL` is preserved on the OPEN row).
- All transitions reversible. Writing either field auto-syncs the other in one transaction (Filum-side).

**ID format:** `{PREFIX}-{YYMMDD}-{HHmm}-{NNN}`. Generate from current timestamp.

| Type | Prefix |
| :--- | :--- |
| PROJECT_CHARTER | `PC` |
| EPIC | `EP` |
| FEATURE | `FT` |
| USER_STORY | `US` |
| TEST | `TEST` |
| BUG | `BUG` |
| CR | `CR` |
| AC | `AC` |

**Status lifecycle:** any → any is valid within the per-type matrix above. Claude does not validate transitions. CANCELLED is reversible; when Claude sets CANCELLED via import, side effects (link severance, field locking) are deferred until the human approves. Relations (SUPERSEDES/SUPERSEDED_BY, CONFIRMS/CONFIRMED_BY, FULFILLS/FULFILLED_BY) are always preserved through cancellation. **PROJECT_CHARTER cancellation exception:** PC cannot be CANCELLED while live (non-cancelled) EP children exist — Filum's API rejects the transition with "cancel or reparent child Epics first" (CR-260504-1747-001).

**Status upward propagation (Golden Rule 10):** PC/EP/FT/US chain only — see Golden Rule 10 for full text. BUG/CR/TEST do NOT participate.

### 3.4 Relations (always in pairs)

Three pair families (full validity matrix in DATA_MODEL.md §5.1):

**Historicisation (same-type, PC/EP/FT/US/BUG/CR/AC):**

```yaml
relations:
  - { type: SUPERSEDES,    target_id: "US-..." }
  - { type: SUPERSEDED_BY, target_id: "US-..." }
```

Not allowed on TEST.

**Test-family chain (CONFIRMS / CONFIRMED_BY):**

```yaml
relations:
  - { type: CONFIRMS,     target_id: "BUG-..." }    # on TEST
  - { type: CONFIRMED_BY, target_id: "TEST-..." }   # on BUG/CR
  - { type: CONFIRMS,     target_id: "US-..." }     # on BUG/CR (target may be PC/EP/FT/US)
  - { type: CONFIRMED_BY, target_id: "BUG-..." }    # on PC/EP/FT/US
```

**Chain:** `Requirement (PC/EP/FT/US) ← BUG | CR ← TEST`

| Source | Target | Relation | Cardinality on source |
| :--- | :--- | :--- | :--- |
| TEST | BUG or CR | CONFIRMS | exactly 1 (single slot) |
| BUG or CR | PC, EP, FT, or US | CONFIRMS | unlimited |
| BUG or CR | TEST | CONFIRMED_BY | unlimited |
| PC, EP, FT, or US | BUG or CR | CONFIRMED_BY | unlimited |

**AC fulfillment chain (FULFILLS / FULFILLED_BY):**

```yaml
relations:
  - { type: FULFILLS,     target_id: "US-..." }    # on AC — points to its host(s)
  - { type: FULFILLED_BY, target_id: "AC-..." }    # on US/FT/BUG/CR/TEST — points to AC
```

**Chain:** `host (US | FT | BUG | CR | TEST) ← AC` — AC is the source of FULFILLS, the host carries the paired FULFILLED_BY.

| Source | Target | Relation | Cardinality on source |
| :--- | :--- | :--- | :--- |
| AC | US, FT, BUG, CR, or TEST | FULFILLS | unlimited (one AC may FULFILLS multiple hosts — typically one US that introduced it, plus any BUG/CR refining it, plus the TEST verifying it) |
| US, FT, BUG, CR, or TEST | AC | FULFILLED_BY | unlimited |

EPIC and PROJECT_CHARTER both carry no AC by design — AC → EPIC and AC → PROJECT_CHARTER FULFILLS are both rejected by Filum (PC follows EPIC's no-AC rule by symmetry, CR-260504-1747-001).

**Why multi-FULFILLS is canonical (rationale).** An AC routinely FULFILLS more than one host; each FULFILLS slot encodes a different role the AC plays in its lifetime. None of the rows below are duplicates — they are the AC's actual contract surface across three orthogonal axes (requirement / change-request / verification), and Claude must NEVER drop any of them.

- **Host requirement (US / FT) — long-term home.** The AC asserts behaviour of a specific requirement. After the introducing CR / BUG closes, the AC stays linked to its requirement; this is where it lives forever and where future readers find it when they open the FT or US.
- **CR / BUG — introducing-or-refining recap.** A CR is a recap of new implementation that has to be made, and a single CR can bundle changes that span multiple requirement objects. Linking the same AC to BOTH the host requirement AND the CR is therefore expected — the CR's `Fulfilled by` pane is the UAT scope view (every AC the CR is being verified against), the requirement's `Fulfilled by` pane is the long-term contract view. A BUG plays the same role for fix verification.
- **TEST — reusable verification session.** A TEST can be re-run multiple times until it PASSes; once the AC's `result` flips to PASS via the latest TEST cycle, Filum's propagation engine (DATA_MODEL.md §3.6) cascades that verdict to every host the AC FULFILLS in one transaction. The TEST FULFILLS slot is what lets a single verification session cover an AC that lives across multiple hosts at once.

Concrete shape: a typical AC introduced during a CR cycle is born with `FULFILLS = [US, CR]` (or `[FT, CR]` for feature-level AC), and gains a `FULFILLS → TEST-XXX` row each time a TEST is wired against the CR's AC list. By the end of the verification cycle an AC commonly carries 3 FULFILLS rows; that is correct, not duplication.

**Save-blocking rules** (enforced by Filum, but Claude must respect them):
- A TEST cannot leave DRAFT (have a non-null `result` written) without exactly one CONFIRMS link to a BUG or CR.
- A BUG/CR cannot leave DRAFT (transition to OPEN) without at least one CONFIRMS link to an EP, FT, or US.
- An AC cannot leave DRAFT (transition to OPEN, SOLVED, or CLOSED) without at least one FULFILLS link to a host (US/FT/BUG/CR/TEST).

**Forbidden combinations:**
- TEST → requirement direct (must go through BUG/CR).
- BUG/CR → TEST as CONFIRMS (chain is one-way; only CONFIRMED_BY is valid on BUG/CR).
- TEST has no SUPERSEDES chain — replacement = create a new TEST instance.
- Requirements never hold CONFIRMS — only CONFIRMED_BY (passive receipt).
- AC → EPIC FULFILLS — rejected (EPIC has no AC).
- AC → PROJECT_CHARTER FULFILLS — rejected (PC has no AC, CR-260504-1747-001).
- PROJECT_CHARTER as parent of anything other than EPIC, or as child of anything (PC is the root tier — `parent_id` always null).
- Defect cycles do NOT spawn new AC against existing requirement behaviour: a BUG/CR refining an existing AC adds itself to that AC's FULFILLS list (one AC, multiple hosts). Spawn a NEW AC only when the BUG/CR introduces genuinely new behaviour the host did not already assert.

### 3.5 Inline body content

Bodies are GFM. Link files inline with standard markdown:

```markdown
![dashboard](01_docs/04_content/images/dashboard.png)
[meeting notes](01_docs/04_content/html/kickoff.html)
[wireframe](01_docs/03_design/01_wireframes/S05_create_form.png)
```

- Paths relative to project root, forward slashes.
- Allowed extensions: `.png .jpg .jpeg .webp` (in `04_content/images/` or `03_design/`), `.html` (in `04_content/html/` or `03_design/`). `https://` URLs allowed but discouraged.
- **Revision Notes:** Filum may auto-append a "Revision Notes" section at the end of a body when the human supersedes an object. Read-only — never author or modify this section.

### 3.6 WBS hierarchy definitions

Two object families:

- **Requirement family (PC / EP / FT / US):** linked via parent/child (`parent_id`, `children_ids`).
- **Test-family (BUG / CR / TEST):** linked via CONFIRMS / CONFIRMED_BY (§3.4). No `parent_id`, no `children_ids`.

Both families are subject to placement and overload checks under Golden Rule 8.

#### 3.6.1 Requirement family (PC / EP / FT / US)

Every object must sit at the level that matches its actual scope. Use this table as the test — if an object doesn't fit its level, it belongs elsewhere.

| Level | What it is | Scale | Typical timeline |
| :--- | :--- | :--- | :--- |
| **Project Charter** | Project-wide vision and strategic goals — the single root of the WBS for the project | Project-spanning | The full project lifetime |
| **Epic** | High-level business goal or capability under the charter | Broad, cross-cutting | Months / quarters |
| **Feature** | Distinct piece of functionality that delivers part of an epic | Medium, self-contained | Multiple sprints |
| **User Story** | Small, testable requirement a dev can finish in isolation | Narrow, one behaviour | 1–3 days (human dev time) |

**How to challenge placement:**
- If a "user story" takes more than a few days or touches multiple areas of the app → it's probably a feature. Split it.
- If a "feature" is just one screen or one action → it's probably a user story. Demote it.
- If an "epic" has no sub-features and reads like a single capability → it's probably a feature. Demote it.
- If a "feature" spans multiple business goals → it's probably an epic. Promote it.
- A project always has exactly one Project Charter — never propose creating a second one (Filum's API rejects it). If the charter's scope feels split, restructure its child epics instead.

When Claude identifies a misplacement, it must propose the restructure (what moves where, what gets split or merged) in its first response and wait for user approval before touching any yaml.

**How to detect overload (object correctly placed but doing too much):**

Placement checks ask "is this at the right level?" Overload checks ask "is this object trying to do too much *for* its level?" Both must pass. An object can be correctly placed as a user story yet still need splitting.

*Quantitative red flags — investigate when any of these fire (AC counts = `FULFILLED_BY` relations to live, non-cancelled `AC-` objects):*
- **User Story:** >15 AC, OR body describes more than one distinct UI flow / interaction pattern / backend concern.
- **Feature:** >20 AC at feature level, OR child stories share duplicated AC (cross-cutting concern hiding inside the feature — extract the duplicated capability instead of letting each story carry its own near-identical AC objects), OR the feature's scope maps to more than one independently testable capability.
- **Epic:** >8 features, OR features within the epic serve clearly different business goals (test: can you state two non-overlapping "As a user I can…" sentences that each justify their own epic?).
- **Project Charter:** >12 epics (consider whether the project should be split into separate projects with their own charters), OR Strategic Goals section conflates more than one cohesive product narrative.

*Qualitative red flags — always check:*
- **Concern mixing:** A single object bundles layout/styling, data logic, file I/O, and validation as if they were one behaviour. Each of these is a separate concern that can break independently → should be separate stories.
- **Cross-cutting duplication:** The same capability (e.g. a picker modal, a resizable panel, an inline-save mechanism) appears in multiple sibling stories with duplicated AC objects. Extract it into its own story or feature so a bug fix stays in one place. Where a single AC asserts behaviour shared across siblings, prefer one AC FULFILLS-linked to multiple hosts (§3.4 multi-FULFILLS) over duplicating AC objects.
- **Empty shells:** A story with no `FULFILLED_BY → AC` relations and no `story_statement` is a placeholder, not a requirement. Flag it — it cannot be developed or tested.

When Claude identifies overload, it must report: which objects are overloaded, what the distinct concerns are, and a proposed split. Wait for user approval before touching any yaml.

#### 3.6.2 Test-family (BUG / CR / TEST)

| Type | What it is | Scale |
| :--- | :--- | :--- |
| **BUG** | Code defect — behaviour deviates from the existing requirement, no scope change | Narrow, code-only |
| **CR** | Change request — requirement scope change (add / modify / remove behaviour, design, data model) | Variable — see priority scale below |
| **TEST** | Single UAT or SIT round confirming whether a BUG/CR's fix landed | Narrow, one cycle |

**Placement rules:**
- A defect that needs **only code** to align with the existing requirement → BUG.
- A defect that requires **changing the requirement** (AC, body, designs, data model, supersede) → CR.
- A request adding new behaviour without superseding existing AC → CR (not US — §5.2.1 triage drives this).
- A test session targeting a specific BUG/CR → TEST. TESTs do NOT directly target requirements.

**Priority scale (BUG / CR — Claude assigns on create per §5.2.2; human can override in Filum):**

| Priority | BUG meaning | CR meaning |
| :--- | :--- | :--- |
| `URGENT` | Blocks entire functionality, no workaround | Cross-functionality impact + most US within those impacted, OR adds an entirely new functionality |
| `HIGH` | Blocks entire functionality but workaround exists (other paths) | Entire functionality to be reviewed with most of its US |
| `MED` | Blocks a piece of functionality | Significant amount of US within the same functionality to be reviewed |
| `LOW` | Minor UX issue, marginal function blocked | Single US or small pieces of US to be reviewed |

When Claude creates a BUG/CR, Claude assigns a concrete priority (LOW/MED/HIGH/CRITICAL) per the scale above — never `null`. The choice is a recommendation that Filum's save-blocking rule then accepts; the human can override in Filum review before promoting to OPEN.

**How to detect overload (test-family):**

*Quantitative red flags (AC counts = `FULFILLED_BY` relations to live, non-cancelled `AC-` objects):*
- **BUG:** >15 AC, OR body covers more than one root cause / fix surface (split into separate BUGs, each with its own CONFIRMS links).
- **CR:** >20 AC, OR scope spans more than one functionality (split into multiple CRs).
- **TEST:** >15 AC (one test session should not exceed one defect's AC reach), OR body covers more than one test environment / configuration.

*Qualitative red flags:*
- **Empty shells:** BUG/CR with no CONFIRMS link to any requirement, or with no `FULFILLED_BY → AC` relations; TEST with no CONFIRMS link to a BUG/CR or no `FULFILLED_BY → AC` relations. These cannot leave DRAFT and signal an authoring gap (orphan TESTs trigger §5.2.1 triage — see §4.6). Also: an `AC-` object with no `FULFILLS` relations is an orphan AC (DATA_MODEL.md §3.6) — cannot leave DRAFT, surface for human cleanup.
- **Wrong family:** a defect filed as a BUG that actually needs a requirement change → re-triage as CR. A request filed as a CR that's purely code-aligned → re-triage as BUG.

When Claude identifies overload or wrong-family placement in test-family, it must propose the restructure and wait for user approval before touching any yaml.

### 3.7 Acceptance criteria — first-class objects

**AC are not markdown.** Per CR-260425-1837-001, every acceptance criterion is a fully-fledged YAML object of `type: AC` with its own `id`, `status`, `result`, `priority`, `body`, and `relations`. AC objects are stored at the top level of the data yaml under the `acceptance_criteria:` key (a flat list — same shape as `tests:`, `bugs:`, `change_requests:`). They do NOT participate in the parent/child tree (`parent_id` and `children_ids` always null/empty).

The host's `acceptance_criteria` field stays `null` — that field is the legacy markdown-checklist form, retired by CR-260425-1837-001. Filum's importer still tolerates it for backward compatibility, but **Claude must NEVER author legacy markdown AC**. All new AC content goes in AC objects, linked to the host via FULFILLS / FULFILLED_BY (§3.4).

**Authoritative schema:** DATA_MODEL.md §3.4a (entity definition + status/result coupling), §3.6 (propagation engine — Filum-side closure cascade, not Claude's job), §5.1 (FULFILLS validity matrix).

**Linking model:**
- An AC carries one or more `FULFILLS` relations to its host(s). The paired `FULFILLED_BY` is mirrored on each host's `relations` list.
- One AC, multiple FULFILLS slots is the canonical pattern: typically one US (the requirement that introduced the AC), plus any BUG/CR refining it, plus the TEST(s) verifying it. Defect cycles do NOT spawn duplicate AC for the same behaviour — the BUG/CR adds itself to the existing AC's FULFILLS list.
- A BUG/CR introducing genuinely **new** behaviour (something the host requirement did not previously assert) DOES spawn fresh AC objects, each FULFILLS-linked to (a) the BUG/CR and (b) every host requirement the new behaviour belongs to.

**Status / result coupling** (DATA_MODEL.md §3.4a — bidirectional):

| `result` | `status` | Meaning |
| :--- | :--- | :--- |
| `null` | `DRAFT` | Initial state, FULFILLS not yet linked. |
| `null` | `OPEN` | Authored, FULFILLS ≥ 1, awaiting test. |
| `READY_FOR_TEST` | `SOLVED` | Implementation done, ready for UAT. |
| `PASS` | `CLOSED` | Verified by TEST. |
| `FAIL` | `OPEN` | Verified failing — host re-opens via reverse cascade. |

Writing either field auto-syncs the other in one transaction. Filum's propagation engine (DATA_MODEL.md §3.6) cascades closure forward (`AC → host → parent → grandparent`) and reverses regressions back up the same chain — Claude does NOT manually propagate; Claude writes the AC.result and Filum handles the cascade.

**Authoring an AC object:**

```yaml
- id: AC-260503-1530-001          # AC-{YYMMDD}-{HHmm}-{NNN}
  project_id: PR-...
  type: AC
  created_at: '2026-05-03T15:30:00'
  created_by: CLAUDE_CODE
  cancelled_at: null
  locked: false
  title: Save button is disabled until all required fields pass validation.   # the AC sentence itself, one-liner
  status: OPEN                    # DRAFT until FULFILLS ≥ 1; OPEN once linked
  result: null                    # null on author; PASS/FAIL/READY_FOR_TEST after test
  priority: LOW|MED|HIGH|CRITICAL  # Claude assigns per §3.6.2 adapted to AC role; human can override in Filum
  updated_at: '2026-05-03T15:30:00'
  updated_by: CLAUDE_CODE
  approved_by_human: null         # always null when Claude writes
  cancellation_reason: null
  tags: []
  body: |                         # follow §3.8.6 template: BOTH sections REQUIRED on author/update — no stubs
    ## Description
    {one-paragraph context — what surface this AC touches, which host requirement it derives from, any §reference}

    ## Test Instructions
    1. {step}
    2. {step — expected result if non-obvious}
  acceptance_criteria: null       # AC objects themselves carry null here (legacy field)
  relations:
    - { type: FULFILLS, target_id: "US-..." }   # at least one — typically the host requirement
    - { type: FULFILLS, target_id: "CR-..." }   # add the BUG/CR introducing/refining this AC
```

**Updating AC results (verdict-processing, §5.2.3 / §5.2.4):**
- TEST passes an AC → write `result: PASS` on the AC (Filum auto-sets `status: CLOSED` and cascades closure to every host listed in FULFILLS).
- TEST fails an AC → write `result: FAIL` on the AC (Filum auto-sets `status: OPEN` and reverse-cascades regressions to every host).
- Mid-cycle "not yet tested" → leave `result: null`.

**Counting AC** ("how many AC does this host have?"): count the host's `FULFILLED_BY` relations to `AC-` objects (excluding cancelled AC). The legacy markdown-checklist count is irrelevant once the host's `acceptance_criteria` field is `null`.

**TEST aggregate result is computed**, not authored: Filum aggregates the results of every AC FULFILLED_BY the TEST — all PASS → PASS; all FAIL → FAIL; mixed → PARTIAL. Claude never writes `TEST.result` directly; Claude writes per-AC results, and Filum recomputes.

**Save-blocking rules** (mirrored from §3.4):
- AC cannot leave DRAFT without at least one FULFILLS link.
- The host's FULFILLED_BY list is required where §3.8 templates mark "FULFILLED_BY → AC objects (required)".

**`#N` cross-references in body text:** AC are now identified by their full `AC-...` id, not by a sequential `#N`. When citing an AC inside a BUG/CR/US body, write the `AC-...` id directly. The legacy `{REQ_ID}#N` form is retained ONLY when referencing a host's pre-CR-260425-1837-001 inline-markdown AC items that have not yet been migrated to AC objects.

### 3.8 Body structure templates

Every object's `body` must follow the template for its type. Sections marked **(required)** must be present before the object leaves DRAFT. Sections marked *(optional)* are encouraged but not blocking.

#### Project Charter body template

```markdown
# PC — {Project Name}

## Project Vision
{One paragraph: what this project exists to deliver, for whom, and why now.}

## Strategic Goals
- {goal 1 — measurable / observable outcome}
- {goal 2}
- {goal 3}

## Epic Navigation Flows
| Epic | Entry point |
| :--- | :--- |
| EP{NN} — {title} | {where in the UI the user enters this epic's flows} |

---

## Body
{Prose anchoring the project's broader narrative — stakeholders, success metrics,
known constraints, sequencing rationale across epics.}

**Out of scope:**
- {what is explicitly NOT in this project — reference adjacent projects if any}

**Reference documents:**
- DATA_MODEL.md §{N} ({topic})
- UI_SPEC.md §{N} ({topic})

---
```

- **Project Vision** **(required):** the one-paragraph elevator pitch the charter exists to encode.
- **Strategic Goals** **(required):** measurable outcomes the project commits to. Drives epic prioritisation.
- **Epic Navigation Flows** **(required once epics exist):** maps each child EPIC to its UI entry point. Use `(none yet)` when the project has no epics.
- **Out of scope** **(required):** prevents scope creep at the project level.
- **Reference documents** **(required):** pointers to DATA_MODEL.md and UI_SPEC.md sections relevant to project-wide concerns.
- **AC** — PROJECT_CHARTER has no AC by design (CR-260504-1747-001 — mirrors EPIC rule). The host's `acceptance_criteria` field stays `null` AND the PC carries no `FULFILLED_BY → AC` relations. AC → PC FULFILLS is rejected by Filum.
- **Cardinality:** exactly one PC per project, auto-created at project init. Never propose creating a second PC.

#### Epic body template

```markdown
# EP{NN} — {Title}

## Feature Navigation Flows
| Flow | Feature | Entry point |
| :--- | :--- | :--- |
| FL{NN} | FT{NN} — {title} | {where in the UI the user enters this flow} |

---

## Body
{Prose description of the business goal / capability this epic covers.}

**Key functional areas:**
- {area 1}
- {area 2}

**Out of scope:**
- {what is explicitly NOT covered — reference which other epic owns it}

**Reference documents:**
- DATA_MODEL.md §{N} ({topic})
- UI_SPEC.md §{N} ({topic})

---
```

- **Feature Navigation Flows** **(required):** maps each child feature to its UI entry point. Only list features that belong to THIS epic.
- **Out of scope** **(required):** prevents Claude from implementing adjacent features.
- **Reference documents** **(required):** pointers to DATA_MODEL.md and UI_SPEC.md sections.
- **AC** — EPIC has no AC by design (CR-260425-1837-001). The host's `acceptance_criteria` field stays `null` AND the EPIC carries no `FULFILLED_BY → AC` relations. AC → EPIC FULFILLS is rejected by Filum.

#### Feature body template

```markdown
# FT{NN} — {Title}

## Wireframes
{Links to PNG/HTML boards per child story, or "(pending §5.1.2)" if design phase not yet run.}

---

## Body
{Complete behavioral prose — every interaction pattern, layout rule, and edge case
for the feature as a whole. This is the authoritative contract Claude reads before
looking at individual stories.}

**Out of scope:**
- {what is deferred or excluded from this feature}

**Reference documents:**
- DATA_MODEL.md §{N.N} ({topic})
- UI_SPEC.md §{N.N} ({topic})

---
```

- **Wireframes** **(required once design phase runs):** links to actual boards. Use `(pending §5.1.2)` as placeholder only until design is complete.
- **Out of scope** **(required):** deferred or excluded behaviour.
- **Reference documents** **(required):** specific subsections, not just top-level sections.
- **AC objects via FULFILLED_BY** **(required, ≥1):** feature-level AC covering cross-story integration and regression guards. Each AC is a separate `AC-...` object FULFILLS-linked to this feature. See §3.8.1. The host's `acceptance_criteria` field stays `null`.

#### User Story body template

```markdown
{Scope paragraph — what this story handles and what is split out to siblings.}

**Data model fields touched:**
- `{Entity.field}` ({read|write|both}) — {brief context}
- `{AuditEvent.EVENT_NAME}` (write on {trigger})

**Spec reference:** UI_SPEC.md §{N.N} ({subsection title}), §{N.N} ({subsection title})
```

- **Scope paragraph** **(required):** what this story covers and what is explicitly delegated to sibling stories.
- **Data model fields touched** **(required):** every DATA_MODEL.md field this story reads or writes. Claude uses this to target implementation without re-reading the full Feature body. Include audit events the story triggers.
- **Spec reference** **(required):** specific UI_SPEC.md subsection(s) for this story's screen/behaviour — not just the Feature-level reference. For technical/backend stories with no UI, reference the relevant DATA_MODEL.md subsection instead.
- **`story_statement`** must have all three segments complete: `As a {role}, I want {single action}, so that {complete business outcome}.` A truncated "so that" clause is a drafting defect — fix before leaving DRAFT.
- **AC objects via FULFILLED_BY** **(required, ≥1):** every happy-path behaviour AND, for interactive stories, at least one error-state AC (§3.8.2). Each AC is its own `AC-...` object FULFILLS-linked to this story. The host's `acceptance_criteria` field stays `null`.

#### 3.8.1 Feature-level acceptance criteria

Every feature needs at least one AC object FULFILLED_BY it. The host's `acceptance_criteria` field stays `null` — the AC content lives in `AC-...` objects under the top-level `acceptance_criteria:` list, FULFILLS-linked to this feature.

Feature-level AC cover:

1. **Cross-story integration:** behaviour that spans multiple child stories and has no single story as owner (e.g. "Navigation between create form and detail panel is seamless — creating an object opens it immediately in the detail panel").
2. **Regression guard:** "No regressions introduced in sibling features sharing the same screen or panel."

Feature AC must NOT duplicate child story AC. If a condition is already tested at story level, don't repeat it at feature level — and never spawn a new AC for behaviour an existing AC already covers (§3.4 deduplication rule). Add the feature to the existing AC's FULFILLS list instead.

**Example (each AC = its own object):**

```yaml
# under top-level acceptance_criteria: list
- id: AC-260503-1530-101
  type: AC
  title: Creating an object via the form (US-01) opens it immediately in the detail panel (US-02) with all saved fields displayed.
  status: OPEN
  result: null
  ...
  relations:
    - { type: FULFILLS, target_id: "FT-..." }       # this feature

- id: AC-260503-1530-102
  type: AC
  title: Editing an existing object preserves all fields not touched by the edit — no silent data loss on save.
  status: OPEN
  result: null
  ...
  relations:
    - { type: FULFILLS, target_id: "FT-..." }

- id: AC-260503-1530-103
  type: AC
  title: No regressions in sibling features sharing the Object List or Detail Panel.
  status: OPEN
  result: null
  ...
  relations:
    - { type: FULFILLS, target_id: "FT-..." }
```

The feature's `relations` block carries the paired `FULFILLED_BY` rows (one per AC).

#### 3.8.2 Error-state acceptance criteria (User Stories)

Any user story involving user interaction (form submission, button click, API call, navigation) must have at least one error-state AC object FULFILLED_BY it, alongside the happy-path AC. Stories that are purely display (view-only, no writes) are exempt.

**Required error patterns (include whichever apply to the story):**
- **Validation failure:** what message appears, where it appears (inline below field), and what state the form stays in.
- **Save/API failure:** what toast or notification appears, and whether the form retains entered data.
- **Boundary hit:** what happens at the exact limit (e.g. 200th character accepted, 201st rejected with inline error).

**Example (each AC = its own object alongside the happy-path AC):**

```yaml
- id: AC-260503-1530-150
  type: AC
  title: If save fails (server error), a toast appears with "Save failed — please try again" and the form stays open with all entered data preserved.
  status: OPEN
  result: null
  ...
  relations:
    - { type: FULFILLS, target_id: "US-..." }

- id: AC-260503-1530-151
  type: AC
  title: Title field shows inline error "Title is required" in red below the field when Save is attempted with empty title.
  status: OPEN
  result: null
  ...
  relations:
    - { type: FULFILLS, target_id: "US-..." }
```

#### 3.8.3 BUG body template

```markdown
# BUG{NN} — {Title}

## Defect Summary
{Single paragraph: what failed, where in the UI / which endpoint, what was expected vs observed.}

---

## Affected Requirements (CONFIRMS targets)
- `{REQ_ID}` — {title} — failing AC: #{N1}, #{N2}

---

## Technical Approach

**Files / functions to change:**
- `{path/to/file}` — {function or section}

**Root cause:**
{1–3 sentences identifying why the defect manifested.}

**Fix outline:**
{Concrete steps. Reference DATA_MODEL.md / UI_SPEC.md sections as needed.}

---
```

- **Defect Summary** **(required).**
- **Affected Requirements** **(required)** — at least one entry. Must match the CONFIRMS relations on this BUG.
- **Technical Approach** **(required).** Authored by Claude during §5.2.2. Updated only between cycles if scope shifts.
- **AC objects via FULFILLED_BY** **(required, ≥1):** fix-verification AC objects, each describing a concrete observable post-fix condition. Each AC FULFILLS this BUG plus, where the AC re-asserts existing host behaviour, the affected requirement(s) — see §3.4 dedup rule. The host's `acceptance_criteria` field stays `null`.

#### 3.8.4 CR body template

```markdown
# CR{NN} — {Title}

## Change Summary
{What requirement-level change triggered this — user feedback, scope expansion, constraint change. 1–2 paragraphs.}

---

## Affected Requirement Objects
| ID — Title | Action | Status transition |
| :--- | :--- | :--- |
| `{REQ_ID}` — {title} | added \| modified \| cancelled \| restructured | {OLD} → {NEW} |

---

## Design Changes
{Wireframes added / removed / updated, or "(none)".}

## Data Model Changes
{DATA_MODEL.md / AUDIT_MODEL.md sections changed, or "(none)".}

## Supersede / Versioning
{Any SUPERSEDES / SUPERSEDED_BY relations created, or "(none)".}

## Scope Impact Assessment
- **Features affected:** {list, or "(none)"}
- **Features blocked:** {list, or "(none)"}
- **Features unblocked:** {list, or "(none)"}
- **Regression risk:** {short note}
- **Breaking changes:** {list, or "(none)"}

---
```

- **Change Summary** **(required).**
- **Affected Requirement Objects** **(required)** — at least one entry. Must match the CONFIRMS relations on this CR.
- **Design Changes / Data Model Changes / Supersede / Scope Impact** all **(required)** — use "(none)" when applicable, do not omit headings.
- **AC objects via FULFILLED_BY** **(required, ≥1):** fix-verification AC objects covering the requirement updates landing correctly (designs match, data model migrations applied, the new/modified behaviour of each affected requirement is asserted). Each AC FULFILLS this CR plus the affected requirement(s) it constrains (multi-FULFILLS is canonical — §3.4). New behaviours add new AC objects; refinements of existing behaviours add this CR to the existing AC's FULFILLS list instead of duplicating. The host's `acceptance_criteria` field stays `null`.

#### 3.8.5 TEST body template

```markdown
# TEST{NN} — {Title}

## Test Session
- **Date:** {ISO date}
- **Tester:** {name, or "human via Filum"}
- **Environment:** {browser / OS / build, or "(default)"}
- **Target:** `{BUG_ID|CR_ID}` — {title} (CONFIRMS link)

---

## Steps Performed
1. {step 1}
2. {step 2}

## Expected vs Actual
- **Expected:** {what should have happened, per the BUG/CR AC}
- **Actual:** {what was observed}
- **Screenshots / refs:** {inline image links per §3.5, or "(none)"}

---
```

- **Test Session** **(required)** — minimum: target ID + date.
- **Steps Performed** **(required).**
- **Expected vs Actual** **(required).**
- **AC objects via FULFILLED_BY** **(required, ≥1):** the TEST exercises the AC objects FULFILLED_BY the BUG/CR being verified. The TEST itself is FULFILLED_BY those same AC (they are added to each AC's FULFILLS list — §3.4 multi-FULFILLS). For each AC, Claude (or the human tester via Filum) writes the per-AC verdict by setting `AC.result` to `PASS` or `FAIL`. The TEST's aggregate `result` is then COMPUTED by Filum (all PASS → PASS; all FAIL → FAIL; mixed → PARTIAL) — Claude does NOT write `TEST.result` directly. The host's `acceptance_criteria` field stays `null`.

#### 3.8.6 AC body template

The AC `title` carries the AC sentence (one-liner). The body adds context and verification details. **Both sections are REQUIRED whenever Claude authors or updates an AC** — no empty stubs, no headings-only. The body is the surface the human tester reads in Filum during UAT, so it must be informative on its own.

```markdown
## Description
{What behaviour this AC asserts. One short paragraph. Reference the host's body or DATA_MODEL.md / UI_SPEC.md sections instead of repeating them.}

## Test Instructions
1. {step}
2. {step — expected result where non-obvious}
```

- **Description** **(required):** one or two sentences placing the AC in context — what surface area it touches, which host requirement / §number / object ID it derives from, what edge case it asserts. Reference §numbers and IDs instead of restating concepts. Brief is fine when the title is largely self-describing, but never empty.
- **Test Instructions** **(required — the more important of the two):** concrete steps a tester can perform to verify the AC. **Markdown numbered list is REQUIRED — never prose, never comma-separated, never a single run-on line.** Format rules, enforced on every author/update: (a) a blank line MUST precede the first `1.` so CommonMark renders the list (a numbered item glued to the `## Test Instructions` heading or to a preceding paragraph collapses the list into prose); (b) each step is its own `N.` list item on its own line — one step per line, never two actions joined by a comma or semicolon under one number; (c) numbering starts at `1.` and increments by one with no gaps; (d) each step lists the action and, where non-obvious, the expected result (parenthetical "(verify by …)" / "(expected: …)" inline is fine and encouraged); (e) when an AC is trivially observable, write the single one-line observation as `1. {observation}` — still a numbered list, never a bare sentence. Cover the happy path plus any boundary the AC asserts. The rendered surface (UI_SPEC.md §7.1a.1) treats this block as markdown, so deviations from the format above will render as a paragraph instead of a step list.

Both sections are written for the human tester running UAT in Filum, so they must be readable prose / readable steps, not Claude-Code shorthand. Golden Rule 9 (low verbosity) still applies — dense, no filler, no repetition of the title.

The body is rendered in the AC's right-top pane (UI_SPEC.md §7.1a.1). FULFILLS targets are shown in the AC's Dependencies pane — never list them in the body.

---

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

**Every workflow that writes any yaml file — requirements, status changes, content edits, link updates, BUG/CR/TEST authoring, CONFIRMS relations — ends here without exception. There is no yaml write that does not trigger this protocol.**

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

Triggered automatically at Session Start (§4.1) and whenever the user asks Claude to review or assess the WBS. The audit runs against all data yaml files (draft, active, closed — skip cancelled).

```
1. Count per object: AC = FULFILLED_BY relations to live (non-cancelled) AC-
   objects; children; body concerns; CONFIRMS relations (test-family); FULFILLS
   relations (on AC objects). Any host's legacy `acceptance_criteria` markdown
   field is ignored for counts — count only AC objects.
2. Flag every object that trips a §3.6 threshold:
   - Story: >15 AC, or multiple distinct concerns in body, or no FULFILLED_BY → AC / no story_statement,
     or body missing "Data model fields touched" / "Spec reference" (§3.8),
     or interactive story missing error-state AC (§3.8.2)
   - Feature: >20 AC, or duplicated AC objects across child stories (use multi-FULFILLS instead),
     or >1 independent capability, or no FULFILLED_BY → AC at all (§3.8.1)
   - Epic: >8 features, or features serving different business goals,
     or parent_id null (orphan EP — should be reparented under the project's PC, CR-260504-1747-001)
     (EPIC must NOT carry FULFILLED_BY → AC — flag if it does)
   - Project Charter: >12 epics, OR Strategic Goals section conflates >1 product narrative
     (PC must NOT carry FULFILLED_BY → AC — flag if it does), OR project has zero PCs
     (single-PC invariant violated — auto-create or migrate, CR-260504-1747-001), OR project
     has >1 PC (single-PC invariant violated)
   - BUG: >15 AC, body covers >1 root cause, no CONFIRMS link to any requirement,
     no FULFILLED_BY → AC, missing required body sections (§3.8.3)
   - CR: >20 AC, scope spans >1 functionality, no CONFIRMS link to any requirement,
     no FULFILLED_BY → AC, missing required body sections (§3.8.4)
   - TEST: >15 AC, body covers >1 environment, no CONFIRMS link to any BUG/CR,
     no FULFILLED_BY → AC, missing required body sections (§3.8.5).
     Note: TEST.result is computed — flag if it has been hand-written.
   - AC: no FULFILLS link (orphan AC — cannot leave DRAFT; data hygiene flag),
     or status/result coupling violated (e.g. result=PASS with status=OPEN),
     or body missing §3.8.6 sections (the headings themselves are absent),
     or §3.8.6 sections present but EMPTY / headings-only — both Description
     and Test Instructions must be populated when Claude authors or updates
     the AC (§3.8.6 + §5.1.1 quality bar)
   - Orphan TEST with result = FAIL or PARTIAL → §5.2.1 triage trigger
   - Orphan TEST with result = PASS → data hygiene flag, no auto-action
   - Host with non-null legacy `acceptance_criteria` markdown field → data hygiene
     flag (legacy form authored after CR-260425-1837-001 — should be migrated)
3. Present a structured report:
   a. OVERLOADED: {id, title, AC count, what concerns are mixed}
   b. EMPTY SHELLS: stories with no FULFILLED_BY → AC or no story_statement;
      BUG/CR/TEST with no CONFIRMS link or no FULFILLED_BY → AC;
      AC objects with no FULFILLS link
   c. TEMPLATE GAPS: stories missing template sections (§3.8 US template),
      features with no FULFILLED_BY → AC (§3.8.1), interactive stories missing error-state AC (§3.8.2),
      BUG/CR/TEST missing required body sections (§3.8.3 / §3.8.4 / §3.8.5),
      AC missing §3.8.6 body headings,
      hosts authoring legacy markdown in `acceptance_criteria`
   d. CROSS-CUTTING: capabilities duplicated across siblings (consolidate via multi-FULFILLS)
   e. LEVEL MISPLACEMENT: objects at the wrong level per §3.6 (including
      BUG-vs-CR family misplacement)
   f. ORPHAN TESTS: list with their result value so the user can decide
      which trigger §5.2.1 triage
   g. ORPHAN AC: list AC with no FULFILLS link so the user can re-link or cancel
4. For each finding, propose the specific action (split, merge, promote, demote, extract, re-triage, link, migrate)
5. Wait for user direction before touching any yaml
```

**At Session Start:** run the audit silently. If findings exist, present a brief summary before proceeding with the user's request: "I ran a WBS health check and found N issues — [1-line summary]. Want to address these now or proceed with your request?" If no findings, proceed without mention.

**On explicit user request:** run the full audit and present the complete report.

---

## 5. Processes Rules

All processes start with Session Start (4.1). All yaml writes end with Import (4.3). Every edit to an existing object requires stating {id, title, exact change} and waiting for user approval — exception: when propagating an approved change request (§5.2.2), individual edits within the approved scope do not require separate approval. These rules are not repeated below — they always apply.

**Object citation rule:** citing an object's ID alone is sufficient in any response (chat, yaml comment, body content). The title may accompany the ID for clarity (`{ID} — {title}`) but is not required.

### 5.1 Guidelines

These run in order: Requirements → Design → Development. Do not jump ahead (e.g. no wireframes before requirements are stable, no code before design is done or explicitly skipped by the user).

#### 5.1.1 Requirements

```
1. If user brings structured input → draft it directly
   If vague → ask targeted questions to fill the Epic/Feature/US hierarchy
2. Validate WBS placement AND overload (Golden Rule 8, §3.6) as you draft
   — check both level correctness and AC/concern thresholds
3. Status rule — determines which file to write to:
   - OPEN   → project-active.yaml  ← use this when Claude creates fully-specified objects
              (complete title, body, AC, story_statement). This is the default for
              Claude-authored requirements.
   - DRAFT  → project-draft.yaml   ← use ONLY for incomplete sketches that the user
              explicitly wants to review before they are defined further. Never leave
              a complete Claude-authored object in DRAFT.
4. Propagate consistency downward after any change (Golden Rule 7)
5. Update DATA_MODEL.md / AUDIT_MODEL.md if entities/fields changed
   Flag breaking changes to the user and wait for acknowledgment before import
```

**Quality bar — all must pass before an object leaves DRAFT:**
- Every user story has `story_statement` (all three segments complete, no truncated "so that") + at least one `FULFILLED_BY → AC` relation.
- Every user story body follows the §3.8 template: scope paragraph + "Data model fields touched" + "Spec reference".
- Every user story with user interaction has at least one error-state AC object FULFILLED_BY it (§3.8.2).
- Every feature has at least one `FULFILLED_BY → AC` relation covering cross-story integration (§3.8.1) — and never reuses the legacy markdown `acceptance_criteria` field.
- Every feature and epic body includes "Out of scope" and "Reference documents" sections.
- Every AC object has at least one `FULFILLS` relation before it leaves DRAFT.
- Every AC body has BOTH `## Description` and `## Test Instructions` populated — no empty stubs, no headings-only (§3.8.6). Test Instructions is the higher-priority section.
- Every host's `acceptance_criteria` field is `null` (legacy form retired — §3.7).
- No story exceeds 15 AC. No feature exceeds 20 AC. No body mixes more than one distinct concern.

#### 5.1.2 Design (Wireframes)

Only when user requests it and requirements are stable.

**Quality bar:** clear labels, all screens accounted for, visually consistent across all levels.

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
- PNGs = what the user sees. No annotations.
- HTML boards = PNGs assembled into journeys. Annotations here only.
- Image naming: `{CodeID}_{short_title}.png`. Variants: `S05.1_...`.
- Captions in HTML must match Code ID + short title. Homepage is always captioned "homepage."

**Steps:**
```
1. Epic level: one flow per feature across all entry points.
   System-wide, not per-epic. 1 HTML per flow + all_flows.html.
2. Feature level: one PNG per screen state (at wireframes root).
   1 HTML per journey, 1 HTML per feature grouping journeys.
3. Consistency pass (bottom-up): journey board is truth → feature → epic.
   If traces to a requirement conflict → STOP, flag to user.
4. After any change, propagate to boards that reference the changed screen.
```

#### 5.1.3 Development

Requirements are read-only during development. Never modify requirements, designs, or data model — only code.

```
1. Read project-active.yaml — review ALL OPEN objects (including orphans)
   to understand full scope, then work on what the user directs or sequentially
2. Per requirement (or as directed by user):
   a. Read body + every AC object FULFILLED_BY this requirement (resolve via
      relations) + DATA_MODEL.md. **Frontend pre-flight (§6.7):** if the change
      will touch any file under `02_code/filum/frontend/`, additionally read
      UI_SPEC.md §19 and every design-system file the change will modify
      before writing code.
   b. Write code in 02_code/
   c. Smoke test per requirement: builds, entrypoints work
3. After all code is written — run SIT as final integration pass:
   a. Test against each AC object FULFILLED_BY every OPEN requirement
   b. Fix failures, loop. After 3 consecutive fails on same test → skip it
   c. Note unresolved failures in the affected requirement's body or in chat
      (NEVER author 03_bug fixing/*.md — those folders no longer exist; surface
      defects via §5.2 instead, which creates BUG/CR yaml objects)
4. Report to user: SIT results + failure list. Hand over for UAT.
   Per requirement where SIT passed: OPEN → SOLVED. Per Golden Rule 13,
   Claude MUST NOT write `AC.result` or `AC.status` here — leave every AC
   FULFILLED_BY each SOLVED requirement at its current verdict; UAT (user)
   sets per-AC results on the next TEST cycle.
   After each SOLVED write, apply upward propagation (Golden Rule 10):
   if all children of the parent are now SOLVED → move parent to SOLVED; repeat up to epic.
```

**UAT (user runs):** wait for feedback. Defects enter the §5.2 loop.

**Closure:** Filum cascades AC closure to hosts automatically (DATA_MODEL.md §3.6 propagation engine). When all AC objects FULFILLED_BY a host are CLOSED (`result = PASS`), the host transitions to CLOSED in the same transaction. Claude's role is to write per-AC verdicts in §5.2.3 step 2 / §5.2.4 step 2 — Filum handles the cascade up the FULFILLED_BY chain and the EP/FT/US parent/child chain (Golden Rule 10).

### 5.2 Processes

The processes below form a loop that repeats until every requirement object has all its FULFILLED_BY AC objects in `status = CLOSED` / `result = PASS` (Filum then cascades the requirement to CLOSED automatically — see §5.1.3 Closure).

**AC mechanics (applies throughout §5.2):** Claude operates on AC objects, not markdown checkboxes. To mark an AC as passing, write `result: PASS` on the `AC-...` object — Filum auto-couples `status: CLOSED`. To mark an AC as failing, write `result: FAIL` — Filum auto-couples `status: OPEN`. Filum's propagation engine then cascades closure / regression to every host listed in the AC's FULFILLS relations. Claude does NOT toggle markdown checkboxes; Claude does NOT manually close hosts whose AC are all PASS (Filum handles it).

```
Loop entry points (only these two):
  ├─ User chat message describing a defect
  └─ Imported ORPHAN TEST (no CONFIRMS link) with result = FAIL or PARTIAL

Loop:
  Triage (§5.2.1) → BUG path OR CR path
    ├─ CR: §5.2.2 (CR object authored in YAML body — DRAFT)
    │      → human review in Filum (priority assigned, staged requirement
    │        updates accepted, CR → OPEN, re-import)
    │      → §5.2.4 fix loop (invoked by user — no bundle mode)
    └─ BUG: §5.2.2 (BUG object authored in YAML body — DRAFT)
            → human review in Filum (priority assigned, BUG → OPEN, re-import)
            → §5.2.3 fix loop (invoked by user, single or bundle mode)
         ↻ Subsequent TESTs ASSIGNED to a BUG/CR are PASSIVE — they only
           augment information on the BUG/CR. They never trigger Claude
           automatically. The next fix cycle (§5.2.3 for BUG, §5.2.4 for
           CR — invoked by the user) reads the BUG/CR + latest non-cancelled
           TEST and processes the verdict per §5.2.3 step 2 (BUG) or
           §5.2.4 step 2 (CR).
```

**Triggers that act vs information that is passive:**
- **Acts:** chat defect description; orphan TEST (no CONFIRMS); user invocation of §5.2.3 (single or bundle) or §5.2.4; status transitions on BUG/CR (e.g. DRAFT → OPEN by human in Filum, which unlocks §5.2.3 for that BUG or §5.2.4 for that CR).
- **Passive:** assigned TESTs (CONFIRMS-linked) — they merely complete information on the BUG/CR they confirm, surfaced in §4.2 Export Review.

**One defect per cycle.** A cycle starts with one of the two entry triggers above OR a user invocation of §5.2.3 against an existing BUG OR §5.2.4 against an existing CR. The first orphan TEST under a triage path creates the BUG/CR (in DRAFT); later TESTs assigned to that BUG/CR sit passively until the user invokes the next fix cycle (§5.2.3 for BUG, §5.2.4 for CR).

**Import protocol per defect type:**
- **CR:** One import at the end of §5.2.2 (after authoring the CR body in DRAFT and the staged requirement edits). The human reviews the staged content in Filum, assigns priority, accepts the requirement updates, promotes the CR to OPEN, and re-imports. The fix then runs in §5.2.4 with one import per dev piece (after each AC checkbox / status write) plus one import on closure (§5.2.4 step 8). Bundle mode does not apply to CRs.
- **BUG:** Two imports per loop iteration — once at the end of §5.2.2 (after authoring the BUG body in DRAFT and setting CONFIRMS-linked requirements to OPEN, awaiting human approval that promotes the BUG to OPEN), and once at the end of §5.2.3 (after verdict-processing and any new fix updates AC checkboxes and statuses on BUG, on the linked requirements, and reads — never writes — the TEST). Do NOT call Import (4.3) at any intermediate step within §5.2.3.

#### 5.2.1 UAT Feedback / Triage

**Entry triggers — no exceptions:** ANY of the following activates §5.2.1:
- Chat message describing a defect (formal UAT report, screenshot, casual remark, mid-session observation).
- An imported orphan TEST (no CONFIRMS link) with `result = FAIL` or `result = PARTIAL`.

No framing bypasses triage. "Fix this" or "this is broken" is not permission to write code; it is permission to triage.

**Orphan TEST with `result = PASS`:** flag as data hygiene ("orphan TEST passed with no CONFIRMS target — likely test-author error or successful spot-check"). Do NOT auto-create a BUG/CR. Let the user reclassify in Filum.

**Development assumption:** When the user provides UAT feedback referencing a BUG or CR, assume Claude Code has already completed the implementation in a separate session. Claude desktop is not automatically informed — never ask whether development was done or flag it as missing. Proceed directly to triage.

```
1. Defect signal received — two cases:
   a. User chat description.
   b. Orphan TEST object — Claude reads its body, AC checkbox state, and result.
      Treats the TEST as the user's defect description for triage.

2. Triage: recap what was reported, ask clarification questions if needed
   (wait until all answered), then determine: BUG or CR?
   Always declare the verdict explicitly before proceeding:
   "Verdict: BUG." or "Verdict: CR." or, when mixed,
   list which elements are bugs and which are change requests.

3. BUG path:
   Ask permission to continue → proceed to §5.2.2 (BUG yaml object authored + import ONLY).
   ⚠ "Proceed" = author the BUG yaml object body and stop. No code until §5.2.3 gate opens.

4. CR path:
   a. Assess impact on WBS structure and relations (challenge placement
      AND overload per Golden Rule 8, §3.6), requirements, designs, data model.
   b. If the change would push any object past an overload threshold (§3.6),
      include a split proposal in the impact assessment.
   c. Share the full picture: WBS elements to add/rename/update/cancel/
      restructure/split, links to change, designs to remove/update/create.
   d. Ask permission to continue → proceed to §5.2.2 for execution.
```

**Orphan TEST triage outputs (handed to §5.2.2):**

When the trigger is an orphan TEST (not chat), Claude's triage produces:
1. Verdict: BUG or CR (per step 2 protocol, applied to the TEST body + unchecked AC items + result).
2. Identified requirement(s) the new BUG/CR should CONFIRMS — Claude best-guesses these by mapping the unchecked AC and TEST narrative back to the requirement set.
3. Confirmation that the orphan TEST will be re-linked: a CONFIRMS relation will be added from the TEST to the new BUG/CR (so the TEST is no longer orphan post-import).
4. The new BUG/CR is created in `project-draft.yaml` (DRAFT status, with Claude-assigned priority per §3.6.2 — never null). The human can override priority in Filum review before promoting to OPEN.
5. The TEST itself stays in its current status (typically CLOSED with `result = FAIL` or `PARTIAL`, since that is what triggered triage). Claude does NOT change the TEST's `result` field.

#### 5.2.2 Change Propagation & Object Authoring

When triage in §5.2.1 produced a verdict, propagate (CR path only) and author the test-family object directly in YAML.

**CR path (only when CR approved in §5.2.1):**

```
1. Update WBS requirement objects as approved (add/rename/update/cancel/restructure)
2. Update WBS parent-child links where affected
4. Update DATA_MODEL.md / AUDIT_MODEL.md if entities/fields changed.
   Flag breaking changes to the user before proceeding.
5. Consistency check across requirements → data model
6. Author the CR object in `project-draft.yaml` in DRAFT status with
   Claude-assigned priority per §3.6.2 (never null). Same destination regardless
   of trigger (chat or orphan TEST). The human can override priority and promote
   to OPEN in Filum review. Body follows §3.8.4 template.
7. Add CONFIRMS relations from the CR → each affected requirement (paired
   CONFIRMED_BY on the requirement side).
```

**BUG path:**

```
1. Author the BUG object in `project-draft.yaml` in DRAFT status with
   Claude-assigned priority per §3.6.2 (never null). Same destination regardless
   of trigger (chat or orphan TEST). Body follows §3.8.3 template.
2. Add CONFIRMS relations from BUG → each affected requirement (paired
   CONFIRMED_BY on the requirement side).
3. If triggered by an orphan TEST: ensure the TEST → BUG CONFIRMS link
   (and the paired CONFIRMED_BY on the BUG) is in place.
```

**No `.md` reports anywhere.** All defect-tracking content lives in BUG/CR/TEST yaml object bodies. Never write `BUG-*.md` or `CR-*.md` files; never recreate `03_bug fixing/` or `05_change request/`.

**Status transition (linked requirements):**
After authoring the BUG/CR, move every CONFIRMS-linked requirement object to OPEN regardless of its current status. Then trigger Import (4.3) so Filum reflects the new BUG/CR plus the OPEN requirements before development begins.

**On completion — mandatory closing statement:**

- **BUG:** state the BUG ID + title + Claude-assigned priority and confirm: "BUG drafted in DRAFT with priority {VALUE} — awaiting human review (priority may be overridden) in Filum, then re-import." ⛔ Stop here. Do not analyse the fix, do not touch `02_code/`, do not continue reasoning toward a solution. The §5.2.3 fix gate opens only after the human promotes the BUG to OPEN in Filum and re-imports.
- **CR:** state the CR ID + title + Claude-assigned priority and confirm: "CR drafted in DRAFT with priority {VALUE} — awaiting human review of staged requirement changes (priority may be overridden) in Filum, then re-import." ⛔ Stop here. Enter §5.2.4 only after the human has approved the staged changes (CR moved to OPEN, requirement updates accepted) and re-imported AND the user explicitly references the CR by `{ID — title}` and asks to proceed. Do NOT begin development against the CR's scope before both conditions are met.

#### 5.2.3 Bug Fix (BUGs only)

**Applies to:** BUG objects from §5.2.1 (code-only defects). CR objects skip this section — their code lands via §5.2.4.

**Gate** — do not enter this section until either:
- The user explicitly references a BUG ID and asks to proceed (single mode) — "fix {BUG-ID}" satisfies this; ID alone is sufficient, title optional, OR
- The user explicitly invokes bundle mode (see "Bundle mode" below).

Generating the BUG in §5.2.2 does NOT grant permission to start the fix. Writing any code before the gate opens is a violation of Golden Rule 1.

**Inputs to the fix (single BUG):**
- The BUG yaml object's `body` (§3.8.3) + every AC object FULFILLED_BY this BUG (resolved via relations).
- Each requirement linked via CONFIRMS — read its `body` + every AC FULFILLED_BY it.
- The **latest non-cancelled TEST** linked to the BUG via CONFIRMED_BY (= TEST with the most recent `created_at`, `status != CANCELLED`). This TEST drives the scope of the fix — Claude addresses only AC objects still failing per the latest TEST (those whose `result = FAIL` or `result = null`).

**Latest-TEST snapshot rule:** capture the latest non-cancelled TEST at the start of the §5.2.3 cycle. TESTs imported mid-cycle are NOT picked up — they are consumed in the next cycle.

**Single mode (one BUG) — one cycle:**

```
1. Read inputs: BUG body + every AC FULFILLED_BY it, every CONFIRMS-linked
   requirement (and its FULFILLED_BY AC), latest non-cancelled TEST under the
   BUG (if any) plus the per-AC results recorded on the AC objects FULFILLED_BY
   that TEST. **Frontend pre-flight (§6.7) is mandatory if any
   `02_code/filum/frontend/**` file is in the fix scope.**

2. Verdict-processing — apply the latest TEST's per-AC verdicts (the human
   wrote PASS/FAIL on each AC FULFILLED_BY the TEST in Filum). Skip this step
   on the very first §5.2.3 cycle for the BUG (no TEST exists yet).
   - All AC FULFILLED_BY the latest TEST have result = PASS:
     * Filum has already cascaded each AC to CLOSED and the BUG to CLOSED via
       the FULFILLED_BY chain (DATA_MODEL.md §3.6) — verify this in the export
       and confirm the requirement(s) are CLOSED if all their AC closed.
     * Import (4.3) is not needed if Claude wrote nothing this cycle.
       End of cycle — fix is verified, exit §5.2.3.
   - Mixed PASS/FAIL on the AC FULFILLED_BY the latest TEST (TEST.result is
     PARTIAL, computed by Filum):
     * BUG stays SOLVED. PASS-marked AC are already CLOSED via cascade.
     * Continue to step 3 — the remaining FAIL/null AC define the scope.
   - All AC FULFILLED_BY the latest TEST have result = FAIL (TEST.result =
     FAIL, computed):
     * BUG stays SOLVED. No new closures.
     * Continue to step 3 — every AC under the BUG is in scope.

3. Fix the code in 02_code/ per the BUG's Technical Approach + the AC
   objects still in result = FAIL or null (or the full BUG AC set on the
   very first cycle).

4. Run smoke test + SIT against each AC object FULFILLED_BY the BUG that
   is not yet PASS. Fix failures, loop. After 3 consecutive fails on the
   same AC → skip and note the AC id in the BUG body.

5. Ensure BUG status = SOLVED (set OPEN → SOLVED on the first cycle; SOLVED
   stays SOLVED on later cycles). BUG/CR do not propagate via Golden Rule 10.
   Per Golden Rule 13, Claude MUST NOT write `AC.result` or `AC.status` here
   — AC validation is the user's job in UAT. Leave every AC FULFILLED_BY this
   BUG at its current `result` / `status`; the next TEST (verdict-processed
   in §5.2.3 step 2) is the only path that changes them.
   Import (4.3). End of cycle.

6. Report to user: what was fixed (files / functions changed), SIT results
   per AC object id. Hand over for UAT. The next §5.2.3 cycle on this BUG
   is invoked explicitly by the user — TEST arrival in the Filum export is
   passive (information only), never an automatic trigger.
```

**Bundle mode (multiple BUGs in sequence — BUG-only):**

CRs are NOT eligible for bundle mode. CR fixes always run as single-CR cycles via §5.2.4. The user can request a BUG bundle fix. Common phrasings:
- "fix all HIGH bugs"
- "fix all bugs at HIGH level"
- "fix every OPEN bug"

Bundle protocol:

```
1. List every BUG matching the user's request that is in OPEN status,
   with its priority and CONFIRMS targets. CRs are excluded from this
   listing — they cannot enter bundle mode.

   Conflict scan (mandatory, before any grouping): detect any BUG pair
   in the matching set that shares at least one CONFIRMS-linked requirement.
   If found → halt, list each conflicting pair with the shared requirement(s),
   and ask the user which conflicting part to discard so the two BUGs no
   longer touch the same requirement scope (typically by cancelling one side
   or superseding to narrow scope). Do NOT proceed to grouping or fixing
   until every conflict is resolved.

   After conflict resolution (if any), propose grouping options and ask the
   user to pick one:
     a. All BUGs at priority X
     b. All BUGs OPEN, regardless of priority
2. User picks a grouping.
3. Order the picked set by priority desc (URGENT > HIGH > MED > LOW),
   then within same priority by created_at ascending (oldest first).
4. For each BUG in order: run §5.2.3 single mode steps 1–5 (read inputs,
   verdict-processing if a prior TEST exists, fix, SIT, ensure SOLVED).
   Use the latest-TEST snapshot captured at session start for each BUG.
   Uninterrupted — no UAT between BUGs in the bundle.
5. After the entire bundle is processed, hand over to UAT in one batch.
   The user retests via new TEST objects imported into Filum.
6. Imports follow the per-defect-type rules (§5.2 intro): one import per
   BUG cycle (§5.2.2 import + §5.2.3 import). Bundle does NOT collapse imports.
7. PASS / PARTIAL / FAIL verdicts on each BUG are processed per §5.2.3 step 2
   on the next §5.2.3 invocation against that BUG (single or bundle).
```

**Exit condition:** the loop ends when every requirement object in `project-active.yaml` has all its FULFILLED_BY AC objects in `status = CLOSED` / `result = PASS` (Filum cascades the requirement itself to CLOSED in the same transaction).

#### 5.2.4 Change Request Fix (CR only)

**Applies to:** CR objects in OPEN status. BUGs use §5.2.3. CRs do NOT pass through §5.1.3 — their dev runs here with user testing between pieces.

**Gate** — do not enter this section until the user explicitly references a CR by ID and asks to proceed — "fix {CR-ID}" satisfies this; ID alone is sufficient, title optional. CRs are NOT eligible for §5.2.3 bundle mode.

**Inputs to the fix:**
- The CR yaml object's `body` (§3.8.4) + every AC object FULFILLED_BY this CR (resolved via relations).
- Each requirement linked via CONFIRMS — its `body`, AC objects FULFILLED_BY it, wireframes, and DATA_MODEL.md / AUDIT_MODEL.md sections referenced.
- The **latest non-cancelled TEST** linked to the CR via CONFIRMED_BY (= TEST with the most recent `created_at`, `status != CANCELLED`), if any. Per-AC results written by the human in Filum (against the AC objects FULFILLED_BY that TEST) ARE the user's verdict — Claude does not re-interpret PASS/FAIL.

**Latest-TEST snapshot rule:** capture the latest non-cancelled TEST at the start of the §5.2.4 cycle. TESTs imported mid-cycle are NOT picked up — they are consumed in the next cycle.

**Procedure:**

```
1. Read inputs. If a latest non-cancelled TEST exists → step 2.
   Otherwise skip to step 3. **Frontend pre-flight (§6.7) is mandatory if
   any `02_code/filum/frontend/**` file is in the fix scope.**

2. Apply latest-TEST verdict (skip on the very first §5.2.4 cycle if no
   TEST yet exists):
   - Each AC FULFILLED_BY the TEST with result = PASS is already CLOSED
     via Filum's FULFILLS cascade — verify and continue.
   - Each AC FULFILLED_BY the TEST with result = FAIL stays failing;
     the host has reverse-cascaded back to OPEN via the same engine —
     addressed in step 4.
   - Apply any chat instructions or TEST-body notes from the user.

3. Mid-fix AC adjustment exception (to §5.1.3 read-only): allowed when
   an AC object is broken (typo, contradiction, infeasibility) OR when
   the user explicitly requests a scope change in chat or in the
   latest TEST body. State the edit and propagation targets before
   writing. Propagate to: the AC object itself (title/body), CR body,
   BUG bodies, EP/FT/US bodies, TEST bodies, DATA_MODEL.md, AUDIT_MODEL.md,
   wireframes. NEVER CLAUDE.md. Applies anywhere in this section.

4. Determine remaining AC scope: every AC FULFILLED_BY the CR still in
   result = FAIL or null. If empty → step 7. Otherwise decide whether a
   dev breakdown is needed — propose one ONLY when the remaining scope
   cannot be safely delivered in a single Claude development cycle
   (quality degradation expected). Otherwise skip the proposal and go
   straight to step 5 with the full remaining scope as a single piece.
   When proposing: feature-by-feature (finer if a single feature is too
   large for one testable piece); list pieces with the AC object ids
   each covers, in dev order; wait for user approval.

5. For each piece in order:
   a. Set CR → OPEN if not already. Develop in 02_code/ against that
      piece's AC subset.
   b. Smoke test (builds, entrypoints).
   c. Set CR → SOLVED. Per Golden Rule 13, Claude MUST NOT write `AC.result`
      or `AC.status` here — AC validation is the user's job in UAT. Leave
      every AC FULFILLED_BY this CR at its current `result` / `status`; the
      next TEST (verdict-processed in §5.2.4 step 2) is the only path that
      changes them. Import (4.3).
   d. Hand the piece to the user. Wait for chat feedback OR a new
      TEST imported from Filum.
   e. Apply feedback at the AC object level:
        - AC passing per chat or per per-AC TEST result = PASS →
          already CLOSED via Filum's cascade once result = PASS is
          written; no further action by Claude.
        - AC failing per chat or per per-AC TEST result = FAIL → AC stays
          OPEN+FAIL via Filum's reverse cascade; Set CR → OPEN. Iterate
          (loop back to 5a) for the failing AC subset only.
        After 3 consecutive fails on the same AC, skip and note the AC
        object id in the CR body.
      Import (4.3) after each AC.result / status write Claude makes
      directly (otherwise Filum is already in a consistent state).
   f. Move to the next piece only after the current piece's AC are all
      CLOSED or explicitly skipped.

6. After all pieces shipped and all CR-linked AC are CLOSED or skipped:
   CR stays SOLVED. Hand over for full UAT (regression check across
   the whole CR scope).

7. Closing chat report — minimal, chat-only, no .md:
   - {CR_ID — title}
   - Pieces shipped (1 line each, AC object ids)
   - AC skipped after 3-fail rule (if any)
   - "Ready for full UAT — confirm to close."

8. On user confirmation of full UAT pass:
   - CR → CLOSED. Filum's FULFILLS cascade has already moved
     CONFIRMS-linked requirements to CLOSED if all their AC are CLOSED;
     verify in the export and apply Golden Rule 10 upward propagation
     (EP/FT/US chain) only if Filum has not done so.
   - Import (4.3).

   On user report of full UAT failure:
   - The new TEST's per-AC FAIL verdicts (or chat instructions) trigger
     Filum's reverse cascade — AC objects flip to OPEN+FAIL and hosts
     reopen automatically. Set CR → OPEN. Loop back to step 4 with the
     new failing AC subset.
```

**Status lifecycle (recap):**
- `OPEN`   = ready for dev (entry condition; re-entered on any failure).
- `SOLVED` = piece(s) shipped, awaiting user test or full UAT.
- `CLOSED` = full UAT confirmed PASS.

**Exit condition:** CR = CLOSED, or the user explicitly halts the loop.

---

## 6. Frontend Design System

Governs every change to `02_code/filum/frontend/**`. UI_SPEC.md §19 holds the elaborated reference (folder layout, naming, page-authoring contract, cross-references to UI_SPEC sections). This section governs Claude's protocol behaviour. Read both before any frontend write.

### 6.1 Atomic hierarchy

Five tiers, each with exactly one role:
- **Tokens** — sub-atomic CSS custom properties. Live in `static/css/design-system/tokens/`. 7 token files: colors, spacing, typography, radius, shadow, motion, sidebar.
- **Atoms** — smallest indivisible UI elements. 10 live: `Button` (`button.{css,html}`), `Input`, `Label`, `StatusBadge` (`badge.{css,html}`), `TypePill` (`type-pill.{css,html}` — composes per-type tinted pill / xs mono pill / letter dot), `Icon` (inline SVG / glyph wrapper), `TagChip` (object-tag pill), `NotificationDot` (counted or empty), `ResultBadge` (PASS/FAIL/PARTIAL/READY_FOR_TEST), `Spinner` (indeterminate ring). One CSS file + one Jinja2 macro per atom; each carries Filum-specific examples in its sibling `*-preview.html`.
- **Molecules** — small groups of atoms. 10 live: `FormField` (composes Label + Input), `Card`, `ObjectListRow` (composes TypePill + StatusBadge + TagChip — UI_SPEC §6), `SearchBox` (Icon + Input), `FilterChip` (Icon + text), `BadgeStack` (StatusBadge × N), `PickerBreadcrumb` (Button + text), `RowActionMenu` (Icon + dropdown items), `TagInput` (Input + TagChip + autocomplete), `NotificationItem` (Icon + text + timestamp).
- **Organisms** — complex sections. 14 live: `Header` (UI_SPEC §1.2, composes Button × N), `Sidebar` (§1.1, composes NotificationDot), `ObjectDetailPanel` (§7, composes StatusBadge + BadgeStack + TypePill), `NotificationPanel` (NotificationItem × N), `Modal` (content slot), `PickerModal` (PickerBreadcrumb + Button), `StatusDropdown` (StatusBadge × N), `DependencyPicker` (TagInput + ObjectListRow × N), `ACEditor` (StatusBadge + ResultBadge + Input), `AuditLogList` (NotificationItem × N), `SettingsTabStrip`, `Toast` (Icon), `ReviewBatch` (Card × N + Button), `ProjectListGrid` (UI_SPEC §4, Card × N with `.ds-card--clickable`).
- **Templates** — page-level skeletons. 7 live: `DashboardLayout` (composes Sidebar + Header + content slot; 3 variants: default, split, centered), `ModalLayout` (composes Modal), `PickerLayout` (composes PickerModal), `AuditLogLayout` (extends DashboardLayout + AuditLogList), `SettingsLayout` (extends DashboardLayout + SettingsTabStrip), `ProjectListLayout` (extends DashboardLayout + ProjectListGrid), `FirstRunEmptyLayout` (sidebar logo only + EmptyState centered).

**Pages** (the screens defined in UI_SPEC.md §§3–17) are NOT design-system files. Pages extend a Template, fill its blocks with real data, and import organisms/molecules/atoms from the design system.

### 6.2 Import contract

Composition flows upward; imports flow downward only.

| Level | May import from |
| :--- | :--- |
| Tokens | nothing |
| Atoms | Tokens |
| Molecules | Tokens + Atoms |
| Organisms | Tokens + Atoms + Molecules |
| Templates | Tokens + Atoms + Molecules + Organisms |
| Pages | Templates (and application data) |

Forbidden: upward imports, same-level cross-imports between siblings, circular imports. Detecting any of these is a placement defect — escalate to user with a proposed restructure.

### 6.3 Naming

CSS classes: `.ds-{component}` + BEM modifiers (`.ds-button--primary`, `.ds-card__header`). Jinja2 macros: `ds_{component}` (snake_case). CSS custom properties: `--ds-{category}-{name}`. File names: `kebab-case.{css,html}`. Aggregator files: leading underscore (`_tokens.css`, `_atoms.css`, …).

### 6.4 Adding a new component

1. Confirm no existing atom/molecule/organism covers the need (search the design-system tree first).
2. Decide the correct level per §6.1.
3. Propose to user: name + level + what it imports + why no existing component fits. Wait for explicit approval.
4. On approval: create both `static/css/design-system/{level}/{name}.css` AND `templates/_design-system/{level}/{name}.html`. Add to the level's `_aggregator.css` so `index.css` picks it up. Register in the showcase (§6.6).

Skipping this gate is a Golden Rule 14 violation.

### 6.5 Edit propagation rule

When the user asks to change how something looks, edit at the **lowest applicable level** — and only at that level. Never duplicate the change across pages. Never hardcode the new value in a page or organism.

| User intent | Edit at |
| :--- | :--- |
| Change brand color / global spacing / type scale | `tokens/{category}.css` (one variable) |
| Make all buttons rounder | `atoms/button.css` — or `tokens/radius.css` if every rounded surface is affected |
| Tweak one specific button on one page | first push back: propose a Button variant in `atoms/button.css`. Only escalate to a page-local class if the user insists. |
| Restyle a section like the sidebar | the corresponding `organisms/{name}.css` |
| Brand-new component visible only on one page | new design-system component (§6.4), NOT inline in the page |

### 6.6 Showcase and preview coverage rule

Two preview surfaces, two coverage rules:

- **Aggregate previews** — root `static/css/design-system/preview.html` and `templates/design-system-showcase.html` render every token + every atom + every molecule + every organism + every template **at least once**. They serve as the cross-component cascade view (one example per component is enough). New components must be registered here as part of §6.4.
- **Focused per-component previews** — every `static/css/design-system/{atoms,molecules,organisms,templates}/{name}-preview.html` renders **every variant + every sub-element + every state** defined in its sibling `{name}.css` file. Opening a focused preview is therefore a complete visual contract for that component — no variant defined in CSS is hidden from the preview. Group examples by category (Variants / Sub-elements / States) with `.ctx` tooltips naming the exact class being demonstrated. The legacy "3 examples per file" convention (a pre-Phase-1 scaffolding constraint) is retired by CR-260510-2200-001 — focused previews are full-coverage.

### 6.7 Mandatory pre-flight

Before writing or editing ANY file under `02_code/filum/frontend/**` in §5.1.3 / §5.2.3 / §5.2.4:

1. Read UI_SPEC.md §19 (elaborated reference).
2. Read `static/css/design-system/index.css` and the aggregator(s) for the level(s) the change touches.
3. Read every CSS or Jinja2 file the change will modify.
4. Confirm the change introduces no upward import (§6.2).
5. Confirm the change hardcodes no raw color/spacing/typography value — every visual primitive must be a `var(--ds-*)` reference.
6. If the change requires a new atom/molecule/organism, halt and follow §6.4 (propose to user, wait for approval, then create both CSS and Jinja2 files).
7. **Post-edit static checks (mandatory) — entire preview tree, every edit, no exceptions:** after writing ANY change under `02_code/filum/frontend/**` (tokens, atoms, molecules, organisms, templates, design-system aggregator, page templates, or the Flask frontend blueprint), the **entire preview tree** must be statically verified — regardless of which level the edit touched. The preview tree is fixed and exhaustive:
   - **Every** `*-preview.html` under `static/css/design-system/{atoms,molecules,organisms,templates}/` (one focused preview per component).
   - The root `static/css/design-system/preview.html` (static aggregate of every component).
   - `templates/design-system-showcase.html` (Jinja2 aggregate, served via Flask `/design-system`).
   - `templates/index.html` (production SPA shell, served via Flask `/`).
   Read each preview and confirm: (a) every `class="ds-*"` reference still maps to a rule in the affected CSS file, (b) every `var(--ds-*)` reference still resolves to a token defined in `tokens/`, (c) no class or token was renamed/deleted without the preview being updated, (d) for new variants/sub-elements/states/tokens added, the focused preview demonstrates them, (e) for the showcase and index.html specifically — no literal Jinja2 syntax (`{% %}`, `{{ }}`) leaks into the rendered HTML, every macro import resolves to an existing file under `templates/_design-system/`, and the Flask routes that render these two files exist in `02_code/filum/frontend/__init__.py`. **Full-coverage rule (§6.6):** when a new variant, sub-element, or state is added to a component's CSS file, the corresponding focused `*-preview.html` MUST be updated in the same edit cycle to include it — a missing preview row for a CSS-defined selector is a regression, not a deferred chore. If any preview surface in the tree is broken at the static-check level, fix it (restore the CSS rule, define the missing token, add the missing Flask route, update the preview's HTML) before proceeding to step 8.
8. **Post-edit visual confirmation gate (mandatory) — entire preview tree, every edit, no exceptions:** static checks (step 7) are necessary but NOT sufficient — they only verify selector and variable existence, not rendered appearance. Claude has no browser and cannot confirm how the preview actually renders. Therefore, after static checks pass, Claude MUST:
   (a) state explicitly that the entire preview tree was statically verified (per step 7 — every `*-preview.html` under `static/css/design-system/{atoms,molecules,organisms,templates}/`, root `static/css/design-system/preview.html`, `templates/design-system-showcase.html`, `templates/index.html`) and call out by name any preview where the change is visually expected to manifest;
   (b) describe in plain terms the visual change the user should expect on each affected surface (e.g., "buttons gain a 6px dot before the label", "OPEN badge background turns from sky-blue to indigo", "/design-system page now lists the 7 missing organisms");
   (c) ask the user to hard-refresh (`Ctrl+Shift+R`) each affected surface AND additionally re-open `templates/design-system-showcase.html` (via Flask `/design-system`) and `templates/index.html` (via Flask `/`) to confirm no regression has leaked into the two aggregate front doors — and confirm visually;
   (d) NOT claim the edit is complete until the user explicitly confirms every named preview surface renders correctly (or accepts the new look) AND that `design-system-showcase.html` + `index.html` both still render without regression. Phrases like "the preview should now look right" or "previews verified" are forbidden — they presume what only the user can verify.
   If the user reports a broken preview after a CSS edit, treat it as a regression: re-read the affected preview AND the affected CSS, look for an actual fault (specificity conflict, removed rule, broken token chain, layout collision, font fallback, missing Flask route, leaked Jinja2 syntax), and fix before re-asking for confirmation. Claude MUST NOT default to "it's probably browser cache" without first hunting for a real fault — cache may be the answer, but it is the LAST hypothesis to suggest, not the first.
   Skipping the visual confirmation gate, declaring an edit complete without explicit user confirmation, or omitting `design-system-showcase.html` or `index.html` from the verification sweep, is a Golden Rule 14 violation.

Failing the pre-flight is a Golden Rule 14 violation.
