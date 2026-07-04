// Sidebar with groups, subgroups, and drag-and-drop
// Exports to window for cross-file React access

const { useState, useRef, useEffect, useCallback, Fragment } = React;

// ---------- helpers ----------

function findSource(data, id) {
  return data.sources.find(s => s.id === id);
}

function removeSourceEverywhere(state, sourceId) {
  const groups = state.groups.map(g => ({
    ...g,
    sourceIds: g.sourceIds.filter(id => id !== sourceId),
    subgroups: g.subgroups.map(sg => ({
      ...sg,
      sourceIds: sg.sourceIds.filter(id => id !== sourceId),
    })),
  }));
  const ungroupedSourceIds = state.ungroupedSourceIds.filter(id => id !== sourceId);
  return { ...state, groups, ungroupedSourceIds };
}

function insertAt(arr, item, index) {
  const next = arr.slice();
  if (index == null || index < 0 || index > next.length) next.push(item);
  else next.splice(index, 0, item);
  return next;
}

// target = {kind:'group'|'subgroup'|'ungrouped', groupId?, subgroupId?, index?}
function moveSource(state, sourceId, target) {
  let next = removeSourceEverywhere(state, sourceId);
  if (target.kind === 'ungrouped') {
    next = { ...next, ungroupedSourceIds: insertAt(next.ungroupedSourceIds, sourceId, target.index) };
  } else if (target.kind === 'group') {
    next = {
      ...next,
      groups: next.groups.map(g =>
        g.id === target.groupId
          ? { ...g, sourceIds: insertAt(g.sourceIds, sourceId, target.index) }
          : g
      ),
    };
  } else if (target.kind === 'subgroup') {
    next = {
      ...next,
      groups: next.groups.map(g =>
        g.id === target.groupId
          ? {
              ...g,
              subgroups: g.subgroups.map(sg =>
                sg.id === target.subgroupId
                  ? { ...sg, sourceIds: insertAt(sg.sourceIds, sourceId, target.index) }
                  : sg
              ),
            }
          : g
      ),
    };
  }
  return next;
}

function moveGroup(state, groupId, toIndex) {
  const g = state.groups.find(x => x.id === groupId);
  if (!g) return state;
  const without = state.groups.filter(x => x.id !== groupId);
  return { ...state, groups: insertAt(without, g, toIndex) };
}

function moveSubgroup(state, subgroupId, toGroupId, toIndex) {
  let sg = null;
  let groups = state.groups.map(g => {
    if (g.subgroups.some(x => x.id === subgroupId)) {
      sg = g.subgroups.find(x => x.id === subgroupId);
      return { ...g, subgroups: g.subgroups.filter(x => x.id !== subgroupId) };
    }
    return g;
  });
  if (!sg) return state;
  groups = groups.map(g =>
    g.id === toGroupId ? { ...g, subgroups: insertAt(g.subgroups, sg, toIndex) } : g
  );
  return { ...state, groups };
}

// ---------- inline editable label ----------

function EditableTitle({ value, onChange, editing, onStartEdit, onStopEdit, className, placeholder, autoSelectAll }) {
  const ref = useRef(null);
  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      if (autoSelectAll) ref.current.select();
    }
  }, [editing, autoSelectAll]);

  if (editing) {
    return (
      <input
        ref={ref}
        className={`editable-input ${className || ''}`}
        defaultValue={value}
        placeholder={placeholder}
        onBlur={(e) => { onChange(e.target.value.trim() || value); onStopEdit(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.target.blur();
          if (e.key === 'Escape') { e.target.value = value; e.target.blur(); }
        }}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }
  return (
    <span className={className} onDoubleClick={(e) => { e.stopPropagation(); onStartEdit(); }}>
      {value}
    </span>
  );
}

// ---------- source row ----------

function SourceRow({ source, isActive, onSelect, onDragStart, onDragEnd, onDragOverRow, onDropOnRow, dropAbove, dropBelow, indent, isDragging, dotStyle, showCount }) {
  return (
    <div
      className={`row source-row ${isActive ? 'active' : ''} ${isDragging ? 'dragging' : ''} ${dropAbove ? 'drop-above' : ''} ${dropBelow ? 'drop-below' : ''}`}
      style={{ paddingLeft: indent }}
      draggable
      onDragStart={(e) => onDragStart(e, source.id)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => onDragOverRow(e, source.id)}
      onDrop={(e) => onDropOnRow(e, source.id)}
      onClick={() => onSelect(source.id)}
    >
      <span className="drag-grip" aria-hidden="true">⋮⋮</span>
      <span
        className={`dot dot-${dotStyle}`}
        style={dotStyle === 'ring' ? { boxShadow: `inset 0 0 0 1.5px ${source.color}` } : { background: source.color }}
      ></span>
      <span className="source-name" title={source.name}>{source.name}</span>
      {showCount && <span className="count">{source.count.toLocaleString()}</span>}
    </div>
  );
}

// ---------- main sidebar ----------

function Sidebar({ state, setState, selected, setSelected, data, density, dotStyle, showCount,
                   projects, addProject, renameProject, deleteProject }) {
  const [editingId, setEditingId] = useState(null);   // id of group/subgroup being renamed
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [hoverGroupId, setHoverGroupId] = useState(null);
  const ProjectsSection = window.AlmanachProjectsSection;

  // drag state
  const dragRef = useRef({ kind: null, id: null });
  const [dropHint, setDropHint] = useState(null); // {kind, ...} highlights target

  const startDrag = (e, kind, id) => {
    dragRef.current = { kind, id };
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', `${kind}:${id}`); } catch (_) {}
    // tiny ghost to keep the cursor clean
    document.body.classList.add('is-dragging');
  };
  const endDrag = () => {
    dragRef.current = { kind: null, id: null };
    setDropHint(null);
    document.body.classList.remove('is-dragging');
  };

  // -------- drop handlers --------

  const onSourceDragStart = (e, id) => startDrag(e, 'source', id);
  const onGroupDragStart  = (e, id) => startDrag(e, 'group',  id);
  const onSubgroupDragStart = (e, id) => startDrag(e, 'subgroup', id);

  // drop a source onto a source row → insert before/after that row in same container
  const onDragOverSourceRow = (e, sourceId, container) => {
    const drag = dragRef.current;
    if (drag.kind !== 'source') return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    setDropHint({ kind: 'source-row', sourceId, before, container });
  };
  const onDropOnSourceRow = (e, sourceId, container) => {
    const drag = dragRef.current;
    if (drag.kind !== 'source') return;
    e.preventDefault();
    e.stopPropagation();
    // compute index in target container
    let arr;
    if (container.kind === 'ungrouped') arr = state.ungroupedSourceIds;
    else if (container.kind === 'group') arr = state.groups.find(g => g.id === container.groupId)?.sourceIds || [];
    else arr = state.groups.find(g => g.id === container.groupId)?.subgroups.find(sg => sg.id === container.subgroupId)?.sourceIds || [];

    const filtered = arr.filter(id => id !== drag.id);
    const targetIdx = filtered.indexOf(sourceId);
    const idx = dropHint?.before ? targetIdx : targetIdx + 1;
    setState(s => moveSource(s, drag.id, { ...container, index: idx }));
    endDrag();
  };

  // drop a source onto a group/subgroup header → append to that container
  const onDragOverContainer = (e, container) => {
    const drag = dragRef.current;
    if (drag.kind === 'source') {
      e.preventDefault();
      setDropHint({ kind: 'container', container });
    } else if (drag.kind === 'subgroup' && container.kind === 'group') {
      e.preventDefault();
      setDropHint({ kind: 'container', container });
    }
  };
  const onDropOnContainer = (e, container) => {
    const drag = dragRef.current;
    if (drag.kind === 'source') {
      e.preventDefault(); e.stopPropagation();
      setState(s => moveSource(s, drag.id, container));
      endDrag();
    } else if (drag.kind === 'subgroup' && container.kind === 'group') {
      e.preventDefault(); e.stopPropagation();
      setState(s => moveSubgroup(s, drag.id, container.groupId, null));
      endDrag();
    }
  };

  // reorder groups by dropping on a group row
  const onDragOverGroupRow = (e, groupId) => {
    const drag = dragRef.current;
    if (drag.kind === 'source') {
      e.preventDefault();
      setDropHint({ kind: 'container', container: { kind: 'group', groupId } });
      return;
    }
    if (drag.kind === 'group' && drag.id !== groupId) {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      setDropHint({ kind: 'group-reorder', groupId, before });
    }
    if (drag.kind === 'subgroup') {
      e.preventDefault();
      setDropHint({ kind: 'container', container: { kind: 'group', groupId } });
    }
  };
  const onDropOnGroupRow = (e, groupId) => {
    const drag = dragRef.current;
    if (drag.kind === 'source') {
      e.preventDefault(); e.stopPropagation();
      setState(s => moveSource(s, drag.id, { kind: 'group', groupId }));
      endDrag(); return;
    }
    if (drag.kind === 'group') {
      e.preventDefault(); e.stopPropagation();
      const before = !!dropHint?.before;
      setState(s => {
        const without = s.groups.filter(g => g.id !== drag.id);
        const targetIdx = without.findIndex(g => g.id === groupId);
        const idx = before ? targetIdx : targetIdx + 1;
        return moveGroup({ ...s, groups: s.groups }, drag.id, idx >= 0 ? idx : s.groups.length);
      });
      endDrag(); return;
    }
    if (drag.kind === 'subgroup') {
      e.preventDefault(); e.stopPropagation();
      setState(s => moveSubgroup(s, drag.id, groupId, null));
      endDrag(); return;
    }
  };

  // reorder subgroups by dropping on subgroup row
  const onDragOverSubgroupRow = (e, groupId, subgroupId) => {
    const drag = dragRef.current;
    if (drag.kind === 'source') {
      e.preventDefault();
      setDropHint({ kind: 'container', container: { kind: 'subgroup', groupId, subgroupId } });
      return;
    }
    if (drag.kind === 'subgroup' && drag.id !== subgroupId) {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      setDropHint({ kind: 'subgroup-reorder', groupId, subgroupId, before });
    }
  };
  const onDropOnSubgroupRow = (e, groupId, subgroupId) => {
    const drag = dragRef.current;
    if (drag.kind === 'source') {
      e.preventDefault(); e.stopPropagation();
      setState(s => moveSource(s, drag.id, { kind: 'subgroup', groupId, subgroupId }));
      endDrag(); return;
    }
    if (drag.kind === 'subgroup' && drag.id !== subgroupId) {
      e.preventDefault(); e.stopPropagation();
      const before = !!dropHint?.before;
      setState(s => {
        const targetGroup = s.groups.find(g => g.id === groupId);
        if (!targetGroup) return s;
        // simulate filtered to compute target index after removal
        let removedFrom = s.groups.find(g => g.subgroups.some(sg => sg.id === drag.id));
        const newGroup = targetGroup.subgroups.filter(sg => sg.id !== drag.id);
        const tIdx = newGroup.findIndex(sg => sg.id === subgroupId);
        const idx = before ? tIdx : tIdx + 1;
        return moveSubgroup(s, drag.id, groupId, idx >= 0 ? idx : null);
      });
      endDrag(); return;
    }
  };

  // -------- mutation actions --------

  const renameGroup = (id, name) => setState(s => ({ ...s, groups: s.groups.map(g => g.id === id ? { ...g, name } : g) }));
  const renameSubgroup = (gid, sid, name) => setState(s => ({
    ...s,
    groups: s.groups.map(g => g.id === gid
      ? { ...g, subgroups: g.subgroups.map(sg => sg.id === sid ? { ...sg, name } : sg) }
      : g),
  }));
  const toggleGroup = (id) => setState(s => ({ ...s, groups: s.groups.map(g => g.id === id ? { ...g, collapsed: !g.collapsed } : g) }));
  const toggleSubgroup = (gid, sid) => setState(s => ({
    ...s,
    groups: s.groups.map(g => g.id === gid
      ? { ...g, subgroups: g.subgroups.map(sg => sg.id === sid ? { ...sg, collapsed: !sg.collapsed } : sg) }
      : g),
  }));

  const addGroup = () => {
    const id = 'g-' + Math.random().toString(36).slice(2, 7);
    setState(s => ({ ...s, groups: [...s.groups, { id, name: 'New group', collapsed: false, subgroups: [], sourceIds: [] }] }));
    setEditingId(id);
    setSelected({ kind: 'group', groupId: id });
  };
  const addSubgroup = (gid) => {
    const id = 'sg-' + Math.random().toString(36).slice(2, 7);
    setState(s => ({
      ...s,
      groups: s.groups.map(g => g.id === gid
        ? { ...g, collapsed: false, subgroups: [...g.subgroups, { id, name: 'New subgroup', collapsed: false, sourceIds: [] }] }
        : g),
    }));
    setEditingId(id);
    setSelected({ kind: 'subgroup', groupId: gid, subgroupId: id });
  };

  const deleteGroup = (gid) => {
    if (!confirm('Delete this group? Sources inside will move to Ungrouped.')) return;
    setState(s => {
      const g = s.groups.find(x => x.id === gid);
      if (!g) return s;
      const allSources = [
        ...g.sourceIds,
        ...g.subgroups.flatMap(sg => sg.sourceIds),
      ];
      return {
        ...s,
        groups: s.groups.filter(x => x.id !== gid),
        ungroupedSourceIds: [...s.ungroupedSourceIds, ...allSources],
      };
    });
  };
  const deleteSubgroup = (gid, sid) => {
    if (!confirm('Delete this subgroup? Sources inside will move up to the parent group.')) return;
    setState(s => ({
      ...s,
      groups: s.groups.map(g => {
        if (g.id !== gid) return g;
        const sg = g.subgroups.find(x => x.id === sid);
        if (!sg) return g;
        return {
          ...g,
          subgroups: g.subgroups.filter(x => x.id !== sid),
          sourceIds: [...g.sourceIds, ...sg.sourceIds],
        };
      }),
    }));
  };

  // -------- rendering helpers --------

  const allCount = data.sources.reduce((a, s) => a + s.count, 0);
  const sumFor = (ids) => ids.reduce((a, id) => a + (findSource(data, id)?.count || 0), 0);
  const isDraggingId = dragRef.current.id;

  const isContainerHinted = (c) =>
    dropHint?.kind === 'container'
      && dropHint.container.kind === c.kind
      && dropHint.container.groupId === c.groupId
      && (c.subgroupId === undefined || dropHint.container.subgroupId === c.subgroupId);

  const renderSourceList = (ids, container, indent) => {
    return ids.map(id => {
      const src = findSource(data, id);
      if (!src) return null;
      const isActive =
        selected.kind === 'source' && selected.sourceId === id;
      const dh = dropHint;
      const dropAbove = dh?.kind === 'source-row' && dh.sourceId === id && dh.before
        && dh.container.kind === container.kind && dh.container.groupId === container.groupId && dh.container.subgroupId === container.subgroupId;
      const dropBelow = dh?.kind === 'source-row' && dh.sourceId === id && !dh.before
        && dh.container.kind === container.kind && dh.container.groupId === container.groupId && dh.container.subgroupId === container.subgroupId;
      return (
        <SourceRow
          key={id}
          source={src}
          isActive={isActive}
          isDragging={isDraggingId === id}
          onSelect={(sid) => setSelected({ kind: 'source', sourceId: sid })}
          onDragStart={onSourceDragStart}
          onDragEnd={endDrag}
          onDragOverRow={(e, sid) => onDragOverSourceRow(e, sid, container)}
          onDropOnRow={(e, sid) => onDropOnSourceRow(e, sid, container)}
          dropAbove={dropAbove}
          dropBelow={dropBelow}
          indent={indent}
          dotStyle={dotStyle}
          showCount={showCount}
        />
      );
    });
  };

  // -------- render --------

  return (
    <aside className={`sidebar density-${density}`}>
      <div className="sidebar-header">
        <span className="section-label">SOURCES</span>
        <button className="icon-btn" title="New group" onClick={addGroup} aria-label="New group">
          <svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>

      <div className="sidebar-scroll">
        {/* All sources */}
        <div
          className={`row all-row ${selected.kind === 'all' ? 'active' : ''}`}
          onClick={() => setSelected({ kind: 'all' })}
        >
          <span className="all-icon" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M2 4h12M2 8h12M2 12h12"/>
            </svg>
          </span>
          <span className="source-name">All sources</span>
          {showCount && <span className="count count-pill">{allCount.toLocaleString()}</span>}
        </div>

        <div className="divider"></div>

        {/* Groups */}
        {state.groups.map((g, gi) => {
          const groupHinted = isContainerHinted({ kind: 'group', groupId: g.id });
          const reorderAbove = dropHint?.kind === 'group-reorder' && dropHint.groupId === g.id && dropHint.before;
          const reorderBelow = dropHint?.kind === 'group-reorder' && dropHint.groupId === g.id && !dropHint.before;
          const groupCount = sumFor(g.sourceIds) + g.subgroups.reduce((a, sg) => a + sumFor(sg.sourceIds), 0);
          const isActive = selected.kind === 'group' && selected.groupId === g.id;
          return (
            <div
              key={g.id}
              className={`group-block ${groupHinted ? 'drop-into' : ''} ${reorderAbove ? 'drop-above' : ''} ${reorderBelow ? 'drop-below' : ''}`}
              onMouseEnter={() => setHoverGroupId(g.id)}
              onMouseLeave={() => setHoverGroupId(curr => curr === g.id ? null : curr)}
            >
              <div
                className={`row group-row ${isActive ? 'active' : ''} ${isDraggingId === g.id ? 'dragging' : ''}`}
                draggable={editingId !== g.id}
                onDragStart={(e) => onGroupDragStart(e, g.id)}
                onDragEnd={endDrag}
                onDragOver={(e) => onDragOverGroupRow(e, g.id)}
                onDrop={(e) => onDropOnGroupRow(e, g.id)}
                onClick={() => setSelected({ kind: 'group', groupId: g.id })}
              >
                <button
                  className={`caret ${g.collapsed ? '' : 'open'}`}
                  onClick={(e) => { e.stopPropagation(); toggleGroup(g.id); }}
                  aria-label={g.collapsed ? 'Expand' : 'Collapse'}
                >
                  <svg viewBox="0 0 12 12" width="10" height="10"><path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
                <EditableTitle
                  value={g.name}
                  onChange={(name) => renameGroup(g.id, name)}
                  editing={editingId === g.id}
                  onStartEdit={() => setEditingId(g.id)}
                  onStopEdit={() => setEditingId(null)}
                  className="group-name"
                  autoSelectAll
                />
                {showCount && <span className="count count-pill">{groupCount.toLocaleString()}</span>}
                <span className={`group-actions ${hoverGroupId === g.id ? 'show' : ''}`}>
                  <button className="icon-btn tiny" title="New subgroup" onClick={(e) => { e.stopPropagation(); addSubgroup(g.id); }}>
                    <svg viewBox="0 0 16 16" width="12" height="12"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                  </button>
                  <button className="icon-btn tiny" title="Rename" onClick={(e) => { e.stopPropagation(); setEditingId(g.id); }}>
                    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M11 2l3 3-8 8H3v-3z"/></svg>
                  </button>
                  <button className="icon-btn tiny danger" title="Delete group" onClick={(e) => { e.stopPropagation(); deleteGroup(g.id); }}>
                    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 5h10M6 5V3h4v2M5 5l1 9h4l1-9"/></svg>
                  </button>
                </span>
              </div>

              {!g.collapsed && (
                <div className="group-children">
                  {/* subgroups */}
                  {g.subgroups.map(sg => {
                    const sgHinted = isContainerHinted({ kind: 'subgroup', groupId: g.id, subgroupId: sg.id });
                    const sgAbove = dropHint?.kind === 'subgroup-reorder' && dropHint.subgroupId === sg.id && dropHint.before;
                    const sgBelow = dropHint?.kind === 'subgroup-reorder' && dropHint.subgroupId === sg.id && !dropHint.before;
                    const sgActive = selected.kind === 'subgroup' && selected.subgroupId === sg.id;
                    const sgCount = sumFor(sg.sourceIds);
                    return (
                      <div key={sg.id} className={`subgroup-block ${sgHinted ? 'drop-into' : ''} ${sgAbove ? 'drop-above' : ''} ${sgBelow ? 'drop-below' : ''}`}>
                        <div
                          className={`row subgroup-row ${sgActive ? 'active' : ''} ${isDraggingId === sg.id ? 'dragging' : ''}`}
                          draggable={editingId !== sg.id}
                          onDragStart={(e) => onSubgroupDragStart(e, sg.id)}
                          onDragEnd={endDrag}
                          onDragOver={(e) => onDragOverSubgroupRow(e, g.id, sg.id)}
                          onDrop={(e) => onDropOnSubgroupRow(e, g.id, sg.id)}
                          onClick={() => setSelected({ kind: 'subgroup', groupId: g.id, subgroupId: sg.id })}
                        >
                          <button
                            className={`caret tiny ${sg.collapsed ? '' : 'open'}`}
                            onClick={(e) => { e.stopPropagation(); toggleSubgroup(g.id, sg.id); }}
                          >
                            <svg viewBox="0 0 12 12" width="9" height="9"><path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          </button>
                          <EditableTitle
                            value={sg.name}
                            onChange={(name) => renameSubgroup(g.id, sg.id, name)}
                            editing={editingId === sg.id}
                            onStartEdit={() => setEditingId(sg.id)}
                            onStopEdit={() => setEditingId(null)}
                            className="subgroup-name"
                            autoSelectAll
                          />
                          {showCount && <span className="count">{sgCount.toLocaleString()}</span>}
                          <span className="group-actions">
                            <button className="icon-btn tiny" title="Rename" onClick={(e) => { e.stopPropagation(); setEditingId(sg.id); }}>
                              <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M11 2l3 3-8 8H3v-3z"/></svg>
                            </button>
                            <button className="icon-btn tiny danger" title="Delete subgroup" onClick={(e) => { e.stopPropagation(); deleteSubgroup(g.id, sg.id); }}>
                              <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 5h10M6 5V3h4v2M5 5l1 9h4l1-9"/></svg>
                            </button>
                          </span>
                        </div>
                        {!sg.collapsed && (
                          <div
                            className="container-drop subgroup-list"
                            onDragOver={(e) => onDragOverContainer(e, { kind: 'subgroup', groupId: g.id, subgroupId: sg.id })}
                            onDrop={(e) => onDropOnContainer(e, { kind: 'subgroup', groupId: g.id, subgroupId: sg.id })}
                          >
                            {sg.sourceIds.length === 0 && (
                              <div className="empty-hint" style={{ paddingLeft: 44 }}>Drop sources here</div>
                            )}
                            {renderSourceList(sg.sourceIds, { kind: 'subgroup', groupId: g.id, subgroupId: sg.id }, 44)}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* direct sources under group */}
                  <div
                    className="container-drop group-direct-list"
                    onDragOver={(e) => onDragOverContainer(e, { kind: 'group', groupId: g.id })}
                    onDrop={(e) => onDropOnContainer(e, { kind: 'group', groupId: g.id })}
                  >
                    {g.sourceIds.length === 0 && g.subgroups.length === 0 && (
                      <div className="empty-hint" style={{ paddingLeft: 28 }}>Drop sources here, or click + for a subgroup</div>
                    )}
                    {renderSourceList(g.sourceIds, { kind: 'group', groupId: g.id }, 28)}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <div className="divider"></div>

        {/* Ungrouped */}
        <div
          className={`ungrouped ${isContainerHinted({ kind: 'ungrouped' }) ? 'drop-into' : ''}`}
          onDragOver={(e) => onDragOverContainer(e, { kind: 'ungrouped' })}
          onDrop={(e) => onDropOnContainer(e, { kind: 'ungrouped' })}
        >
          <div className="ungrouped-header">
            <span className="section-label small">UNGROUPED</span>
            <span className="muted-count">{state.ungroupedSourceIds.length}</span>
          </div>
          {state.ungroupedSourceIds.length === 0 && (
            <div className="empty-hint" style={{ paddingLeft: 12 }}>Everything is sorted ✨</div>
          )}
          {renderSourceList(state.ungroupedSourceIds, { kind: 'ungrouped' }, 12)}
        </div>

        <div className="divider"></div>

        {/* Projects */}
        {ProjectsSection && (
          <ProjectsSection
            projects={projects}
            selected={selected}
            setSelected={setSelected}
            onAdd={addProject}
            onRename={renameProject}
            onDelete={deleteProject}
            editingId={editingProjectId}
            setEditingId={setEditingProjectId}
          />
        )}

        {/* spacer at bottom so last row isn't hugging edge */}
        <div style={{ height: 40 }}></div>
      </div>

      <button className="add-group-cta" onClick={addGroup}>
        <svg viewBox="0 0 16 16" width="12" height="12"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
        New group
      </button>
    </aside>
  );
}

window.AlmanachSidebar = Sidebar;
window.AlmanachEditableTitle = EditableTitle;
