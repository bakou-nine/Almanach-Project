from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from . import models, scheduler


def _humanise_delta(then: Optional[datetime]) -> str:
    if then is None:
        return "never"
    now = datetime.now(timezone.utc)
    delta = now - then
    seconds = int(delta.total_seconds())
    if seconds < 60:
        return f"{seconds} sec ago"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes} min ago"
    hours = minutes // 60
    if hours < 24:
        return f"{hours} h ago"
    days = hours // 24
    return f"{days} d ago"


def build_sidebar_view() -> dict:
    sources = models.list_sources()
    unread_map = models.unread_counts_per_source()
    total_unread = models.total_unread_excluding_muted()
    rows = []
    for s in sources:
        rows.append(
            {
                "id": s["id"],
                "display_name": s["display_name"],
                "colour": s["colour"],
                "muted": bool(s["muted"]),
                "unread": 0 if s["muted"] else unread_map.get(s["id"], 0),
            }
        )
    return {
        "sources": rows,
        "total_unread": total_unread,
        "last_sync": _humanise_delta(scheduler.last_sync_at()),
    }


def build_feed_view(
    *,
    source_id: Optional[str],
    page: int,
    page_size: int,
) -> dict:
    offset = (page - 1) * page_size
    articles = models.list_articles(
        source_id=source_id, limit=page_size, offset=offset
    )
    total = models.count_articles(source_id=source_id)
    pages = max(1, (total + page_size - 1) // page_size)

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
    return {
        "title": title,
        "articles": items,
        "total_articles": total,
        "active_sources": active_count,
        "active_source_id": source_id,
        "page": page,
        "pages": pages,
        "page_size": page_size,
        "has_prev": page > 1,
        "has_next": page < pages,
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
