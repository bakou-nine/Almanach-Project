from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from . import models, scheduler


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


def build_sidebar_view() -> dict:
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
    """
    sources = models.list_sources()
    unread_map = models.unread_counts_per_source()
    total_unread = models.total_unread_excluding_muted()

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
    }


def build_feed_view(
    *,
    source_id: Optional[str],
    page_size: int,
    after: Optional[str] = None,
) -> dict:
    """Build the feed payload.

    Per CR-260522-2101-001 iteration 2 (US-260522-2230-003), pagination is
    replaced by cursor-style continuous scroll. The client appends successive
    batches by passing the oldest-rendered `published_at` as `after`.

    Per AC-260522-2234-001 (US-260522-2230-002), the combined-feed query
    filters out articles whose Source's parent Group or Subgroup is muted.
    Explicit source-filtered views ignore the cascade (mirror of FT04 mute
    behaviour).
    """
    articles = models.list_articles(
        source_id=source_id, limit=page_size, after=after
    )
    total = models.count_articles(source_id=source_id)
    next_after = articles[-1]["published_at"] if articles else None
    has_more = len(articles) >= page_size

    active_source = models.get_source(source_id) if source_id else None
    if active_source is not None:
        title = active_source["display_name"]
        active_count = 1
    else:
        title = "Latest news"
        active_count = sum(1 for s in models.list_sources() if not s["muted"])

    items: list[dict] = []
    for a in articles:
        items.append(
            {
                "id": a["id"],
                "url": a["url"],
                "title": a["title"],
                "summary": a.get("summary"),
                "source_name": a["source_name"],
                "source_colour": a["source_colour"],
                "published_at": a["published_at"],
                "relative_time": _humanise_delta(_parse_iso(a["published_at"])),
                "is_unread": a["read_at"] is None,
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
        "page_size": page_size,
        "after": after,
        "next_after": next_after,
        "has_more": has_more,
        "banner_visible": banner_visible,
    }


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
