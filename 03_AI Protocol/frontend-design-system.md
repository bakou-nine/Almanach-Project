# Frontend Design System (§6)

Externalized from `CLAUDE.md`. **MANDATORY: read this (and UI_SPEC.md §19) before writing/editing ANY file under `02_code/filum/frontend/**` in §5.1.3/§5.2.3/§5.2.4, and run the §6.7 pre-flight steps 1–8.** Section numbers match `CLAUDE.md`; a §-ref without a filename points to `CLAUDE.md` (GR 14 carries the always-on gist). Not under GR 11.

---

## 6.1 Atomic hierarchy

Five tiers, each with one role:
- **Tokens** — sub-atomic CSS custom properties. `static/css/design-system/tokens/`. 7 files: colors, spacing, typography, radius, shadow, motion, sidebar.
- **Atoms** — smallest indivisible elements. 10 live: `Button` (`button.{css,html}`), `Input`, `Label`, `StatusBadge` (`badge.{css,html}`), `TypePill` (`type-pill.{css,html}` — per-type tinted pill / xs mono pill / letter dot), `Icon`, `TagChip`, `NotificationDot`, `ResultBadge` (PASS/FAIL/PARTIAL/READY_FOR_TEST), `Spinner`. One CSS + one Jinja2 macro each; Filum-specific examples in the sibling `*-preview.html`.
- **Molecules** — small groups of atoms. 10 live: `FormField` (Label+Input), `Card`, `ObjectListRow` (TypePill+StatusBadge+TagChip — UI_SPEC §6), `SearchBox` (Icon+Input), `FilterChip` (Icon+text), `BadgeStack` (StatusBadge×N), `PickerBreadcrumb` (Button+text), `RowActionMenu` (Icon+dropdown), `TagInput` (Input+TagChip+autocomplete), `NotificationItem` (Icon+text+timestamp).
- **Organisms** — complex sections. 14 live: `Header` (UI_SPEC §1.2, Button×N), `Sidebar` (§1.1, NotificationDot), `ObjectDetailPanel` (§7, StatusBadge+BadgeStack+TypePill), `NotificationPanel` (NotificationItem×N), `Modal`, `PickerModal` (PickerBreadcrumb+Button), `StatusDropdown` (StatusBadge×N), `DependencyPicker` (TagInput+ObjectListRow×N), `ACEditor` (StatusBadge+ResultBadge+Input), `AuditLogList` (NotificationItem×N), `SettingsTabStrip`, `Toast` (Icon), `ReviewBatch` (Card×N+Button), `ProjectListGrid` (UI_SPEC §4, Card×N `.ds-card--clickable`).
- **Templates** — page-level skeletons. 7 live: `DashboardLayout` (Sidebar+Header+content slot; 3 variants default/split/centered), `ModalLayout`, `PickerLayout`, `AuditLogLayout` (extends DashboardLayout + AuditLogList), `SettingsLayout` (+ SettingsTabStrip), `ProjectListLayout` (+ ProjectListGrid), `FirstRunEmptyLayout` (sidebar logo only + EmptyState centered).

**Pages** (UI_SPEC.md §§3–17) are NOT design-system files: they extend a Template, fill its blocks with real data, and import organisms/molecules/atoms.

## 6.2 Import contract

Composition flows upward; imports flow downward only.

| Level | May import from |
| :--- | :--- |
| Tokens | nothing |
| Atoms | Tokens |
| Molecules | Tokens + Atoms |
| Organisms | Tokens + Atoms + Molecules |
| Templates | Tokens + Atoms + Molecules + Organisms |
| Pages | Templates (and application data) |

Forbidden: upward imports, same-level sibling cross-imports, circular imports. Detecting any of these is a placement defect — escalate with a proposed restructure.

## 6.3 Naming

CSS classes `.ds-{component}` + BEM (`.ds-button--primary`, `.ds-card__header`). Jinja2 macros `ds_{component}` (snake_case). CSS custom properties `--ds-{category}-{name}`. File names `kebab-case.{css,html}`. Aggregators have a leading underscore (`_tokens.css`, `_atoms.css`, …).

## 6.4 Adding a new component

```
1. Confirm no existing atom/molecule/organism covers the need (search the tree first).
2. Decide the correct level per §6.1.
3. Propose to user: name + level + what it imports + why no existing component fits.
   Wait for explicit approval.
4. On approval: create BOTH static/css/design-system/{level}/{name}.css AND
   templates/_design-system/{level}/{name}.html. Add to the level's _aggregator.css
   so index.css picks it up. Register in the showcase (§6.6).
```

Skipping this gate violates GR 14.

## 6.5 Edit propagation rule

Change how something looks at the **lowest applicable level**, and only there. Never duplicate the change across pages; never hardcode the new value in a page or organism.

| User intent | Edit at |
| :--- | :--- |
| Change brand color / global spacing / type scale | `tokens/{category}.css` (one variable) |
| Make all buttons rounder | `atoms/button.css` — or `tokens/radius.css` if every rounded surface is affected |
| Tweak one specific button on one page | first push back: propose a Button variant in `atoms/button.css`. Only escalate to a page-local class if the user insists. |
| Restyle a section like the sidebar | the corresponding `organisms/{name}.css` |
| Brand-new component visible only on one page | new design-system component (§6.4), NOT inline in the page |

## 6.6 Showcase and preview coverage rule

- **Aggregate previews** — root `static/css/design-system/preview.html` and `templates/design-system-showcase.html` render every token + atom + molecule + organism + template **at least once** (cross-component cascade view; one example each is enough). New components are registered here as part of §6.4.
- **Focused per-component previews** — every `{atoms,molecules,organisms,templates}/{name}-preview.html` renders **every variant + sub-element + state** defined in its sibling `{name}.css`. A focused preview is the complete visual contract for that component. Group by Variants / Sub-elements / States with `.ctx` tooltips naming the exact class. The legacy "3 examples per file" convention is retired (CR-260510-2200-001) — focused previews are full-coverage.

## 6.7 Mandatory pre-flight

Before writing/editing ANY file under `02_code/filum/frontend/**` in §5.1.3/§5.2.3/§5.2.4:

```
1. Read UI_SPEC.md §19.
2. Read static/css/design-system/index.css + the aggregator(s) for the level(s) touched.
3. Read every CSS/Jinja2 file the change will modify.
4. Confirm no upward import (§6.2).
5. Confirm no hardcoded raw color/spacing/typography value — every primitive is var(--ds-*).
6. If a new atom/molecule/organism is needed, halt and follow §6.4 (propose, wait,
   then create both CSS and Jinja2 files).
```

7. **Post-edit static checks (mandatory) — entire preview tree, every edit, no exceptions.** After ANY change under `02_code/filum/frontend/**` (tokens/atoms/molecules/organisms/templates, the aggregator, page templates, or the Flask blueprint), statically verify the **entire** preview tree regardless of which level was touched. The tree is fixed and exhaustive: every `*-preview.html` under `static/css/design-system/{atoms,molecules,organisms,templates}/`; root `static/css/design-system/preview.html`; `templates/design-system-showcase.html` (Flask `/design-system`); `templates/index.html` (Flask `/`). Confirm: (a) every `class="ds-*"` still maps to a rule in the affected CSS; (b) every `var(--ds-*)` still resolves to a token in `tokens/`; (c) no class/token renamed/deleted without the preview being updated; (d) new variants/sub-elements/states/tokens are demonstrated in the focused preview; (e) for the showcase and index.html — no literal Jinja2 (`{% %}`, `{{ }}`) leaks into rendered HTML, every macro import resolves to an existing file under `templates/_design-system/`, and the Flask routes rendering these two files exist in `02_code/filum/frontend/__init__.py`. **Full-coverage rule (§6.6):** a new CSS variant/sub-element/state requires its focused `*-preview.html` updated in the same edit cycle — a missing preview row for a defined selector is a regression. Fix any broken preview surface (restore the rule, define the token, add the route, update the HTML) before step 8.

8. **Post-edit visual confirmation gate (mandatory) — entire preview tree, every edit, no exceptions.** Static checks verify selector/variable existence, not rendered appearance, and Claude has no browser. So after step 7 passes, Claude MUST:
   (a) state that the entire preview tree was statically verified (per step 7) and name any preview where the change is visually expected to manifest;
   (b) describe in plain terms the visual change to expect on each affected surface (e.g., "buttons gain a 6px dot before the label", "OPEN badge background turns sky-blue → indigo");
   (c) ask the user to hard-refresh (`Ctrl+Shift+R`) each affected surface AND re-open `design-system-showcase.html` (`/design-system`) and `index.html` (`/`) to confirm no regression leaked into the two aggregate front doors — and confirm visually;
   (d) NOT claim the edit complete until the user explicitly confirms every named preview renders correctly (or accepts the new look) AND that showcase + index.html still render without regression. "The preview should now look right" / "previews verified" are forbidden — they presume what only the user can verify. "Complete" here = CLOSED-grade confirmation of appearance; it does NOT mean SOLVED (per GR 17 the in-scope object is already SOLVED + imported BEFORE this gate). This gate verifies appearance only and NEVER withholds/defers/reverses SOLVED; a fault found here becomes the next fix cycle (or a TEST FAIL), it does not un-SOLVE the work.
   If the user reports a broken preview after a CSS edit, treat it as a regression: re-read the affected preview AND CSS, hunt for a real fault (specificity conflict, removed rule, broken token chain, layout collision, font fallback, missing Flask route, leaked Jinja2), and fix before re-asking. Do NOT default to "it's probably browser cache" before hunting — cache is the LAST hypothesis, not the first.

Skipping the visual confirmation gate, declaring an edit complete without explicit user confirmation, or omitting showcase/index.html from the sweep, violates GR 14. Failing the pre-flight violates GR 14.
