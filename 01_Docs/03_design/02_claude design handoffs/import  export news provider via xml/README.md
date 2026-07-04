# Handoff: Almanach — News aggregator with Sources, Filters & Projects

## Overview
Almanach is a desktop news-aggregator UI. A left sidebar organizes RSS-style **sources** into a drag-and-drop tree of **groups → subgroups**. The main pane shows a filterable **article feed**. Three features are the focus of this handoff:

1. **Filter bar** — a compact "When / Sources / Keyword" filter row above the feed, with a keyword search that supports a single **Exact match** toggle and renders each committed keyword as a removable pill.
2. **Projects** — save any article into named collections. Bookmark an article → assign it to one or more projects (or create a new project inline) → open a project to see all its saved articles.
3. **XML import / export** — export the entire source hierarchy to XML, download a blank template, or upload an XML file that replaces the whole hierarchy with no confirmation.

Everything is client-side; projects persist to `localStorage`.

## About the Design Files
The files in this bundle are **design references created in HTML + inline-Babel React** — a working prototype that shows intended look and behavior. They are **not** production code to copy verbatim. The task is to **recreate these designs in the target codebase's existing environment** (React, Vue, Svelte, SwiftUI, etc.) using its established component patterns, state layer, and styling system. If no environment exists yet, pick an appropriate stack (React + CSS Modules / Tailwind is a natural fit) and implement there.

The prototype loads React 18 + Babel from CDN and splits UI across `*.jsx` files that export components onto `window`. In a real app these become normal modules/components. Treat `data.js` as mock data standing in for an API.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, and interactions are all final. Recreate the UI pixel-accurately using the codebase's libraries. Exact tokens are listed under **Design Tokens**.

---

## Screens / Views

### 1. App shell
- **Layout**: Full-viewport CSS grid, `grid-template-rows: 44px 1fr` (topbar + shell). The shell is `grid-template-columns: 260px 1fr` (sidebar + feed).
- **Topbar** (44px tall): left = brand mark (22px rounded square, dark gradient `linear-gradient(135deg, #2d2823, #4a3f2f)`, light glyph) + wordmark "Almanach" (600, 14px). Right = green 6px sync dot + muted "Last sync · 1 min ago" (12px).
- **Background**: page `--bg: #faf7f1` (warm cream). Feed pane also `--bg`. Sidebar `--bg-2: #f6f3eb`.

### 2. Sidebar — Sources
- **Header row**: label "SOURCES" (10.5px, 600, uppercase, letter-spacing 0.09em, `--muted`) + a 22px "+" icon button (New group).
- **"All sources" row**: list icon + label + right-aligned count pill showing total article count.
- **Group block**: caret (rotates 90° when open) + editable name (double-click to rename) + count pill + hover actions (add-subgroup, rename, delete). Groups and subgroups are **draggable to reorder**; sources drag between containers.
- **Subgroup row**: smaller caret, indented to 44px, name + count + hover actions (rename, delete).
- **Source row**: drag grip (appears on hover) + colored dot (source's brand color) + name + count. Indented 28px under a group, 44px under a subgroup, 12px when ungrouped.
- **Ungrouped section**: sources not in any group, under a small "UNGROUPED" label.
- **Row states**: hover `rgba(0,0,0,0.035)`; active `background: var(--accent-soft)`, `color: var(--accent-strong)`.
- **Density**: `comfortable` = 30px row height; `compact` = 26px (a Tweak).
- **Footer**: dashed "＋ New group" CTA button.

### 3. Sidebar — Projects (NEW)
Rendered below Sources, separated by a divider.
- **Header**: "PROJECTS" label + "+" button (creates a project and immediately enters inline-rename).
- **Empty state**: italic hint "No projects yet. Click + to start one, then save articles into it." at `paddingLeft: 12`.
- **Project row**: folder icon + editable name + count pill (number of saved articles) + hover actions (rename, delete). Clicking the row opens that project in the feed. On hover the count pill is hidden and the rename/delete actions take its place.
- **Active state**: same accent treatment as source rows; folder icon turns `--accent-strong`.
- **Delete**: if the project has saved articles, confirm first ("Delete "X"? N saved articles will be removed from it.").

### 4. Feed — article list (default)
- **Header**: `feed-title` (20px, 600, letter-spacing -0.015em) + `feed-subtitle` (12.5px, `--muted`). Subtitle shows source/count context, or when filters are active: "**N** of **M** articles match · K active sources" (the count is `--ink` 600). A sync icon button sits top-right.
- **Filter bar**: see view #6.
- **Article row** (flex, `gap: 10px`, max-width 860px, bottom border `--line`):
  - Left `article-main` (flex: 1): meta line (colored dot + source name `--ink-2` 500 + "·" + relative time; all 11px `--muted`), then **title** (13.5px, 600, line-height 1.25), then **preview** (12px `--muted`, clamped to 1 line via `-webkit-line-clamp: 1`).
  - The title has class `clickable` — cursor pointer, hovers to `--accent-strong`; clicking it opens the save popover (same as the bookmark button).
  - If the article is saved to any project, a row of **folder tags** appears under the title (`article-saved-tags`): pill-shaped, accent-soft background, folder glyph + project name; clicking a tag opens that project.
  - Right `article-side`: the **bookmark button** (see view #5), with the save popover anchored to it.
- **Grouped variant**: when a group/subgroup is selected, articles are grouped under `source-section` headers (dot + source name + "N articles"); rows render `compact` (time only in meta, no source).

### 5. Bookmark button + Save-to-project popover (NEW)
- **Bookmark button**: 28×28, 7px radius, transparent by default, glyph `--muted-2`. Filled bookmark glyph + `--accent` color when the article is saved to ≥1 project. Hover → `--accent-soft` bg + `--accent-strong`. Open/active → `--accent-soft` bg.
- **Popover** (`save-menu`): absolutely positioned `top: 32px; right: 0`, 232px wide, `--surface` bg, 1px `--line-2` border, 10px radius, shadow `0 8px 28px rgba(20,16,8,0.16), 0 2px 6px rgba(20,16,8,0.08)`. Enters with a 0.12s fade+translateY(-4px). Closes on outside-mousedown or Escape.
  - **Head**: "SAVE TO PROJECT" (10.5px, 600, uppercase).
  - **List**: each project is a `menuitemcheckbox` row — an 18px checkbox (checked = `--accent` fill + white check) + project name + saved-article count. Clicking toggles the article in that project.
  - **New-project footer**: text input ("New project…") + blue **Create** button (disabled when empty). Enter or click creates a project containing this article; the input clears and refocuses so you can add several.

### 6. Filter bar (redesigned)
Single card (`--surface`, 1px `--line`, 8px radius, `padding: 8px 12px`, max-width 920px). Wraps to a second row when narrow. Three labeled groups separated by 1px vertical dividers:
- **When**: segmented control (2px inset track, `--bg-2`) with options `1d / 1w / 1m / Custom`. Selected segment gets a white surface chip with `box-shadow: 0 1px 2px rgba(20,16,8,0.06), 0 0 0 1px var(--line-2)` and 600 weight. Custom has a small calendar icon. Default selection `1w`.
- **Sources**: a read-only scope chip (pill, `--bg-2`) with a list glyph + the current selection's title (mirrors the sidebar).
- **Keyword**: a search field (30px tall, `--bg`, 7px radius) = search icon + text input + an **inline "Exact" toggle** + an **Add** button (blue when there's text). Focus ring = `border-color: var(--accent)` + `0 0 0 3px var(--accent-soft)`.
  - **Exact toggle**: a small pill-track switch **inside** the field, separated by a left border. **On by default.** On = whole-word + case-sensitive match; off = substring, case-insensitive.
  - **Keyword pills** (`kw-chips`): committed keywords render below under an "Active" label (dashed top border). Each pill (accent-soft bg, accent text, 999px radius) shows the keyword, an `exact` badge when exact is on, and an "×" remove button. Clicking a pill loads it back into the input for editing. Backspace on an empty input removes the last pill. A "Clear all" link appears with >1 pill.
  - **Tweakable pill style** via `chipStyle`: `badges` (default), `split` (segmented pill with an inline "Exact" toggle button), `underline` (typographic).

### 7. Project view (NEW)
Shown when a project is selected.
- **Header**: an accent eyebrow "▸ PROJECT" (folder glyph, 11px, 600, uppercase, `--accent-strong`), the project name as `feed-title`, and subtitle "**N** saved articles". Top-right: a `btn-ghost` "‹ Back to news" button (returns to All sources).
- **Empty state**: centered folder icon + "Nothing saved here yet" + "Browse the news, click an article's bookmark, and add it to **<project>**."
- **Article list**: same `ArticleRow` as the feed (with source meta shown), so bookmark/tags work identically here.

### 8. XML import / export (NEW)
Entry point is a **"Sources data"** button in the top-right of the topbar (`io-btn`: 28px tall, `--surface`, 1px `--line-2`, 7px radius, download glyph + label + caret). Clicking opens a 276px popover menu (`io-menu`, same shadow/enter animation as the save popover) with two labeled sections:
- **Export**
  - *Export current sources* — download glyph in a 28px tile; title + sub "N sources, full hierarchy → XML". Downloads `almanach-sources-<YYYY-MM-DD>.xml` containing the entire hierarchy.
  - *Download blank template* — file glyph; sub "Empty XML with the schema + guide". Downloads `almanach-sources-template.xml` — a virgin file with one worked example at each level and inline comments documenting every column.
- **Import**
  - *Upload XML file* — upload glyph; sub "Replaces the whole list — no confirmation". Opens a hidden `<input type="file" accept=".xml">`; on select, parses and **replaces the entire hierarchy immediately** (no dialog), then resets the selection to All sources.
- **Toast**: after any action a small toast appears top-right (`io-toast`, dark green `#10361f`/`#d7f5e3` for success, dark red `#4a1f16`/`#ffdcd2` for errors) for ~4s — e.g. "Imported 4 sources across 1 group." or a parse-error message.

Menu item tile: 28×28, `--bg-2` bg, 1px `--line` border, 7px radius, icon `--ink-2` (→ `--accent-strong` on row hover). Item title 13px/500 `--ink`; sub 11.5px `--muted`.

---

## Interactions & Behavior
- **Save an article**: click bookmark (or title) → popover → toggle a project checkbox, or type a name + Create. Toggling updates the bookmark fill and the under-title tags immediately.
- **Create project from sidebar**: "+" adds `{ name: 'New project', articleIds: [] }`, selects it, and enters inline rename.
- **Rename**: double-click a project/group/subgroup name, or use the hover rename action. Enter commits, Escape cancels, blur commits.
- **Delete project**: hover action; confirm if it has saved articles.
- **Open project**: click a project row → feed switches to project view. "Back to news" or "All sources" returns.
- **Drag & drop** (existing): reorder groups; reorder subgroups within/between groups; move sources between any container with above/below drop indicators.
- **Filtering**: `When` filters by article age; keyword pills AND together (all must match). Exact = `\b<word>\b` case-sensitive regex; loose = case-insensitive substring across title + preview + source name.
- **XML export**: serialize `state` (sources + groups + ungrouped) to the schema below; trigger a Blob download.
- **XML import**: read the file text, `DOMParser` → validate root `<almanach>` → rebuild `{ sources, groups, ungroupedSourceIds }` → replace state, no confirmation. Forgiving parse: missing `id` is auto-generated from a name slug; duplicate ids are de-duped; missing `count`/`color` get defaults (0 / a color from the default palette); unknown `<source>` attributes are preserved round-trip; invalid XML raises an error shown in the toast.
- **Popover dismissal**: outside mousedown or Escape (both the save popover and the Sources-data menu).
- **Animations**: popover/menu 0.12s ease fade/translate; toast 0.14s; most hover/color transitions 0.12s.

## State Management
Recreate this state (in the prototype it lives in `app.jsx`):
- `state` — `{ sources, groups, ungroupedSourceIds }`. `sources[]` = `{ id, name, count, color, url?, _extra? }`; `groups[]` = `{ id, name, collapsed, sourceIds[], subgroups[] }`; `subgroups[]` = `{ id, name, collapsed, sourceIds[] }`. `sources` lives here (not just in `data`) so imports can replace it.
- `selected` — a tagged union describing the current view: `{ kind: 'all' }` | `{ kind: 'source', sourceId }` | `{ kind: 'group', groupId }` | `{ kind: 'subgroup', groupId, subgroupId }` | `{ kind: 'project', projectId }`.
- `filters` — `{ when: '1d'|'1w'|'1m'|'custom', keywords: [{ id, text, exact }] }`.
- `projects` — `[{ id, name, articleIds: [] }]`. **Persisted** to `localStorage['almanach.projects']` (JSON) via an effect on change; hydrated on load with a fallback default `[{ id:'p-demo', name:'Weekly digest', articleIds: [] }]`.
- `tweaks` — density, dotStyle (`solid|ring|bar`), showCount, accent color, chipStyle.

Handlers to port: `addProject`, `renameProject`, `deleteProject`, `toggleArticleInProject(projectId, articleId)`, `createProjectWithArticle(name, articleId)`, `importHierarchy(next)` (replaces sources+groups+ungrouped from a parsed XML).

Data source: `data.js` exposes `window.ALMANACH_DATA = { sources[], groups[], ungroupedSourceIds[], articles[] }`. `sources[]` = `{ id, name, count, color }`; `articles[]` = `{ id, sourceId, title, preview, time }`. Replace with real API calls; keep the shapes or adapt the components.

**Note on `sources` in state:** the source list is held in `state.sources` (initialized from `data.sources`) so that an XML import can rewrite it. Components receive a merged `liveData = { ...data, sources: state.sources }` in place of the static `data`. `findSrc`/`ArticleRow` guard against a missing source (an article whose provider was removed by an import renders with an "Unknown source" placeholder rather than crashing).

## XML Schema (import / export)
Element **order = display order**; **nesting = hierarchy**. Sources sit inside a `<subgroup>`, directly inside a `<group>`, or inside `<ungrouped>`.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<almanach version="1">
  <group id="g-ai" name="AI" collapsed="false">
    <subgroup id="sg-gd" name="Generalist-Daily" collapsed="false">
      <source id="rundown" name="rundown.ai" count="2907" color="#f97316" url="https://…"/>
    </subgroup>
    <source id="x" name="Direct provider" count="0" color="#10b981"/>
  </group>
  <ungrouped>
    <source id="flint" name="flint.media" count="1240" color="#10b981"/>
  </ungrouped>
</almanach>
```

**Source columns**: `id` (optional; auto-slug from name if omitted), `name` (required), `count` (int, default 0), `color` (hex, default from palette), `url` (optional, preserved), plus any custom attributes (preserved round-trip). **Group/subgroup**: `id`, `name`, `collapsed` ("true"/"false"). The serializer/parser/template builder live in `io.jsx` as `serializeToXML(state)`, `parseFromXML(text)`, `buildTemplateXML()`, `downloadXML(filename, text)`.

## Design Tokens
```
Colors
--bg:            #faf7f1   (page / feed background, warm cream)
--bg-2:          #f6f3eb   (sidebar, segmented track, chips)
--bg-3:          #efeadf
--surface:       #fffdf8   (cards, popovers, filter bar)
--ink:           #1a1814   (primary text)
--ink-2:         #3a352d   (secondary text)
--muted:         #7a7166   (labels, meta)
--muted-2:       #a39a8c   (faint text, counts, placeholders)
--line:          #e7e1d4   (hairline borders)
--line-2:        #ddd5c4   (stronger borders)
--accent:        #1f6feb   (selection, primary actions)  [Tweakable: also #d97706, #10b981, #a855f7]
--accent-soft:   rgba(31,111,235,0.10)
--accent-strong: #1659c4
--danger:        #c1543b   (delete actions)

Sizing / shape
--row-h: 30px    --row-h-compact: 26px
--radius: 6px    (buttons/fields use 7px; cards 8–10px; pills 999px)
shell columns: 260px sidebar + 1fr feed; topbar 44px

Typography
--font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif
base body 13px
feed title 20px/600/-0.015em   ·   article title 13.5px/600/1.25
labels 10.5px/600/uppercase/0.09em   ·   meta & preview 11–12px
count/pill numerals use font-variant-numeric: tabular-nums

Shadows
popover: 0 8px 28px rgba(20,16,8,0.16), 0 2px 6px rgba(20,16,8,0.08)
active segment: 0 1px 2px rgba(20,16,8,0.06), 0 0 0 1px var(--line-2)

Motion
standard transition 0.12s; popover enter 0.12s ease (opacity + translateY 4px)
```

## Assets
No external image assets. All icons are inline SVG (stroke-based, `strokeWidth` ~1.4–1.6): search, calendar, list, caret, plus, pencil (rename), trash (delete), bookmark, folder, sync, back-chevron, checkmark. Source "dots" are solid color swatches driven by each source's `color` field — no logos. Recreate icons with the codebase's icon library (Lucide/Heroicons are close matches) or keep the inline SVGs.

## Files
Design reference files in this bundle:
- `Almanach.html` — entry point; loads React/Babel and the scripts in order: `data.js`, `tweaks-panel.jsx`, `io.jsx`, `sidebar.jsx`, `projects.jsx`, `filter-bar.jsx`, `feed.jsx`, `app.jsx`. Contains the `#root` mount and the `#__om-edit-overrides` style block.
- `app.jsx` — root component, all app state (incl. `state.sources` + `liveData`), localStorage persistence, project handlers, `importHierarchy`, Tweaks panel, renders the Sources-data toolbar in the topbar.
- `sidebar.jsx` — sources tree, drag & drop, inline rename (`EditableTitle`), renders the Projects section.
- `projects.jsx` — `ProjectsSection` (sidebar), `SaveToProjectMenu` (popover), bookmark/folder icons.
- `feed.jsx` — feed, `ArticleRow`, filter application (`matchesKeyword`, `articleAgeHours`), grouped view, and the project view.
- `filter-bar.jsx` — the When/Sources/Keyword filter bar, Exact toggle, keyword pills, chip-style variants.
- `io.jsx` — XML import/export: `serializeToXML`, `parseFromXML`, `buildTemplateXML`, `downloadXML`, and the `SourcesIO` topbar menu component.
- `data.js` — mock data (sources, groups, ungrouped, articles).
- `styles.css` — all styling and design tokens (`:root`). Projects/bookmark/save-menu/project-view styles and the `io-*` toolbar/menu/toast styles are at the end of the file.
- `tweaks-panel.jsx` — the in-prototype tweak controls (optional; not part of the product surface).

To run the prototype: open `Almanach.html` in a browser (needs internet for the React/Babel CDN).
