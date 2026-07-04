// Filter bar: When · Sources · Keyword (with inline match-case / whole-word modifiers)
//
// UX design notes for the keyword section (the thing we're rebuilding):
//   - Modifiers live INSIDE the input (Aa = case-sensitive, \b = whole word),
//     like VSCode/Chrome find. They are not floating sibling pills.
//   - Pressing Enter (or clicking the + button) commits a chip carrying the
//     CURRENT modifier state, so each chip remembers its own flags.
//   - Chips show their flags as small inline badges, so the user always sees
//     "this is a case-sensitive search for test" at a glance.
//   - Clicking a chip pulls it back into the input for editing (flags restored).
//   - Right edge of each chip = remove (X). Hovering a chip dims the X up.
//
// All three keyword-display layouts are exposed via the `chipStyle` prop so
// the user can compare flavors in Tweaks: 'badges' (inline icons),
// 'split' (joined chip with per-flag toggle buttons), 'underline' (typographic).

const { useState: useStateFB, useRef: useRefFB, useEffect: useEffectFB } = React;

// ---------- icons ----------

function IconCheckbox({ checked }) {
  return (
    <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
      <rect x="1" y="1" width="12" height="12" rx="2.5"
        fill={checked ? 'currentColor' : 'none'}
        stroke="currentColor" strokeWidth="1.3"/>
      {checked && (
        <path d="M3.8 7.2L6 9.2 10.2 4.8" fill="none" stroke="var(--surface, #fff)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      )}
    </svg>
  );
}

// ---------- modifier toggles (labelled toggle switches) ----------

function ModSwitch({ on, onToggle, label, hint }) {
  return (
    <button
      type="button"
      className={`mod-switch ${on ? 'on' : ''}`}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      onMouseDown={(e) => e.preventDefault()}
      title={hint}
      aria-pressed={on}
      role="switch"
      aria-checked={on}
    >
      <span className="mod-switch-track" aria-hidden="true">
        <span className="mod-switch-thumb"></span>
      </span>
      <span className="mod-switch-label">{label}</span>
    </button>
  );
}

// ---------- keyword chip ----------

function KeywordChip({ chip, chipStyle, onRemove, onEdit, onToggleFlag }) {
  // chip = { id, text, exact }
  if (chipStyle === 'split') {
    return (
      <span className={`kw-chip split ${chip.exact ? 'has-exact' : ''}`}>
        <button className="kw-chip-text" onClick={() => onEdit(chip.id)} title="Edit keyword">
          <span className="kw-chip-quote">"</span>{chip.text}<span className="kw-chip-quote">"</span>
        </button>
        <button
          className={`kw-chip-flag ${chip.exact ? 'on' : ''}`}
          onClick={() => onToggleFlag(chip.id)}
          title={chip.exact ? 'Exact match — click to make loose' : 'Toggle exact match'}
          aria-pressed={chip.exact}
        >
          Exact
        </button>
        <button className="kw-chip-x" onClick={() => onRemove(chip.id)} aria-label="Remove" title="Remove">
          <svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M2 2l6 6M8 2l-6 6"/>
          </svg>
        </button>
      </span>
    );
  }

  if (chipStyle === 'underline') {
    return (
      <span
        className={`kw-chip underline ${chip.exact ? 'is-exact' : ''}`}
        onClick={() => onEdit(chip.id)}
        title="Click to edit"
      >
        <span className="kw-chip-text-plain">{chip.text}</span>
        {chip.exact && <span className="kw-chip-flag-mini" title="Exact match">exact</span>}
        <button className="kw-chip-x" onClick={(e) => { e.stopPropagation(); onRemove(chip.id); }} aria-label="Remove">
          <svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M2 2l6 6M8 2l-6 6"/>
          </svg>
        </button>
      </span>
    );
  }

  // default: 'badges' — text + single "exact" pill when on
  return (
    <span className="kw-chip badges" onClick={() => onEdit(chip.id)} title="Click to edit">
      <span className="kw-chip-text-plain">{chip.text}</span>
      {chip.exact && (
        <span className="kw-chip-badges">
          <span className="kw-chip-badge" title="Exact match">exact</span>
        </span>
      )}
      <button className="kw-chip-x" onClick={(e) => { e.stopPropagation(); onRemove(chip.id); }} aria-label="Remove">
        <svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <path d="M2 2l6 6M8 2l-6 6"/>
        </svg>
      </button>
    </span>
  );
}

// ---------- main bar ----------

function FilterBar({ filters, setFilters, sourceScopeLabel, chipStyle = 'badges' }) {
  const [draft, setDraft] = useStateFB('');
  const [draftExact, setDraftExact] = useStateFB(true);
  const [editingId, setEditingId] = useStateFB(null);
  const inputRef = useRefFB(null);

  const whenOptions = [
    { id: '1d', label: '1d' },
    { id: '1w', label: '1w' },
    { id: '1m', label: '1m' },
    { id: 'custom', label: 'Custom', icon: true },
  ];

  const commit = () => {
    const text = draft.trim();
    if (!text) return;
    if (editingId) {
      setFilters(f => ({
        ...f,
        keywords: f.keywords.map(k => k.id === editingId
          ? { ...k, text, exact: draftExact }
          : k),
      }));
      setEditingId(null);
    } else {
      const id = 'k-' + Math.random().toString(36).slice(2, 7);
      setFilters(f => ({
        ...f,
        keywords: [...f.keywords, { id, text, exact: draftExact }],
      }));
    }
    setDraft('');
    setDraftExact(true);
    inputRef.current?.focus();
  };

  const removeChip = (id) => {
    setFilters(f => ({ ...f, keywords: f.keywords.filter(k => k.id !== id) }));
    if (editingId === id) {
      setEditingId(null);
      setDraft('');
      setDraftExact(true);
    }
  };

  const editChip = (id) => {
    const k = filters.keywords.find(x => x.id === id);
    if (!k) return;
    setEditingId(id);
    setDraft(k.text);
    setDraftExact(!!k.exact);
    inputRef.current?.focus();
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft('');
    setDraftExact(true);
  };

  const toggleChipFlag = (id) => {
    setFilters(f => ({
      ...f,
      keywords: f.keywords.map(k => k.id === id ? { ...k, exact: !k.exact } : k),
    }));
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      if (editingId) cancelEdit();
      else setDraft('');
    } else if (e.key === 'Backspace' && draft === '' && !editingId && filters.keywords.length) {
      // remove last chip when backspacing into an empty input
      const last = filters.keywords[filters.keywords.length - 1];
      removeChip(last.id);
    }
  };

  return (
    <div className="filterbar">
      {/* WHEN */}
      <div className="fb-group">
        <div className="fb-label">When</div>
        <div className="fb-seg" role="radiogroup">
          {whenOptions.map(opt => (
            <button
              key={opt.id}
              role="radio"
              aria-checked={filters.when === opt.id}
              className={`fb-seg-btn ${filters.when === opt.id ? 'on' : ''}`}
              onClick={() => setFilters(f => ({ ...f, when: opt.id }))}
            >
              {opt.icon && (
                <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4" style={{ marginRight: 4, verticalAlign: '-1px' }}>
                  <rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/>
                  <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/>
                </svg>
              )}
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="fb-divider" />

      {/* SOURCES — scope chip mirrors sidebar selection, with a quick "All" pivot */}
      <div className="fb-group">
        <div className="fb-label">Sources</div>
        <span className="fb-scope-chip" title="Selected in the sidebar">
          <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4" style={{ verticalAlign: '-1.5px' }}>
            <path d="M2 4h12M2 8h12M2 12h12"/>
          </svg>
          {sourceScopeLabel}
        </span>
      </div>

      <div className="fb-divider" />

      {/* KEYWORD */}
      <div className="fb-group fb-group-keyword">
        <div className="fb-label">Keyword</div>
        <div className={`kw-field ${editingId ? 'editing' : ''}`}>
          <span className="kw-field-icon" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4">
              <circle cx="7" cy="7" r="4.5"/>
              <path d="M10.5 10.5L14 14" strokeLinecap="round"/>
            </svg>
          </span>
          <input
            ref={inputRef}
            className="kw-field-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={editingId ? 'Edit keyword — Enter to save' : 'Filter by keyword — Enter to add'}
          />
          {/* Single inline "Exact match" toggle. On by default. */}
          <span className="kw-field-mods">
            <ModSwitch
              on={draftExact}
              onToggle={() => { setDraftExact(v => !v); inputRef.current?.focus(); }}
              label="Exact"
              hint={draftExact
                ? 'Exact match: matches the whole word, case-sensitive. Click to switch to loose match.'
                : 'Loose match: matches anywhere in the text, ignoring case. Click to switch to exact.'}
            />
          </span>
          {editingId ? (
            <button className="kw-field-action ghost" onClick={cancelEdit} title="Cancel">
              Cancel
            </button>
          ) : null}
          <button
            className={`kw-field-action ${draft.trim() ? 'primary' : 'disabled'}`}
            onClick={commit}
            disabled={!draft.trim()}
            title={editingId ? 'Save' : 'Add keyword'}
          >
            {editingId ? 'Save' : 'Add'}
          </button>
        </div>

        {filters.keywords.length > 0 && (
          <div className="kw-chips">
            {filters.keywords.map(chip => (
              <KeywordChip
                key={chip.id}
                chip={chip}
                chipStyle={chipStyle}
                onRemove={removeChip}
                onEdit={editChip}
                onToggleFlag={toggleChipFlag}
              />
            ))}
            {filters.keywords.length > 1 && (
              <button
                className="kw-chips-clear"
                onClick={() => setFilters(f => ({ ...f, keywords: [] }))}
                title="Clear all keywords"
              >
                Clear all
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

window.AlmanachFilterBar = FilterBar;
