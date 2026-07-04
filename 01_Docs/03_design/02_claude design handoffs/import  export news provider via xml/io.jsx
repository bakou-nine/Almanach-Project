// XML import / export of the full source hierarchy.
//
// Schema (order of elements = display order; hierarchy is literal nesting):
//
//   <almanach version="1">
//     <group id name collapsed>
//       <subgroup id name collapsed>
//         <source id name count color url/>
//       </subgroup>
//       <source .../>            <!-- sources directly under the group -->
//     </group>
//     <ungrouped>
//       <source .../>
//     </ungrouped>
//   </almanach>
//
// Import REPLACES the whole hierarchy + source list (no approval). Unknown
// attributes on <source> are preserved round-trip so users can add columns.

const { useState: useStateIO, useRef: useRefIO, useEffect: useEffectIO } = React;

const DEFAULT_COLORS = ['#f97316','#ef4444','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899','#06b6d4','#a855f7'];

// ---------- helpers ----------

function escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slug(s) {
  return String(s || 'source').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'source';
}

// Known attributes we manage explicitly; everything else is preserved as-is.
const KNOWN_SOURCE_ATTRS = ['id', 'name', 'count', 'color', 'url'];

function sourceToXml(src, indent) {
  const extra = Object.keys(src)
    .filter(k => !KNOWN_SOURCE_ATTRS.includes(k) && k !== '_extra')
    .map(k => ` ${k}="${escXml(src[k])}"`)
    .join('');
  const preserved = src._extra ? Object.entries(src._extra).map(([k, v]) => ` ${k}="${escXml(v)}"`).join('') : '';
  const url = src.url ? ` url="${escXml(src.url)}"` : '';
  return `${indent}<source id="${escXml(src.id)}" name="${escXml(src.name)}" count="${escXml(src.count ?? 0)}" color="${escXml(src.color || '')}"${url}${extra}${preserved}/>`;
}

// ---------- serialize ----------

function serializeToXML(state) {
  const byId = new Map(state.sources.map(s => [s.id, s]));
  const get = (id) => byId.get(id) || { id, name: id, count: 0, color: '' };
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<!-- Almanach source hierarchy. Edit freely, then re-upload. -->');
  lines.push('<!-- Element order = display order. Nesting = group > subgroup > source. -->');
  lines.push('<almanach version="1">');
  for (const g of state.groups) {
    lines.push(`  <group id="${escXml(g.id)}" name="${escXml(g.name)}" collapsed="${!!g.collapsed}">`);
    for (const sg of (g.subgroups || [])) {
      lines.push(`    <subgroup id="${escXml(sg.id)}" name="${escXml(sg.name)}" collapsed="${!!sg.collapsed}">`);
      for (const sid of sg.sourceIds) lines.push(sourceToXml(get(sid), '      '));
      lines.push('    </subgroup>');
    }
    for (const sid of (g.sourceIds || [])) lines.push(sourceToXml(get(sid), '    '));
    lines.push('  </group>');
  }
  lines.push('  <ungrouped>');
  for (const sid of state.ungroupedSourceIds) lines.push(sourceToXml(get(sid), '    '));
  lines.push('  </ungrouped>');
  lines.push('</almanach>');
  return lines.join('\n');
}

// ---------- template (virgin) ----------

function buildTemplateXML() {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- ============================================================= -->',
    '<!-- Almanach source template.                                     -->',
    '<!--                                                               -->',
    '<!-- HOW TO USE                                                    -->',
    '<!--  1. Duplicate <source .../> lines to add news providers.      -->',
    '<!--  2. Group them with <group> and <subgroup> (see nesting).     -->',
    '<!--  3. Sources with no group go inside <ungrouped>.              -->',
    '<!--  4. Re-upload this file — it replaces your whole hierarchy.   -->',
    '<!--                                                               -->',
    '<!-- SOURCE COLUMNS                                                -->',
    '<!--  id       optional; auto-generated from name if omitted       -->',
    '<!--  name     required; the provider name shown in the list       -->',
    '<!--  count    optional; article count (number), defaults to 0     -->',
    '<!--  color    optional; hex dot color, e.g. #f97316               -->',
    '<!--  url       optional; feed URL (preserved, not shown yet)      -->',
    '<!-- ============================================================= -->',
    '<almanach version="1">',
    '  <group id="g-example" name="Example group" collapsed="false">',
    '    <subgroup id="sg-example" name="Example subgroup" collapsed="false">',
    '      <source id="" name="Provider one" count="0" color="#f97316" url="https://example.com/feed"/>',
    '      <source id="" name="Provider two" count="0" color="#3b82f6"/>',
    '    </subgroup>',
    '    <!-- a source that sits directly under the group, in no subgroup: -->',
    '    <source id="" name="Provider three" count="0" color="#10b981"/>',
    '  </group>',
    '',
    '  <!-- providers that belong to no group: -->',
    '  <ungrouped>',
    '    <source id="" name="Unsorted provider" count="0" color="#a855f7"/>',
    '  </ungrouped>',
    '</almanach>',
  ].join('\n');
}

// ---------- parse ----------

function readSourceEl(el, sinkSources, seen) {
  let id = (el.getAttribute('id') || '').trim();
  const name = (el.getAttribute('name') || '').trim() || 'Untitled source';
  if (!id) id = slug(name) + '-' + Math.random().toString(36).slice(2, 6);
  // de-dupe ids
  let uid = id, n = 2;
  while (seen.has(uid)) { uid = `${id}-${n++}`; }
  seen.add(uid);

  const countRaw = el.getAttribute('count');
  const count = countRaw != null && countRaw !== '' ? (parseInt(countRaw, 10) || 0) : 0;
  const color = (el.getAttribute('color') || '').trim() || DEFAULT_COLORS[sinkSources.length % DEFAULT_COLORS.length];
  const url = (el.getAttribute('url') || '').trim();

  // preserve any unknown attributes
  const _extra = {};
  for (const attr of Array.from(el.attributes)) {
    if (!KNOWN_SOURCE_ATTRS.includes(attr.name)) _extra[attr.name] = attr.value;
  }
  const src = { id: uid, name, count, color };
  if (url) src.url = url;
  if (Object.keys(_extra).length) src._extra = _extra;
  sinkSources.push(src);
  return uid;
}

function parseFromXML(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('This file is not valid XML. ' + (err.textContent || '').split('\n')[0]);
  const root = doc.querySelector('almanach');
  if (!root) throw new Error('Missing root <almanach> element.');

  const sources = [];
  const seen = new Set();
  const groups = [];
  const ungroupedSourceIds = [];
  const seenGroupIds = new Set();

  const uniqueId = (raw, prefix, set) => {
    let id = (raw || '').trim() || prefix + Math.random().toString(36).slice(2, 6);
    let uid = id, n = 2;
    while (set.has(uid)) uid = `${id}-${n++}`;
    set.add(uid);
    return uid;
  };

  for (const gEl of Array.from(root.children)) {
    const tag = gEl.tagName.toLowerCase();
    if (tag === 'group') {
      const gid = uniqueId(gEl.getAttribute('id'), 'g-', seenGroupIds);
      const group = {
        id: gid,
        name: (gEl.getAttribute('name') || '').trim() || 'Untitled group',
        collapsed: gEl.getAttribute('collapsed') === 'true',
        subgroups: [],
        sourceIds: [],
      };
      const seenSgIds = new Set();
      for (const child of Array.from(gEl.children)) {
        const ct = child.tagName.toLowerCase();
        if (ct === 'subgroup') {
          const sg = {
            id: uniqueId(child.getAttribute('id'), 'sg-', seenSgIds),
            name: (child.getAttribute('name') || '').trim() || 'Untitled subgroup',
            collapsed: child.getAttribute('collapsed') === 'true',
            sourceIds: [],
          };
          for (const sEl of Array.from(child.children)) {
            if (sEl.tagName.toLowerCase() === 'source') sg.sourceIds.push(readSourceEl(sEl, sources, seen));
          }
          group.subgroups.push(sg);
        } else if (ct === 'source') {
          group.sourceIds.push(readSourceEl(child, sources, seen));
        }
      }
      groups.push(group);
    } else if (tag === 'ungrouped') {
      for (const sEl of Array.from(gEl.children)) {
        if (sEl.tagName.toLowerCase() === 'source') ungroupedSourceIds.push(readSourceEl(sEl, sources, seen));
      }
    }
  }

  return { sources, groups, ungroupedSourceIds };
}

// ---------- download ----------

function downloadXML(filename, text) {
  const blob = new Blob([text], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- toolbar UI ----------

function SourcesIO({ state, onImport }) {
  const [open, setOpen] = useStateIO(false);
  const [msg, setMsg] = useStateIO(null); // {kind:'ok'|'err', text}
  const ref = useRefIO(null);
  const fileRef = useRefIO(null);

  useEffectIO(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  useEffectIO(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);

  const stamp = () => new Date().toISOString().slice(0, 10);
  const srcCount = state.sources.length;

  const doExport = () => {
    downloadXML(`almanach-sources-${stamp()}.xml`, serializeToXML(state));
    setOpen(false);
    setMsg({ kind: 'ok', text: `Exported ${srcCount} sources.` });
  };
  const doTemplate = () => {
    downloadXML('almanach-sources-template.xml', buildTemplateXML());
    setOpen(false);
    setMsg({ kind: 'ok', text: 'Blank template downloaded.' });
  };
  const pickFile = () => { setOpen(false); fileRef.current?.click(); };
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const next = parseFromXML(text);
      onImport(next);
      const n = next.sources.length;
      const g = next.groups.length;
      setMsg({ kind: 'ok', text: `Imported ${n} source${n !== 1 ? 's' : ''} across ${g} group${g !== 1 ? 's' : ''}.` });
    } catch (err) {
      setMsg({ kind: 'err', text: err.message || 'Could not read that file.' });
    }
  };

  return (
    <div className="io-wrap" ref={ref}>
      <button className={`io-btn ${open ? 'active' : ''}`} onClick={() => setOpen(o => !o)} title="Import / export sources (XML)">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2v7M5 6l3 3 3-3"/><path d="M2.5 11.5v1a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1"/>
        </svg>
        <span>Sources data</span>
        <svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginLeft: 1 }}><path d="M3 5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>

      {open && (
        <div className="io-menu" role="menu">
          <div className="io-menu-sec">Export</div>
          <button className="io-item" onClick={doExport}>
            <span className="io-item-ic">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v7M5 6l3 3 3-3"/><path d="M2.5 11.5v1a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1"/></svg>
            </span>
            <span className="io-item-body">
              <span className="io-item-title">Export current sources</span>
              <span className="io-item-sub">{srcCount} sources, full hierarchy → XML</span>
            </span>
          </button>
          <button className="io-item" onClick={doTemplate}>
            <span className="io-item-ic">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/></svg>
            </span>
            <span className="io-item-body">
              <span className="io-item-title">Download blank template</span>
              <span className="io-item-sub">Empty XML with the schema + guide</span>
            </span>
          </button>
          <div className="io-menu-div"></div>
          <div className="io-menu-sec">Import</div>
          <button className="io-item" onClick={pickFile}>
            <span className="io-item-ic">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 10V3M5 6l3-3 3 3"/><path d="M2.5 11.5v1a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1"/></svg>
            </span>
            <span className="io-item-body">
              <span className="io-item-title">Upload XML file</span>
              <span className="io-item-sub">Replaces the whole list — no confirmation</span>
            </span>
          </button>
          <input ref={fileRef} type="file" accept=".xml,application/xml,text/xml" style={{ display: 'none' }} onChange={onFile} />
        </div>
      )}

      {msg && (
        <div className={`io-toast ${msg.kind}`} role="status">
          {msg.kind === 'ok'
            ? <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.5 3.5L13 4"/></svg>
            : <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M8 4v5M8 11.5v.5"/></svg>}
          <span>{msg.text}</span>
        </div>
      )}
    </div>
  );
}

window.AlmanachIO = { serializeToXML, parseFromXML, buildTemplateXML, downloadXML };
window.AlmanachSourcesIO = SourcesIO;
