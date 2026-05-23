# Requirement Body Templates (§3.8)

Externalized from `CLAUDE.md`. Read this before authoring/editing a PROJECT_CHARTER, EPIC, FEATURE, or USER_STORY body, or any feature-level / error-state AC. Section numbers match `CLAUDE.md`; a §-ref without a filename points to `CLAUDE.md`. Defect templates (BUG/CR/TEST) → `defect-body-templates.md`; AC authoring + format → `acceptance-criteria.md`; frontend → `frontend-design-system.md`. Not under GR 11.

Every object's `body` follows its type template. Sections marked **(required)** must be present before the object leaves DRAFT. Across ALL templates, the host's `acceptance_criteria` field stays `null` (§3.7); AC live in AC objects wired via FULFILLED_BY.

---

## Project Charter body template

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

- **Project Vision / Strategic Goals (required):** the elevator pitch + measurable outcomes that drive epic prioritisation.
- **Epic Navigation Flows (required once epics exist):** map each child EPIC to its UI entry point; `(none yet)` until then.
- **Out of scope / Reference documents (required).**
- **AC:** none — PC carries no AC and no `FULFILLED_BY → AC` (AC→PC FULFILLS rejected, CR-260504-1747-001). Exactly one PC per project, auto-created at init; never propose a second.

## Epic body template

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

- **Feature Navigation Flows (required):** map each child feature (of THIS epic) to its UI entry point.
- **Out of scope / Reference documents (required).**
- **AC:** none — EPIC carries no AC and no `FULFILLED_BY → AC` (AC→EPIC FULFILLS rejected, CR-260425-1837-001).

## Feature body template

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

- **Wireframes (required once design runs):** real boards; `(pending §5.1.2)` as placeholder only until then.
- **Out of scope / Reference documents (required)** — specific subsections, not just top-level.
- **AC via FULFILLED_BY (required, ≥1):** feature-level AC for cross-story integration + regression guards (§3.8.1).

## User Story body template

```markdown
{Scope paragraph — what this story handles and what is split out to siblings.}

**Data model fields touched:**
- `{Entity.field}` ({read|write|both}) — {brief context}
- `{AuditEvent.EVENT_NAME}` (write on {trigger})

**Spec reference:** UI_SPEC.md §{N.N} ({subsection title}), §{N.N} ({subsection title})
```

- **Scope paragraph (required):** what this story covers and what is delegated to siblings.
- **Data model fields touched (required):** every DATA_MODEL.md field read/written + audit events triggered (lets Claude target implementation without re-reading the full Feature body).
- **Spec reference (required):** the specific UI_SPEC.md subsection(s) for this story (DATA_MODEL.md subsection for backend-only stories).
- **`story_statement` (required):** `As a {role}, I want {single action}, so that {complete business outcome}.` — all three segments complete; a truncated "so that" is a drafting defect.
- **AC via FULFILLED_BY (required, ≥1):** every happy-path behaviour AND, for interactive stories, ≥1 error-state AC (§3.8.2).

---

## 3.8.1 Feature-level acceptance criteria

Every feature needs ≥1 AC object FULFILLED_BY it, covering:
1. **Cross-story integration:** behaviour spanning multiple child stories with no single owner (e.g. "creating an object opens it immediately in the detail panel").
2. **Regression guard:** "No regressions in sibling features sharing the same screen or panel."

Feature AC must NOT duplicate child-story AC (§3.4 dedup — add the feature to an existing AC's FULFILLS list instead).

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

## 3.8.2 Error-state acceptance criteria (User Stories)

Any user story with interaction (form submit, button click, API call, navigation) needs ≥1 error-state AC FULFILLED_BY it alongside the happy-path AC. Purely display (view-only) stories are exempt. Cover whichever apply: **validation failure** (message + location + form state), **save/API failure** (toast/notification + whether data is retained), **boundary hit** (behaviour at the exact limit).

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
