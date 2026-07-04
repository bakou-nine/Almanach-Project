// Almanach root app
const { useState: useStateApp, useEffect: useEffectApp, useMemo: useMemoApp } = React;

const Sidebar = window.AlmanachSidebar;
const Feed = window.AlmanachFeed;
const SourcesIO = window.AlmanachSourcesIO;
const { useTweaks, TweaksPanel, TweakSection, TweakSlider, TweakToggle, TweakRadio, TweakColor } = window;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "density": "comfortable",
  "dotStyle": "solid",
  "showCount": true,
  "showTip": false,
  "accent": "#1f6feb",
  "chipStyle": "badges"
}/*EDITMODE-END*/;

function App() {
  const data = window.ALMANACH_DATA;

  const [state, setState] = useStateApp({
    sources: data.sources,
    groups: data.groups,
    ungroupedSourceIds: data.ungroupedSourceIds,
  });
  const [selected, setSelected] = useStateApp({ kind: 'all' });
  const [filters, setFilters] = useStateApp({
    when: '1w',
    keywords: [],
  });

  // Live data = static article DB with the (mutable) source list from state.
  const liveData = useMemoApp(() => ({ ...data, sources: state.sources }), [data, state.sources]);

  // Import replaces the entire hierarchy + source list, no approval.
  const importHierarchy = (next) => {
    setState(s => ({ ...s, sources: next.sources, groups: next.groups, ungroupedSourceIds: next.ungroupedSourceIds }));
    setSelected({ kind: 'all' });
  };

  // ---------- Projects (persisted to localStorage) ----------
  const [projects, setProjects] = useStateApp(() => {
    try {
      const raw = localStorage.getItem('almanach.projects');
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return [
      { id: 'p-demo', name: 'Weekly digest', articleIds: [] },
    ];
  });

  useEffectApp(() => {
    try { localStorage.setItem('almanach.projects', JSON.stringify(projects)); } catch (_) {}
  }, [projects]);

  const addProject = (name) => {
    const id = 'p-' + Math.random().toString(36).slice(2, 7);
    setProjects(ps => [...ps, { id, name: name || 'New project', articleIds: [] }]);
    return id;
  };
  const renameProject = (id, name) => setProjects(ps => ps.map(p => p.id === id ? { ...p, name } : p));
  const deleteProject = (id) => {
    const p = projects.find(x => x.id === id);
    if (p && p.articleIds.length && !confirm(`Delete “${p.name}”? ${p.articleIds.length} saved article${p.articleIds.length > 1 ? 's' : ''} will be removed from it.`)) return;
    setProjects(ps => ps.filter(x => x.id !== id));
    setSelected(sel => (sel.kind === 'project' && sel.projectId === id) ? { kind: 'all' } : sel);
  };
  const toggleArticleInProject = (projectId, articleId) => {
    setProjects(ps => ps.map(p => {
      if (p.id !== projectId) return p;
      const has = p.articleIds.includes(articleId);
      return { ...p, articleIds: has ? p.articleIds.filter(a => a !== articleId) : [...p.articleIds, articleId] };
    }));
  };
  const createProjectWithArticle = (name, articleId) => {
    const id = 'p-' + Math.random().toString(36).slice(2, 7);
    setProjects(ps => [...ps, { id, name, articleIds: [articleId] }]);
    return id;
  };
  const tweaks = useTweaks ? useTweaks(TWEAK_DEFAULTS) : [TWEAK_DEFAULTS, () => {}];
  const t = tweaks[0]; const setTweak = tweaks[1];

  // Reflect accent color into CSS var so it touches active state, drop indicators, etc.
  useEffectApp(() => {
    document.documentElement.style.setProperty('--accent', t.accent);
    // softer variants
    const hex = t.accent.replace('#','');
    const r = parseInt(hex.slice(0,2), 16);
    const g = parseInt(hex.slice(2,4), 16);
    const b = parseInt(hex.slice(4,6), 16);
    document.documentElement.style.setProperty('--accent-soft', `rgba(${r},${g},${b},0.10)`);
    document.documentElement.style.setProperty('--accent-strong', t.accent);
  }, [t.accent]);

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-left">
          <span className="brand-mark">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3 3h10v10H3z" />
              <path d="M3 6h10M6 3v10" />
            </svg>
          </span>
          <span className="brand-name">Almanach</span>
        </div>
        <div className="topbar-right">
          {SourcesIO && <SourcesIO state={state} onImport={importHierarchy} />}
          <span className="topbar-sync"><span className="sync-dot"></span> Last sync · 1 min ago</span>
        </div>
      </div>

      <div className="shell">
        <Sidebar
          state={state}
          setState={setState}
          selected={selected}
          setSelected={setSelected}
          data={liveData}
          density={t.density}
          dotStyle={t.dotStyle}
          showCount={t.showCount}
          projects={projects}
          addProject={() => { const id = addProject('New project'); setSelected({ kind: 'project', projectId: id }); return id; }}
          renameProject={renameProject}
          deleteProject={deleteProject}
        />
        <Feed
          state={state}
          data={liveData}
          selected={selected}
          setSelected={setSelected}
          dotStyle={t.dotStyle}
          showTip={t.showTip}
          onCloseTip={() => setTweak('showTip', false)}
          filters={filters}
          setFilters={setFilters}
          chipStyle={t.chipStyle}
          projects={projects}
          onToggleArticleInProject={toggleArticleInProject}
          onCreateProjectWithArticle={createProjectWithArticle}
        />
      </div>

      {TweaksPanel && (
        <TweaksPanel title="Tweaks">
          <TweakSection title="Layout">
            <TweakRadio
              label="Density"
              value={t.density}
              options={[
                { value: 'comfortable', label: 'Comfy' },
                { value: 'compact',     label: 'Compact' },
              ]}
              onChange={(v) => setTweak('density', v)}
            />
            <TweakToggle label="Show article counts" value={t.showCount} onChange={(v) => setTweak('showCount', v)} />
          </TweakSection>
          <TweakSection title="Source marks">
            <TweakRadio
              label="Dot style"
              value={t.dotStyle}
              options={[
                { value: 'solid', label: 'Solid' },
                { value: 'ring',  label: 'Ring' },
                { value: 'bar',   label: 'Bar' },
              ]}
              onChange={(v) => setTweak('dotStyle', v)}
            />
          </TweakSection>
          <TweakSection title="Keyword chips">
            <TweakRadio
              label="Chip style"
              value={t.chipStyle}
              options={[
                { value: 'badges',    label: 'Badges' },
                { value: 'split',     label: 'Split' },
                { value: 'underline', label: 'Typo' },
              ]}
              onChange={(v) => setTweak('chipStyle', v)}
            />
          </TweakSection>
          <TweakSection title="Accent">
            <TweakColor
              label="Selection color"
              value={t.accent}
              options={['#1f6feb', '#d97706', '#10b981', '#a855f7']}
              onChange={(v) => setTweak('accent', v)}
            />
          </TweakSection>
        </TweaksPanel>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
