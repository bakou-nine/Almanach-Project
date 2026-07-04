// Projects: save articles into named collections.
//
// - ProjectsSection renders in the sidebar under Sources. Create/rename/delete
//   projects; click one to view its saved articles in the feed.
// - SaveToProjectMenu is the popover that opens from an article's bookmark
//   button (or its title). Lists projects as checkboxes + inline "new project".
//
// State lives in app.jsx (persisted to localStorage) and is threaded down.

const { useState: useStateProj, useRef: useRefProj, useEffect: useEffectProj } = React;

// ---------- icons ----------

function IconBookmark({ filled }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M4 2.5h8v11l-4-2.6-4 2.6z" />
    </svg>
  );
}

function IconFolder() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M2 4.5h4l1.2 1.4H14V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
    </svg>
  );
}

// ---------- Save-to-project popover ----------

function SaveToProjectMenu({ projects, articleId, onToggle, onCreate, onClose, anchorRect }) {
  const ref = useRefProj(null);
  const [newName, setNewName] = useStateProj('');
  const inputRef = useRefProj(null);

  useEffectProj(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const submitNew = () => {
    const name = newName.trim();
    if (!name) return;
    onCreate(name, articleId);
    setNewName('');
    inputRef.current?.focus();
  };

  return (
    <div className="save-menu" ref={ref} role="menu" onClick={(e) => e.stopPropagation()}>
      <div className="save-menu-head">Save to project</div>
      <div className="save-menu-list">
        {projects.length === 0 && (
          <div className="save-menu-empty">No projects yet — create one below.</div>
        )}
        {projects.map(p => {
          const inIt = p.articleIds.includes(articleId);
          return (
            <button
              key={p.id}
              className={`save-menu-item ${inIt ? 'on' : ''}`}
              role="menuitemcheckbox"
              aria-checked={inIt}
              onClick={() => onToggle(p.id, articleId)}
            >
              <span className="save-menu-check" aria-hidden="true">
                {inIt ? (
                  <svg viewBox="0 0 14 14" width="13" height="13"><path d="M2.5 7.5L6 11l5.5-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                ) : null}
              </span>
              <span className="save-menu-name">{p.name}</span>
              <span className="save-menu-count">{p.articleIds.length}</span>
            </button>
          );
        })}
      </div>
      <div className="save-menu-new">
        <input
          ref={inputRef}
          className="save-menu-input"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitNew(); } }}
          placeholder="New project…"
        />
        <button className={`save-menu-add ${newName.trim() ? '' : 'disabled'}`} onClick={submitNew} disabled={!newName.trim()}>
          Create
        </button>
      </div>
    </div>
  );
}

// ---------- Sidebar Projects section ----------

function ProjectsSection({ projects, selected, setSelected, onAdd, onRename, onDelete, editingId, setEditingId }) {
  const EditableTitle = window.AlmanachEditableTitle;
  return (
    <div className="projects-section">
      <div className="sidebar-header projects-header">
        <span className="section-label">PROJECTS</span>
        <button className="icon-btn" title="New project" onClick={onAdd} aria-label="New project">
          <svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>

      {projects.length === 0 && (
        <div className="empty-hint" style={{ paddingLeft: 12 }}>
          No projects yet. Click + to start one, then save articles into it.
        </div>
      )}

      {projects.map(p => {
        const isActive = selected.kind === 'project' && selected.projectId === p.id;
        return (
          <div
            key={p.id}
            className={`row project-row ${isActive ? 'active' : ''}`}
            onClick={() => setSelected({ kind: 'project', projectId: p.id })}
          >
            <span className="project-icon" aria-hidden="true"><IconFolder /></span>
            {EditableTitle ? (
              <EditableTitle
                value={p.name}
                onChange={(name) => onRename(p.id, name)}
                editing={editingId === p.id}
                onStartEdit={() => setEditingId(p.id)}
                onStopEdit={() => setEditingId(null)}
                className="project-name"
                autoSelectAll
              />
            ) : <span className="project-name">{p.name}</span>}
            <span className="count count-pill">{p.articleIds.length}</span>
            <span className="group-actions project-actions">
              <button className="icon-btn tiny" title="Rename" onClick={(e) => { e.stopPropagation(); setEditingId(p.id); }}>
                <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M11 2l3 3-8 8H3v-3z"/></svg>
              </button>
              <button className="icon-btn tiny danger" title="Delete project" onClick={(e) => { e.stopPropagation(); onDelete(p.id); }}>
                <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 5h10M6 5V3h4v2M5 5l1 9h4l1-9"/></svg>
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

window.AlmanachIconBookmark = IconBookmark;
window.AlmanachSaveToProjectMenu = SaveToProjectMenu;
window.AlmanachProjectsSection = ProjectsSection;
