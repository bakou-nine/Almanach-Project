from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from . import models, scheduler
from .urls import clean_html_text


def humanise_delta(then: Optional[datetime]) -> str:
    if then is None:
        return "never"
    now = datetime.now(timezone.utc)
    delta = now - then
    seconds = int(delta.total_seconds())
    if seconds < 60:
        return "just now" if seconds < 5 else f"{seconds} sec ago"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes} min ago"
    hours = minutes // 60
    if hours < 24:
        return f"{hours} h ago"
    days = hours // 24
    return f"{days} d ago"


# Back-compat alias for any internal caller still using the underscore form.
_humanise_delta = humanise_delta


def build_sidebar_view(
    *,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
) -> dict:
    """Build the sidebar render payload.

    Two render modes (FT05 / CR-260522-2101-001 iteration 3):
      - **tree_mode = False** → FT03 flat list (no folders exist). Sidebar
        shape identical to pre-CR; `sources` holds every source.
      - **tree_mode = True** → FT05 recursive tree. `roots` carries the
        nested Folder → … → Folder → Source structure (depth ≤ 5);
        `ungrouped_sources` holds the Ungrouped overflow zone (always
        rendered when tree_mode is True, even when empty).

    Each folder node carries: id, parent_id, name, depth, collapsed, muted,
    cascade_muted (true if folder is muted OR any ancestor is muted),
    position, unread (recursive sum), `children` (child folders), `sources`
    (direct-attached sources).

    Optional `from_date` / `to_date` (CR-260523-1630-001) narrow every unread
    pill — per-source, recursive folder sums, and the All-sources total — to
    articles whose `published_at` falls within the inclusive window. Muted
    cascade semantics are preserved regardless of the predicate.
    """
    sources = models.list_sources()
    unread_map = models.unread_counts_per_source(
        from_date=from_date, to_date=to_date
    )
    total_unread = models.total_unread_excluding_muted(
        from_date=from_date, to_date=to_date
    )

    rows: list[dict] = []
    for s in sources:
        rows.append(
            {
                "id": s["id"],
                "display_name": s["display_name"],
                "colour": s["colour"],
                "muted": bool(s["muted"]),
                "unread": 0 if s["muted"] else unread_map.get(s["id"], 0),
                "folder_id": s.get("folder_id"),
                "position": s.get("position") or 0,
            }
        )

    folders = models.list_folders()
    tree_mode = len(folders) > 0
    roots: list[dict] = []
    ungrouped_sources: list[dict] = []

    if tree_mode:
        # Group sources by their folder_id.
        sources_by_folder: dict[str, list[dict]] = {}
        for r in rows:
            if r["folder_id"]:
                sources_by_folder.setdefault(r["folder_id"], []).append(r)
            else:
                ungrouped_sources.append(r)

        # Build a node map + children index.
        muted_set = models.muted_folder_subtree_ids()
        nodes: dict[str, dict] = {}
        children_of: dict[Optional[str], list[dict]] = {None: []}
        for f in folders:
            fid = f["id"]
            cascade_muted = fid in muted_set
            srcs = sources_by_folder.get(fid, [])
            node = {
                "id": fid,
                "parent_id": f["parent_id"],
                "name": f["name"],
                "depth": int(f["depth"]),
                "collapsed": bool(f["collapsed"]),
                "muted": bool(f["muted"]),
                "cascade_muted": cascade_muted,
                "position": f["position"],
                "sources": srcs,
                "children": [],
                # `unread` computed bottom-up below.
                "unread": 0,
            }
            nodes[fid] = node
            children_of.setdefault(f["parent_id"], []).append(node)

        # Wire children references (folders already come sorted by depth ASC
        # then position ASC, so processing them in order yields a
        # topologically-sorted parent → child chain).
        for node in nodes.values():
            node["children"] = children_of.get(node["id"], [])
            # Sort children by position then created_at (folders already
            # globally sorted, but per-parent ordering needs explicit sort
            # here so children_of preserves position order — which it does
            # because list_folders ORDER BY position ASC).

        # Compute recursive unread counts. Walk bottom-up by depth desc.
        for f in sorted(folders, key=lambda r: int(r["depth"]), reverse=True):
            node = nodes[f["id"]]
            if node["cascade_muted"]:
                node["unread"] = 0
                continue
            direct = sum(s["unread"] for s in node["sources"])
            kids = sum(c["unread"] for c in node["children"])
            node["unread"] = direct + kids

        roots = children_of.get(None, [])

    return {
        "sources": rows,
        "tree_mode": tree_mode,
        "roots": roots,
        "ungrouped_sources": ungrouped_sources,
        "ungrouped_unread": sum(s["unread"] for s in ungrouped_sources),
        "banner_visible": (not tree_mode)
        and (not models.get_grouping_banner_dismissed()),
        "total_unread": total_unread,
        "last_sync": humanise_delta(scheduler.last_sync_at()),
        "sidebar_width_px": models.get_sidebar_width_px(),
    }


def build_feed_view(
    *,
    source_id: Optional[str],
    page_size: int,
    after: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    source_ids: Optional[list[str]] = None,
    folder_ids: Optional[list[str]] = None,
    scope_folder_id: Optional[str] = None,
    keywords: Optional[list[dict]] = None,
    keyword_mode: str = "any",
) -> dict:
    """Build the feed payload.

    Per CR-260522-2101-001 iteration 2 (US-260522-2230-003), pagination is
    replaced by cursor-style continuous scroll. The client appends successive
    batches by passing the oldest-rendered `published_at` as `after`.

    Per AC-260522-2234-001 (US-260522-2230-002), the combined-feed query
    filters out articles whose Source's parent Group or Subgroup is muted.
    Explicit source-filtered views ignore the cascade (mirror of FT04 mute
    behaviour).

    Filter parameters (CR-260523-1500-001 / CR-260523-1501-001 / CR-260524-0644-001):
      - `from_date` / `to_date`: ISO bounds on `Article.published_at`.
      - `source_ids` / `folder_ids`: filter-bar content multi-select.
      - `scope_folder_id`: sidebar Group/Subgroup scope.
      - `keywords`: list of per-keyword dicts `{word, match_case, whole_word}`
        on title/summary; each active keyword is a removable chip. Match case /
        Match whole word are chosen per keyword at add time (CR-260524-1315-001);
        with neither set the keyword keeps the case-insensitive substring
        behaviour (AC-260524-0650-001). They combine via `keyword_mode`
        ("any" = OR, "all" = AND); blank/duplicate (case-insensitive on the
        word) entries are dropped (CR-260524-0644-001 AC-260524-0650-001/003).
      - `keyword_mode`: "any" (OR, default) or "all" (AND) — how the keywords
        combine with each other (AC-260524-0650-004).
    """
    keyword_mode = "all" if keyword_mode == "all" else "any"
    norm_keywords: list[dict] = []
    _seen: set[str] = set()
    for _kw in keywords or []:
        _word = (_kw.get("word") or "").strip()
        if not _word:
            continue
        _low = _word.lower()
        if _low in _seen:
            continue
        _seen.add(_low)
        norm_keywords.append(
            {
                "word": _word,
                "match_case": bool(_kw.get("match_case")),
                "whole_word": bool(_kw.get("whole_word")),
            }
        )
    articles = models.list_articles(
        source_id=source_id,
        limit=page_size,
        after=after,
        from_date=from_date,
        to_date=to_date,
        source_ids=source_ids,
        folder_ids=folder_ids,
        scope_folder_id=scope_folder_id,
        keywords=norm_keywords,
        keyword_mode=keyword_mode,
    )
    total = models.count_articles(
        source_id=source_id,
        from_date=from_date,
        to_date=to_date,
        source_ids=source_ids,
        folder_ids=folder_ids,
        scope_folder_id=scope_folder_id,
        keywords=norm_keywords,
        keyword_mode=keyword_mode,
    )
    next_after = articles[-1]["published_at"] if articles else None
    has_more = len(articles) >= page_size

    scope_folder = (
        models.get_folder(scope_folder_id) if scope_folder_id else None
    )
    scope_folder_name = scope_folder["name"] if scope_folder else None

    active_source = models.get_source(source_id) if source_id else None
    if active_source is not None:
        title = active_source["display_name"]
        active_count = 1
    elif scope_folder_name:
        title = scope_folder_name
        active_count = None
    else:
        title = "Latest news"
        active_count = sum(1 for s in models.list_sources() if not s["muted"])
        # CR-260525-0745-002: a single-branch sidebar selection now flows through
        # the content filter (no scope_folder_id). Preserve the friendly feed
        # title — name the lone selected source/folder when it is the only active
        # predicate. Any multi-select or extra filter keeps the generic title.
        only_content = not (from_date or to_date or norm_keywords)
        if only_content and folder_ids and len(folder_ids) == 1 and not source_ids:
            f = models.get_folder(folder_ids[0])
            if f:
                title = f["name"]
                active_count = None
        elif only_content and source_ids and len(source_ids) == 1 and not folder_ids:
            s = models.get_source(source_ids[0])
            if s:
                title = s["display_name"]
                active_count = 1

    has_filters = any(
        [
            from_date,
            to_date,
            source_ids,
            folder_ids,
            norm_keywords,
        ]
    )

    items: list[dict] = []
    for a in articles:
        items.append(
            {
                "id": a["id"],
                "url": a["url"],
                "title": a["title"],
                # BUG-260525-0745-001: clean any stored raw-HTML summary at
                # render so existing rows display plain text too (idempotent on
                # rows ingested after the ingestion-side fix).
                "summary": clean_html_text(a.get("summary")),
                "source_name": a["source_name"],
                "source_colour": a["source_colour"],
                "published_at": a["published_at"],
                "relative_time": _humanise_delta(_parse_iso(a["published_at"])),
                "is_unread": a["read_at"] is None,
                "folder_id": a.get("folder_id"),
            }
        )
    # Banner visibility — first-run only, mirrors sidebar.banner_visible logic
    # so /feed-partial can render the banner without needing a sidebar payload.
    tree_mode = models.count_folders() > 0
    banner_visible = (not tree_mode) and (not models.get_grouping_banner_dismissed())

    return {
        "title": title,
        "articles": items,
        "total_articles": total,
        "active_sources": active_count,
        "active_source_id": source_id,
        "scope_folder_id": scope_folder_id,
        "scope_folder_name": scope_folder_name,
        "has_filters": has_filters,
        "has_scope": scope_folder_id is not None,
        "filter_from": from_date,
        "filter_to": to_date,
        "filter_source_ids": source_ids or [],
        "filter_folder_ids": folder_ids or [],
        "filter_keywords": norm_keywords,
        "filter_keyword_mode": keyword_mode,
        "page_size": page_size,
        "after": after,
        "next_after": next_after,
        "has_more": has_more,
        "banner_visible": banner_visible,
    }


def list_filter_tree() -> list[dict]:
    """Return the sidebar tree shape collapsed to a flat list, used to render
    the filter-bar content-selection dropdown.

    Each entry: {kind: "folder"|"source", id, name, depth, parent_id, colour?}
    Folders precede their contents; ungrouped sources appear at the end under
    a synthetic header. Muted sources are included (the filter dropdown lets
    the user opt in to muted sources explicitly).
    """
    folders = models.list_folders()
    sources = models.list_sources()
    sources_by_folder: dict[Optional[str], list[dict]] = {}
    for s in sources:
        sources_by_folder.setdefault(s.get("folder_id"), []).append(s)

    children_of: dict[Optional[str], list[dict]] = {None: []}
    by_id: dict[str, dict] = {}
    for f in folders:
        node = dict(f)
        by_id[f["id"]] = node
        children_of.setdefault(f["parent_id"], []).append(node)

    out: list[dict] = []

    def emit_folder(node: dict) -> None:
        out.append(
            {
                "kind": "folder",
                "id": node["id"],
                "name": node["name"],
                "depth": int(node["depth"]),
                "parent_id": node["parent_id"],
            }
        )
        # Recurse into child folders first (mirrors sidebar render order).
        for child in children_of.get(node["id"], []):
            emit_folder(child)
        # Then attached sources at depth+1.
        for s in sources_by_folder.get(node["id"], []):
            out.append(
                {
                    "kind": "source",
                    "id": s["id"],
                    "name": s["display_name"],
                    "depth": int(node["depth"]) + 1,
                    "parent_id": node["id"],
                    "colour": s["colour"],
                    "muted": bool(s["muted"]),
                }
            )

    for root in children_of.get(None, []):
        emit_folder(root)

    ungrouped = sources_by_folder.get(None, [])
    if ungrouped:
        out.append(
            {
                "kind": "ungrouped_header",
                "id": "__ungrouped__",
                "name": "Ungrouped",
                "depth": 0,
                "parent_id": None,
            }
        )
        for s in ungrouped:
            out.append(
                {
                    "kind": "source",
                    "id": s["id"],
                    "name": s["display_name"],
                    "depth": 1,
                    "parent_id": None,
                    "colour": s["colour"],
                    "muted": bool(s["muted"]),
                }
            )
    return out


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        # The DB stores naive UTC ISO strings (no offset). Re-attach UTC tz.
        s_clean = s.replace("Z", "")
        dt = datetime.fromisoformat(s_clean)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None
