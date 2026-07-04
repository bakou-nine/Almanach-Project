// Article feed for current selection

const { useMemo: useMemoFeed, useState: useStateFeed } = React;
const FilterBar = window.AlmanachFilterBar;

// Apply a single keyword chip to an article. Tests title + preview + source name.
// `exact` = true means whole-word + case-sensitive; off means substring + case-insensitive.
function matchesKeyword(article, src, kw) {
  const haystacks = [article.title || '', article.preview || '', src?.name || ''];
  const needle = kw.text;
  if (kw.exact) {
    const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('\\b' + esc + '\\b'); // case-sensitive by default
    return haystacks.some(h => re.test(h));
  }
  const n = needle.toLowerCase();
  return haystacks.some(h => h.toLowerCase().includes(n));
}

// Hours-ago parser for the "When" filter. The data file uses strings like
// "just now", "41 sec ago", "22 min ago", "3 h ago", "1 d ago". Anything
// unrecognized counts as recent so we don't accidentally hide things.
function articleAgeHours(article) {
  const t = (article.time || '').toLowerCase();
  if (t.includes('just now') || t.includes('sec')) return 0;
  const m = t.match(/(\d+)\s*(min|h|d)/);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  if (m[2] === 'min') return n / 60;
  if (m[2] === 'h') return n;
  if (m[2] === 'd') return n * 24;
  return 0;
}

function Feed({ state, data, selected, setSelected, dotStyle, showTip, onCloseTip, filters, setFilters, chipStyle,
               projects, onToggleArticleInProject, onCreateProjectWithArticle }) {
  const findSrc = (id) => data.sources.find(s => s.id === id);
  const [menuArticleId, setMenuArticleId] = useStateFeed(null);
  const SaveToProjectMenu = window.AlmanachSaveToProjectMenu;
  const IconBookmark = window.AlmanachIconBookmark;

  // Which projects contain a given article (for the filled-bookmark state).
  const projectsForArticle = (aid) => (projects || []).filter(p => p.articleIds.includes(aid));

  // Reusable article row with a bookmark/save affordance + save popover.
  function ArticleRow({ a, compact, showSource }) {
    const src = findSrc(a.sourceId) || { id: a.sourceId, name: 'Unknown source', color: '#a39a8c' };
    const saved = projectsForArticle(a.id);
    const isSaved = saved.length > 0;
    const open = menuArticleId === a.id;
    return (
      <article className={`article ${compact ? 'compact' : ''} ${open ? 'menu-open' : ''}`}>
        <div className="article-main">
          {showSource ? (
            <div className="article-meta">
              <span className={`dot dot-${dotStyle}`} style={dotStyle === 'ring' ? { boxShadow: `inset 0 0 0 1.5px ${src.color}` } : { background: src.color }}></span>
              <span className="article-source">{src.name}</span>
              <span className="article-dot">·</span>
              <span className="article-time">{a.time}</span>
            </div>
          ) : (
            <div className="article-meta"><span className="article-time">{a.time}</span></div>
          )}
          <h3
            className="article-title clickable"
            onClick={() => setMenuArticleId(open ? null : a.id)}
            title="Save to a project"
          >
            {a.title}
          </h3>
          {a.preview && <p className="article-preview">{a.preview}</p>}
          {isSaved && (
            <div className="article-saved-tags">
              {saved.map(p => (
                <button
                  key={p.id}
                  className="article-saved-tag"
                  onClick={() => setSelected({ kind: 'project', projectId: p.id })}
                  title={`Open ${p.name}`}
                >
                  <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M2 4.5h4l1.2 1.4H14V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/></svg>
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="article-side">
          <button
            className={`bookmark-btn ${isSaved ? 'saved' : ''} ${open ? 'active' : ''}`}
            onClick={() => setMenuArticleId(open ? null : a.id)}
            title={isSaved ? `Saved to ${saved.length} project${saved.length > 1 ? 's' : ''}` : 'Save to project'}
            aria-label="Save to project"
          >
            {IconBookmark && <IconBookmark filled={isSaved} />}
          </button>
          {open && SaveToProjectMenu && (
            <SaveToProjectMenu
              projects={projects}
              articleId={a.id}
              onToggle={onToggleArticleInProject}
              onCreate={onCreateProjectWithArticle}
              onClose={() => setMenuArticleId(null)}
            />
          )}
        </div>
      </article>
    );
  }

  // Compute which sourceIds match the current selection
  const { title, sourceIds, subtitle } = useMemoFeed(() => {
    if (selected.kind === 'all') {
      return {
        title: 'Latest news',
        sourceIds: data.sources.map(s => s.id),
        subtitle: `${data.sources.reduce((a, s) => a + s.count, 0).toLocaleString()} articles · ${data.sources.length} active sources`,
      };
    }
    if (selected.kind === 'source') {
      const s = findSrc(selected.sourceId);
      return { title: s?.name || 'Source', sourceIds: s ? [s.id] : [], subtitle: s ? `${s.count.toLocaleString()} articles` : '' };
    }
    if (selected.kind === 'subgroup') {
      const g = state.groups.find(x => x.id === selected.groupId);
      const sg = g?.subgroups.find(x => x.id === selected.subgroupId);
      const ids = sg?.sourceIds || [];
      return {
        title: sg?.name || 'Subgroup',
        sourceIds: ids,
        subtitle: `${g?.name} · ${ids.length} sources`,
      };
    }
    if (selected.kind === 'group') {
      const g = state.groups.find(x => x.id === selected.groupId);
      const direct = g?.sourceIds || [];
      const fromSubs = (g?.subgroups || []).flatMap(sg => sg.sourceIds);
      const ids = [...direct, ...fromSubs];
      return {
        title: g?.name || 'Group',
        sourceIds: ids,
        subtitle: `${ids.length} sources · ${(g?.subgroups || []).length} subgroups`,
      };
    }
    return { title: '', sourceIds: [], subtitle: '' };
  }, [state, selected, data]);

  // Apply WHEN + KEYWORD filters on top of the sidebar scope.
  const whenCutoff = { '1d': 24, '1w': 24 * 7, '1m': 24 * 30, 'custom': Infinity }[filters.when] ?? Infinity;
  const articles = data.articles.filter(a => {
    if (!sourceIds.includes(a.sourceId)) return false;
    if (articleAgeHours(a) > whenCutoff) return false;
    if (filters.keywords.length === 0) return true;
    const src = findSrc(a.sourceId);
    // All keywords must match (AND). Swap to .some(...) for OR semantics.
    return filters.keywords.every(kw => matchesKeyword(a, src, kw));
  });

  const totalInScope = data.articles.filter(a => sourceIds.includes(a.sourceId)).length;
  const filtersActive = filters.keywords.length > 0 || filters.when !== '1m';

  // Group articles by source when showing a group/subgroup, otherwise show flat list
  const showGrouped = selected.kind === 'group' || selected.kind === 'subgroup';
  const grouped = useMemoFeed(() => {
    if (!showGrouped) return null;
    const bySource = new Map();
    for (const a of articles) {
      if (!bySource.has(a.sourceId)) bySource.set(a.sourceId, []);
      bySource.get(a.sourceId).push(a);
    }
    return [...bySource.entries()].map(([sid, items]) => ({ source: findSrc(sid), items }));
  }, [articles, showGrouped]);

  // ---------- Project view: show saved articles ----------
  if (selected.kind === 'project') {
    const project = (projects || []).find(p => p.id === selected.projectId);
    const savedArticles = project ? project.articleIds.map(id => data.articles.find(a => a.id === id)).filter(Boolean) : [];
    return (
      <main className="feed">
        <header className="feed-header">
          <div>
            <div className="feed-eyebrow">
              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M2 4.5h4l1.2 1.4H14V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/></svg>
              Project
            </div>
            <h1 className="feed-title">{project?.name || 'Project'}</h1>
            <div className="feed-subtitle">
              {savedArticles.length === 0
                ? 'No saved articles yet'
                : <><strong className="feed-sub-strong">{savedArticles.length}</strong> saved article{savedArticles.length > 1 ? 's' : ''}</>}
            </div>
          </div>
          <button className="btn-ghost" onClick={() => setSelected({ kind: 'all' })}>
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3L5 8l5 5"/></svg>
            Back to news
          </button>
        </header>

        {savedArticles.length === 0 && (
          <div className="feed-empty project-empty">
            <div className="project-empty-icon">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d="M3 6.5h6l1.8 2H21V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z"/></svg>
            </div>
            <div className="project-empty-title">Nothing saved here yet</div>
            <div className="project-empty-text">Browse the news, click an article’s bookmark, and add it to <strong>{project?.name}</strong>.</div>
          </div>
        )}

        {savedArticles.map(a => <ArticleRow key={a.id} a={a} showSource={true} />)}
      </main>
    );
  }

  return (
    <main className="feed">
      <header className="feed-header">
        <div>
          <h1 className="feed-title">{title}</h1>
          <div className="feed-subtitle">
            {filtersActive
              ? <><strong className="feed-sub-strong">{articles.length.toLocaleString()}</strong> of {totalInScope.toLocaleString()} articles match · {data.sources.length} active sources</>
              : subtitle}
          </div>
        </div>
        <button className="icon-btn" title="Sync now" aria-label="Sync now">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M3 8a5 5 0 0 1 9-3l1 1M13 8a5 5 0 0 1-9 3l-1-1"/>
            <path d="M12 3v3h-3M4 13v-3h3"/>
          </svg>
        </button>
      </header>

      {FilterBar && (
        <FilterBar
          filters={filters}
          setFilters={setFilters}
          sourceScopeLabel={title}
          chipStyle={chipStyle}
        />
      )}

      {showTip && (
        <div className="tip-banner">
          <span style={{ fontSize: 18, lineHeight: 1 }}>✨</span>
          <div className="tip-banner-text">
            <strong>New: group your sources.</strong>{' '}
            Click <span className="tip-kbd">+</span> in the sidebar to create a group (e.g. <em>AI</em>), then drag any source onto it. Hover a group and click <span className="tip-kbd">+</span> to add a subgroup. Double-click any title to rename.
          </div>
          <button className="tip-banner-close" onClick={onCloseTip} aria-label="Dismiss">×</button>
        </div>
      )}

      {articles.length === 0 && (
        <div className="feed-empty">
          {filters.keywords.length > 0
            ? <>No articles match <em>{filters.keywords.map(k => `“${k.text}”`).join(' + ')}</em> in this scope.</>
            : <>No articles in this selection yet — drop a source into it.</>}
        </div>
      )}

      {!showGrouped && articles.map(a => <ArticleRow key={a.id} a={a} showSource={true} />)}

      {showGrouped && grouped.map(({ source, items }) => (
        <section key={source.id} className="source-section">
          <header className="source-section-header">
            <span className={`dot dot-${dotStyle}`} style={dotStyle === 'ring' ? { boxShadow: `inset 0 0 0 1.5px ${source.color}` } : { background: source.color }}></span>
            <span className="source-section-name">{source.name}</span>
            <span className="source-section-count">{items.length} articles</span>
          </header>
          {items.map(a => <ArticleRow key={a.id} a={a} compact={true} showSource={false} />)}
        </section>
      ))}
    </main>
  );
}

window.AlmanachFeed = Feed;
