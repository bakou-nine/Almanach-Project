# Object Schema & Inline Content (§3.3 / §3.5)

Externalized from `CLAUDE.md`. Section numbers match `CLAUDE.md`; a §-ref without a filename points to `CLAUDE.md`. Read before creating/editing any object or writing body content. Not under GR 11 (the byte-for-byte mirror covers only `CLAUDE.md` ↔ `01_docs/CLAUDE_template.md`).

---

### 3.3 Object schema

**Locked — never write:** `id`, `project_id`, `type`, `created_at`, `created_by`.
**Auto-managed by Filum — do not write:** `cancelled_at`, `locked`.

**Priority:** Claude assigns a concrete priority (never null) on every BUG/CR/AC create or edit per §3.6.2 — a positive obligation, not a permission (Filum save-blocks BUG/CR with null priority). Human can override in Filum. AC priority uses the §3.6.2 scale adapted to the AC's role: CRITICAL = behaviour without which the host fails its core contract; HIGH = important advertised behaviour; MED = standard; LOW = nice-to-have / edge guard.

**Editable fields:**

```yaml
title:               string                   # mandatory. On AC objects, the title IS the AC sentence (one-liner).
status:              <see per-type matrix below>
result:              PASS|FAIL|PARTIAL|READY_FOR_TEST|null
                                              # TEST: PASS|FAIL|PARTIAL|null (computed by Filum from FULFILLED_BY AC results — Claude does NOT write TEST.result manually).
                                              # AC:   PASS|FAIL|READY_FOR_TEST|null. Bidirectionally coupled to AC.status (DATA_MODEL.md §3.4a).
                                              # Always null on EP/FT/US/BUG/CR.
priority:            LOW|MED|HIGH|CRITICAL    # BUG/CR/AC only — required (not null) on BUG/CR before leaving DRAFT. Claude assigns per §3.6.2; human can override in Filum.
parent_id:           string|null              # PC/EP/FT/US only. Always null on PROJECT_CHARTER (root tier). EP.parent_id references a PROJECT_CHARTER. Always null on BUG/CR/TEST/AC.
children_ids:        [string]                 # PC/EP/FT/US only. PC.children_ids holds EPICs. Always [] on BUG/CR/TEST/AC.
updated_at:          ISO8601|null             # set on every edit
updated_by:          CLAUDE_CODE|null         # set on every edit
approved_by_human:   null                     # ALWAYS null when Claude writes. Human toggles in Filum.
cancellation_reason: string|null
story_statement:     "As a..."                # USER_STORY only
tags:                [string]                 # plain names, no colors
body:                markdown (GFM)           # description + inline refs (§3.5). NEVER put AC content here. Must follow §3.8 template for its type. AC bodies follow §3.8.6.
acceptance_criteria: null                     # LEGACY field, retired by CR-260425-1837-001. Always null — AC content lives in AC objects (§3.7). Filum tolerates the legacy markdown for backward compat but Claude must NEVER author it.
relations:           [{type, target_id}]      # Three pair families (§3.4): SUPERSEDES/SUPERSEDED_BY, CONFIRMS/CONFIRMED_BY, FULFILLS/FULFILLED_BY.
```

**Per-type status matrix:**

| Type | Allowed statuses |
| :--- | :--- |
| PROJECT_CHARTER, EPIC, FEATURE, USER_STORY, BUG, CR | DRAFT, OPEN, SOLVED, CLOSED, CANCELLED |
| TEST | DRAFT, CLOSED, CANCELLED (result computed from FULFILLED_BY AC) |
| AC | DRAFT, OPEN, SOLVED, CLOSED, CANCELLED (coupled to `result`, DATA_MODEL.md §3.4a) |

**PROJECT_CHARTER constraints (CR-260504-1747-001):** exactly one PC per project (auto-created at init); no second PC; PC cannot be CANCELLED while live EP children remain (cancel/reparent children first); PC carries no AC (AC→PC FULFILLS rejected); PC has no priority and no result.

**TEST result** is COMPUTED by Filum from the AC FULFILLED_BY it (all PASS→PASS; all FAIL→FAIL; mixed→PARTIAL). Claude writes per-AC results, never `TEST.result`. Cancellation reversible from any status.

**AC status/result coupling** (DATA_MODEL.md §3.4a — bidirectional; see the table in §3.7). All transitions reversible; writing either field auto-syncs the other in one Filum-side transaction.

**ID format:** `{PREFIX}-{YYMMDD}-{HHmm}-{NNN}`, generated from current timestamp. Prefixes: PROJECT_CHARTER `PC`, EPIC `EP`, FEATURE `FT`, USER_STORY `US`, TEST `TEST`, BUG `BUG`, CR `CR`, AC `AC`.

**Status lifecycle:** any → any within the per-type matrix; Claude does not validate transitions. CANCELLED is reversible; when Claude sets CANCELLED via import, side effects (link severance, field locking) defer until the human approves. Relations are always preserved through cancellation. PC exception: cannot be CANCELLED while live EP children exist (Filum rejects with "cancel or reparent child Epics first", CR-260504-1747-001).

### 3.5 Inline body content

Bodies are GFM. Link files inline with standard markdown:

```markdown
![dashboard](01_docs/04_content/images/dashboard.png)
[meeting notes](01_docs/04_content/html/kickoff.html)
[wireframe](01_docs/03_design/01_wireframes/S05_create_form.png)
```

- Paths relative to project root, forward slashes.
- Allowed: `.png .jpg .jpeg .webp` (in `04_content/images/` or `03_design/`), `.html` (in `04_content/html/` or `03_design/`). `https://` URLs allowed but discouraged.
- **Revision Notes:** Filum may auto-append a "Revision Notes" section when a human supersedes an object. Read-only — never author or modify it.
