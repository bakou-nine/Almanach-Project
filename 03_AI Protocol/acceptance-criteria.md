# Acceptance Criteria — Authoring & Format (§3.7 / §3.8.6)

Externalized from `CLAUDE.md`. Read this before authoring/editing any AC object. Section numbers match `CLAUDE.md`; a §-ref without a filename points to `CLAUDE.md` (AC rules, linking model, and the status/result coupling table live in `CLAUDE.md` §3.7). Body templates → `requirement-body-templates.md` / `defect-body-templates.md`. Not under GR 11.

---

## 3.7 Authoring an AC object (YAML skeleton)

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
  priority: LOW|MED|HIGH|CRITICAL  # Claude assigns per §3.6.2 adapted to AC role; human can override
  updated_at: '2026-05-03T15:30:00'
  updated_by: CLAUDE_CODE
  approved_by_human: null         # always null when Claude writes
  cancellation_reason: null
  tags: []
  body: |                         # follow §3.8.6: BOTH sections REQUIRED on author/update — no stubs
    ## Description
    {one-paragraph context — what surface this AC touches, which host requirement it derives from, any §reference}

    ## Test Instructions
    1. {step}
    2. {step — expected result if non-obvious}
  acceptance_criteria: null       # AC objects themselves carry null here (legacy field)
  relations:
    - { type: FULFILLS, target_id: "US-..." }   # MANDATORY ≥1 US or FT — the permanent home (GR 18)
    - { type: FULFILLS, target_id: "CR-..." }   # additive: the BUG/CR introducing/refining this AC (never the sole link)
```

---

## 3.8.6 AC body template

The AC `title` carries the AC sentence (one-liner). **Both body sections are REQUIRED on every author/update** — no empty stubs, no headings-only. The body is the surface the human tester reads during UAT.

```markdown
## Description

{What behaviour this AC asserts. One short paragraph. Reference the host's body or DATA_MODEL.md / UI_SPEC.md sections instead of repeating them.}

## Test Instructions

1. {step}

2. {step — expected result where non-obvious}
```

- **Description (required):** one or two sentences stating the AC's **goal and desired outcome** in context (surface touched, host requirement / §number / object ID it derives from, edge case asserted). Describe the goal, not the steps. Brief is fine; never empty.
- **Test Instructions (required — the higher-priority section):** concrete GUI steps a tester follows to verify the AC. **Markdown numbered list REQUIRED — never prose, comma-separated, or one run-on line.** Format rules: (a) a blank line MUST precede the first `1.` AND separate every consecutive step — Filum's renderer collapses a list to one paragraph otherwise; (b) one step per `N.` item on its own line — never two actions joined by comma/semicolon; (c) numbering starts at `1.`, increments by one, no gaps; (d) each step is the action + (where non-obvious) expected result, inline `(expected: …)` encouraged; (e) trivially-observable AC = `1. {observation}` (still a numbered list); (f) **YAML serialization MUST use block-literal `body: |`** — single-quoted scalar style folds blank lines and silently breaks rule (a) (looks correct in source, renders as one paragraph). Cover the happy path plus any boundary the AC asserts. Rendered surface: UI_SPEC.md §7.1a.1.

**AC content rules (every author/update):**
- **Permanent home required (GR 18):** ≥1 US/FT in the FULFILLS set; resolve the home before the AC leaves DRAFT; homeless AC forbidden.
- **GUI-testable only:** every step is an action the user performs and confirms with their own eyes in the Filum GUI — NO DB/yaml/server-log/devtools/API/back-end/audit-row assertions. If only confirmable below the GUI, drop it or restate as the visible GUI consequence.
- **Only meaningful AC — no filler:** one important user-observable behaviour each; no trivial/redundant/self-evident AC; never duplicate an existing AC's behaviour (§3.4 dedup).
- **Title = the clearest assertion:** name the surface, trigger, and expected observable result in one specific line (good: "Saving a story with an empty Title shows inline error 'Title is required' and keeps the form open"). Avoid "works correctly".
- **Instructions = clear, concrete, ordered:** a tester who has never seen the feature follows them without guessing.

Both sections are written for the human tester (readable prose / steps, not shorthand), GR 9 still applying (dense, no filler, no repeating the title). FULFILLS targets show in the AC's Dependencies pane — never list them in the body.

---

## 3.7 Rules, linking model & status/result coupling

Per CR-260425-1837-001, every AC is a full YAML object (`type: AC`) with its own `id`, `status`, `result`, `priority`, `body`, `relations`, stored flat under the top-level `acceptance_criteria:` key (same shape as `tests:` / `bugs:` / `change_requests:`). AC do not participate in the parent/child tree (`parent_id`/`children_ids` null/empty). The host's `acceptance_criteria` field stays `null` everywhere (legacy markdown form, retired — Claude must NEVER author it). Authoritative schema: DATA_MODEL.md §3.4a (entity + coupling), §3.6 (Filum-side closure cascade), §5.1 (FULFILLS validity).

**Linking model.** An AC carries ≥1 `FULFILLS` to its host(s); the paired `FULFILLED_BY` is mirrored on each host. Per GR 18 the set MUST include ≥1 US/FT (permanent home); BUG/CR/TEST links are additive. One AC / multiple FULFILLS is canonical (§3.4): typically the US/FT that introduced it, plus any BUG/CR refining it, plus the TEST(s) verifying it — defect cycles add themselves to the existing AC's FULFILLS list rather than spawning duplicates. Genuinely **new** behaviour DOES spawn fresh AC, each homed on a US/FT (existing if one fits, else create/extend per §5.2.2 step 1; a BUG introducing new behaviour re-triages to CR). **Save-blocking** (mirrors §3.4): an AC cannot leave DRAFT without ≥1 FULFILLS including ≥1 US/FT (no homeless AC); and any host whose §3.8 template marks "FULFILLED_BY → AC (required, ≥1)" MUST carry that FULFILLED_BY list.

**Status / result coupling** (DATA_MODEL.md §3.4a — bidirectional; writing either field auto-syncs the other; Filum cascades closure forward `AC → host → parent → grandparent` and reverses regressions back up — Claude writes AC.result, Filum propagates):

| `result` | `status` | Meaning |
| :--- | :--- | :--- |
| `null` | `DRAFT` | Initial, FULFILLS not yet linked. |
| `null` | `OPEN` | Authored, FULFILLS ≥ 1, awaiting test. |
| `READY_FOR_TEST` | `SOLVED` | Implementation done, ready for UAT. |
| `PASS` | `CLOSED` | Verified by TEST. |
| `FAIL` | `OPEN` | Verified failing — host re-opens via reverse cascade. |

**Verdict-processing (§5.2.3/§5.2.4):** TEST passes an AC → write `result: PASS` (Filum auto-sets CLOSED, cascades to all FULFILLS hosts); TEST fails → `result: FAIL` (Filum auto-sets OPEN, reverse-cascades); not yet tested → leave `result: null`.

**Counting AC:** count the host's `FULFILLED_BY` to live (non-cancelled) `AC-` objects. **TEST aggregate result is computed**, never authored (§3.3).

**`#N` cross-references:** cite an AC by its full `AC-...` id. The legacy `{REQ_ID}#N` form is retained ONLY for a host's pre-CR-260425-1837-001 inline-markdown AC not yet migrated.
