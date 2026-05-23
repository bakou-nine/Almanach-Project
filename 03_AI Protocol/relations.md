# Relations (§3.4)

Externalized from `CLAUDE.md`. Section numbers match `CLAUDE.md`; a §-ref without a filename points to `CLAUDE.md`. Read before creating/editing object relations. Not under GR 11 (the byte-for-byte mirror covers only `CLAUDE.md` ↔ `01_docs/CLAUDE_template.md`).

---

### 3.4 Relations (always in pairs)

Three pair families (full validity matrix in DATA_MODEL.md §5.1):

**Historicisation** (same-type, PC/EP/FT/US/BUG/CR/AC; not allowed on TEST):

```yaml
relations:
  - { type: SUPERSEDES,    target_id: "US-..." }
  - { type: SUPERSEDED_BY, target_id: "US-..." }
```

**Test-family chain (CONFIRMS / CONFIRMED_BY)** — chain: `Requirement (PC/EP/FT/US) ← BUG | CR ← TEST`:

```yaml
relations:
  - { type: CONFIRMS,     target_id: "BUG-..." }    # on TEST
  - { type: CONFIRMED_BY, target_id: "TEST-..." }   # on BUG/CR
  - { type: CONFIRMS,     target_id: "US-..." }     # on BUG/CR (target may be PC/EP/FT/US)
  - { type: CONFIRMED_BY, target_id: "BUG-..." }    # on PC/EP/FT/US
```

| Source | Target | Relation | Cardinality on source |
| :--- | :--- | :--- | :--- |
| TEST | BUG or CR | CONFIRMS | exactly 1 (single slot) |
| BUG or CR | PC, EP, FT, or US | CONFIRMS | unlimited |
| BUG or CR | TEST | CONFIRMED_BY | unlimited |
| PC, EP, FT, or US | BUG or CR | CONFIRMED_BY | unlimited |

**AC fulfillment chain (FULFILLS / FULFILLED_BY)** — chain: `host (US|FT|BUG|CR|TEST) ← AC` (AC is the source of FULFILLS; the host carries the paired FULFILLED_BY):

```yaml
relations:
  - { type: FULFILLS,     target_id: "US-..." }    # on AC — points to its host(s)
  - { type: FULFILLED_BY, target_id: "AC-..." }    # on US/FT/BUG/CR/TEST — points to AC
```

| Source | Target | Relation | Cardinality on source |
| :--- | :--- | :--- | :--- |
| AC | US, FT, BUG, CR, or TEST | FULFILLS | unlimited, but MUST include ≥1 US or FT (permanent home, GR 18) |
| US, FT, BUG, CR, or TEST | AC | FULFILLED_BY | unlimited |

EPIC and PROJECT_CHARTER carry no AC — AC→EPIC and AC→PC FULFILLS are rejected by Filum.

**Multi-FULFILLS is canonical (GR 18).** An AC routinely FULFILLS several hosts, one slot per role it plays — none are duplicates, never drop any:
- **US/FT — permanent home (MANDATORY, GR 18):** where the AC lives forever and where readers find it on the FT/US. Required on every AC; the slots below are additive, never a replacement.
- **CR/BUG — introducing/refining recap:** the CR's (or BUG's) `Fulfilled by` pane is the UAT scope view; the requirement's is the long-term contract view. Linking the same AC to both is expected.
- **TEST — reusable verification session:** each test cycle adds a `FULFILLS → TEST-XXX` row; when the AC's `result` flips to PASS, Filum cascades that verdict to every host the AC FULFILLS (DATA_MODEL.md §3.6).

Concrete shape: an AC introduced in a CR cycle is born `FULFILLS = [US, CR]` (or `[FT, CR]`) and gains a TEST row per verification cycle — commonly 3 FULFILLS rows by the end; correct, not duplication.

**Save-blocking rules** (Filum-enforced; Claude must respect):
- TEST cannot leave DRAFT (non-null `result`) without exactly one CONFIRMS to a BUG or CR.
- BUG/CR cannot leave DRAFT (→OPEN) without ≥1 CONFIRMS to an EP, FT, or US.
- AC cannot leave DRAFT without ≥1 FULFILLS, and that set MUST include ≥1 US or FT (GR 18 — homeless AC forbidden).

**Forbidden combinations:**
- TEST → requirement direct (must go through BUG/CR).
- BUG/CR → TEST as CONFIRMS (chain is one-way; only CONFIRMED_BY valid on BUG/CR).
- TEST has no SUPERSEDES chain — replacement = new TEST instance.
- Requirements never hold CONFIRMS — only CONFIRMED_BY (passive receipt).
- AC → EPIC or AC → PROJECT_CHARTER FULFILLS (neither hosts AC).
- AC homed only on BUG/CR/TEST (homeless — GR 18).
- PROJECT_CHARTER as parent of anything but EPIC, or as child of anything (PC is root; `parent_id` always null).
- Defect cycles do NOT spawn a new AC against existing requirement behaviour — a BUG/CR refining an existing AC adds itself to that AC's FULFILLS list. Spawn a NEW AC only for genuinely new behaviour the host did not already assert.
