# Defect Body Templates (§3.8.3–§3.8.5)

Externalized from `CLAUDE.md`. Read this before authoring/editing a BUG, CR, or TEST body. Section numbers match `CLAUDE.md`; a §-ref without a filename points to `CLAUDE.md`. Requirement templates (PC/EP/FT/US) → `requirement-body-templates.md`; AC authoring + format → `acceptance-criteria.md`. The host's `acceptance_criteria` field stays `null` (§3.7); AC live in AC objects wired via FULFILLED_BY. Not under GR 11.

---

## 3.8.3 BUG body template

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

- **Defect Summary (required).**
- **Affected Requirements (required, ≥1)** — must match the BUG's CONFIRMS relations.
- **Technical Approach (required)** — authored in §5.2.2; updated between cycles only if scope shifts.
- **AC via FULFILLED_BY (required, ≥1):** fix-verification AC, each a concrete observable post-fix condition. A BUG only re-asserts EXISTING behaviour, so its AC always also FULFILLS the affected requirement(s) — their permanent home (GR 18). A BUG needing an AC for behaviour no US/FT covers is new scope → re-triage to CR (§5.2.1).

## 3.8.4 CR body template

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

- **Change Summary (required).**
- **Affected Requirement Objects (required, ≥1)** — must match the CR's CONFIRMS relations.
- **Design Changes / Data Model Changes / Supersede / Scope Impact (required)** — use "(none)", do not omit headings.
- **AC via FULFILLED_BY (required, ≥1):** fix-verification AC covering the requirement updates landing correctly. Each AC also FULFILLS ≥1 US/FT (home, GR 18; multi-FULFILLS canonical, §3.4). New behaviours → new AC homed on an existing or CR-added US/FT (§5.2.2 step 1); refinements → add this CR to the existing AC's FULFILLS list.

## 3.8.5 TEST body template

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

- **Test Session (required)** — minimum: target ID + date. **Steps Performed / Expected vs Actual (required).**
- **AC via FULFILLED_BY (required, ≥1):** the TEST exercises the AC FULFILLED_BY the BUG/CR and is itself added to each of those AC's FULFILLS list (§3.4). Per-AC verdict = `AC.result` PASS/FAIL (written by the human in Filum, or by Claude mirroring per GR 13(b)); `TEST.result` is computed by Filum (§3.3), never authored.
