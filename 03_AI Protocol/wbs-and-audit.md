# WBS Hierarchy & Health Audit (§3.6 / §4.6)

Externalized from `CLAUDE.md`. Section numbers match `CLAUDE.md`; a §-ref without a filename points to `CLAUDE.md`. Read for level/overload placement (GR 8) and when running the WBS Health Audit (Session Start §4.1, or on request). Not under GR 11 (the byte-for-byte mirror covers only `CLAUDE.md` ↔ `01_docs/CLAUDE_template.md`).

---

### 3.6 WBS hierarchy definitions

Two families, both subject to placement + overload checks under GR 8:
- **Requirement family (PC/EP/FT/US):** linked via parent/child (`parent_id`, `children_ids`).
- **Test-family (BUG/CR/TEST):** linked via CONFIRMS/CONFIRMED_BY (§3.4). No parent/child.

When Claude identifies a misplacement or overload, it reports the specific objects, the distinct concerns/counts, and a proposed restructure, then waits for user approval before touching any yaml.

#### 3.6.1 Requirement family (PC / EP / FT / US)

Every object must sit at the level matching its actual scope:

| Level | What it is | Scale | Typical timeline |
| :--- | :--- | :--- | :--- |
| **Project Charter** | Project-wide vision and strategic goals — single root of the WBS | Project-spanning | Full project lifetime |
| **Epic** | High-level business goal/capability under the charter | Broad, cross-cutting | Months / quarters |
| **Feature** | Distinct functionality delivering part of an epic | Medium, self-contained | Multiple sprints |
| **User Story** | Small, testable requirement a dev finishes in isolation | Narrow, one behaviour | 1–3 days (human dev time) |

**Placement challenges:**
- "User story" taking >a few days or touching multiple app areas → probably a feature. Split.
- "Feature" that is one screen/one action → probably a user story. Demote.
- "Epic" with no sub-features reading like one capability → probably a feature. Demote.
- "Feature" spanning multiple business goals → probably an epic. Promote.
- Always exactly one Project Charter — never propose a second (Filum rejects it). If the charter's scope feels split, restructure its child epics.

**Overload (correctly placed but doing too much).** Placement asks "right level?"; overload asks "too much *for* its level?" Both must pass. AC counts = `FULFILLED_BY` to live (non-cancelled) `AC-` objects.

*Quantitative red flags:*
- **User Story:** >15 AC, OR body describes >1 distinct UI flow / interaction pattern / backend concern.
- **Feature:** >20 AC, OR child stories share duplicated AC (extract the cross-cutting capability instead), OR scope maps to >1 independently testable capability.
- **Epic:** >8 features, OR features serve clearly different business goals (test: two non-overlapping "As a user I can…" sentences each justifying their own epic).
- **Project Charter:** >12 epics (consider splitting into separate projects), OR Strategic Goals conflate >1 cohesive product narrative.

*Qualitative red flags:*
- **Concern mixing:** one object bundles layout/styling, data logic, file I/O, validation as if one behaviour → separate stories.
- **Cross-cutting duplication:** the same capability (picker modal, resizable panel, inline-save) appears in sibling stories with duplicated AC → extract it, or prefer one AC FULFILLS-linked to multiple hosts (§3.4) over duplicate AC objects.
- **Empty shells:** a story with no `FULFILLED_BY → AC` and no `story_statement` is a placeholder — flag it.

#### 3.6.2 Test-family (BUG / CR / TEST)

| Type | What it is | Scale |
| :--- | :--- | :--- |
| **BUG** | Code defect — behaviour deviates from the existing requirement, no scope change | Narrow, code-only |
| **CR** | Change request — requirement scope change (add/modify/remove behaviour, design, data model) | Variable |
| **TEST** | Single UAT or SIT round confirming whether a BUG/CR fix landed | Narrow, one cycle |

**Placement rules:**
- Defect needing **only code** to align with the existing requirement → BUG.
- Defect requiring a **requirement change** (AC, body, designs, data model, supersede) → CR.
- Request adding new behaviour without superseding existing AC → CR (not US — §5.2.1 drives this).
- Test session targeting a specific BUG/CR → TEST. TESTs never target requirements directly.

**Priority scale (BUG/CR — Claude assigns on create per §5.2.2; human can override):**

| Priority | BUG meaning | CR meaning |
| :--- | :--- | :--- |
| `URGENT` | Blocks entire functionality, no workaround | Cross-functionality impact + most US within those impacted, OR adds an entirely new functionality |
| `HIGH` | Blocks entire functionality but workaround exists | Entire functionality to be reviewed with most of its US |
| `MED` | Blocks a piece of functionality | Significant amount of US within the same functionality to be reviewed |
| `LOW` | Minor UX issue, marginal function blocked | Single US or small pieces of US to be reviewed |

**Overload (test-family).** AC counts as above.
- **BUG:** >15 AC, OR body covers >1 root cause / fix surface (split, each with its own CONFIRMS).
- **CR:** >20 AC, OR scope spans >1 functionality (split into multiple CRs).
- **TEST:** >15 AC, OR body covers >1 environment / configuration.
- **Empty shells:** BUG/CR with no CONFIRMS or no `FULFILLED_BY → AC`; TEST with no CONFIRMS to a BUG/CR or no `FULFILLED_BY → AC`; AC with no FULFILLS (orphan, DATA_MODEL.md §3.6). These cannot leave DRAFT — surface them (orphan TESTs trigger §5.2.1, see §4.6).
- **Wrong family:** BUG that actually needs a requirement change → re-triage as CR; CR that is purely code-aligned → re-triage as BUG.

### 4.6 WBS Health Audit

Triggered automatically at Session Start (§4.1) and on any user request to review/assess the WBS. Runs against draft, active, closed (skip cancelled). Counts use live (non-cancelled) AC objects; the legacy `acceptance_criteria` markdown field is ignored for counts.

```
1. Count per object: AC (FULFILLED_BY → live AC-); children; body concerns;
   CONFIRMS (test-family); FULFILLS (on AC).
2. Flag every object that trips a §3.6 threshold:
   - Story: >15 AC, or multiple distinct concerns in body, or no FULFILLED_BY → AC / no story_statement,
     or body missing "Data model fields touched" / "Spec reference" (§3.8),
     or interactive story missing error-state AC (§3.8.2)
   - Feature: >20 AC, or duplicated AC objects across child stories (use multi-FULFILLS instead),
     or >1 independent capability, or no FULFILLED_BY → AC at all (§3.8.1)
   - Epic: >8 features, or features serving different business goals,
     or parent_id null (orphan EP — reparent under the project's PC, CR-260504-1747-001)
     (EPIC must NOT carry FULFILLED_BY → AC — flag if it does)
   - Project Charter: >12 epics, OR Strategic Goals conflate >1 product narrative
     (PC must NOT carry FULFILLED_BY → AC — flag if it does), OR project has zero or >1 PC
     (single-PC invariant violated — auto-create or migrate, CR-260504-1747-001)
   - BUG: >15 AC, body covers >1 root cause, no CONFIRMS link to any requirement,
     no FULFILLED_BY → AC, missing required body sections (§3.8.3)
   - CR: >20 AC, scope spans >1 functionality, no CONFIRMS link to any requirement,
     no FULFILLED_BY → AC, missing required body sections (§3.8.4)
   - TEST: >15 AC, body covers >1 environment, no CONFIRMS link to any BUG/CR,
     no FULFILLED_BY → AC, missing required body sections (§3.8.5).
     Note: TEST.result is computed — flag if it has been hand-written.
   - AC: no FULFILLS link (orphan — cannot leave DRAFT; data hygiene flag),
     OR FULFILLS set has no US and no FT (HOMELESS — GR 18 violation, re-home on a US/FT),
     or status/result coupling violated (e.g. result=PASS with status=OPEN),
     or body missing §3.8.6 sections, or sections present but EMPTY / headings-only
     (both Description and Test Instructions must be populated — §3.8.6 + §5.1.1)
   - Orphan TEST with result = FAIL or PARTIAL → §5.2.1 triage trigger
   - Orphan TEST with result = PASS → data hygiene flag, no auto-action
   - Host with non-null legacy `acceptance_criteria` markdown field → data hygiene flag (migrate)
3. Present a structured report:
   a. OVERLOADED: {id, title, AC count, concerns mixed}
   b. EMPTY SHELLS: stories with no FULFILLED_BY → AC or no story_statement;
      BUG/CR/TEST with no CONFIRMS or no FULFILLED_BY → AC; AC with no FULFILLS
   c. TEMPLATE GAPS: stories missing §3.8 sections; features with no FULFILLED_BY → AC (§3.8.1);
      interactive stories missing error-state AC (§3.8.2); BUG/CR/TEST missing required body sections;
      AC missing §3.8.6 headings; hosts authoring legacy markdown in `acceptance_criteria`
   d. CROSS-CUTTING: capabilities duplicated across siblings (consolidate via multi-FULFILLS)
   e. LEVEL MISPLACEMENT: objects at the wrong level per §3.6 (incl. BUG-vs-CR misplacement)
   f. ORPHAN TESTS: list with result value (which trigger §5.2.1)
   g. ORPHAN AC: list AC with no FULFILLS (re-link or cancel)
   h. HOMELESS AC: list AC whose FULFILLS are all BUG/CR/TEST (re-home on a US/FT, GR 18)
4. For each finding, propose the specific action (split, merge, promote, demote, extract, re-triage, link, re-home, migrate)
5. Wait for user direction before touching any yaml
```

**At Session Start:** run silently. If findings exist, present a brief summary: "I ran a WBS health check and found N issues — [1-line summary]. Address now or proceed with your request?" If none, proceed without mention. **On explicit request:** run the full audit and present the complete report.

---
