from __future__ import annotations

import logging
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Form, HTTPException, Query, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from . import config, db, discovery, models, scheduler, settings_store, views
from .urls import canonical_source_url, is_valid_http_url

log = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"

templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.initialise()
    _seed_if_empty()
    scheduler.start()
    yield
    scheduler.stop()
    db.close()


app = FastAPI(title="Almanach", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# ---------- pages ----------


def _parse_csv(raw: Optional[str]) -> Optional[list[str]]:
    """Split a comma-separated query param. Returns None for None / empty."""
    if raw is None:
        return None
    out = [s.strip() for s in raw.split(",") if s.strip()]
    return out or None


def _zip_keyword_options(
    words: Optional[list[str]], opts: Optional[list[str]]
) -> Optional[list[dict]]:
    """Pair repeatable `keyword` words with their aligned `keyword_opt` codes
    into `{word, match_case, whole_word}` dicts (CR-260524-1315-001).

    Each opt code is two chars (char0 = Match case, char1 = Match whole word,
    '1'/'0'). A missing / malformed code defaults to '00' (both off), so a
    client that sends only `keyword` keeps the prior case-insensitive substring
    behaviour (CR-260524-0644-001).
    """
    if not words:
        return None
    opts = opts or []
    out: list[dict] = []
    for i, w in enumerate(words):
        code = opts[i] if i < len(opts) else ""
        out.append(
            {
                "word": w,
                "match_case": len(code) > 0 and code[0] == "1",
                "whole_word": len(code) > 1 and code[1] == "1",
            }
        )
    return out


@app.get("/", response_class=HTMLResponse)
async def index(
    request: Request,
    source: Optional[str] = Query(None, description="Active Source.id filter"),
    size: int = Query(config.PAGE_SIZE_DEFAULT, ge=1, le=config.PAGE_SIZE_MAX),
) -> HTMLResponse:
    if source is not None:
        src = models.get_source(source)
        if src is None or src["muted"]:
            return RedirectResponse(url="/", status_code=303)
    sidebar = views.build_sidebar_view()
    feed = views.build_feed_view(source_id=source, page_size=size)
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "sidebar": sidebar,
            "feed": feed,
            "active_source_id": source,
            "active_folder_id": None,
        },
    )


# ---------- partials ----------


@app.get("/sidebar-partial", response_class=HTMLResponse)
async def sidebar_partial(
    request: Request,
    active: Optional[str] = Query(None),
    scope: Optional[str] = Query(None, description="Active folder scope (CR-260523-1501-001)"),
    from_: Optional[str] = Query(None, alias="from", description="Lower bound on published_at (CR-260523-1630-001)"),
    to: Optional[str] = Query(None, description="Upper bound on published_at (CR-260523-1630-001)"),
) -> HTMLResponse:
    sidebar = views.build_sidebar_view(
        from_date=from_ or None,
        to_date=to or None,
    )
    return templates.TemplateResponse(
        "_source_list.html",
        {
            "request": request,
            "sidebar": sidebar,
            "active_source_id": active,
            "active_folder_id": scope,
        },
    )


@app.get("/feed-partial", response_class=HTMLResponse)
async def feed_partial(
    request: Request,
    source: Optional[str] = Query(None),
    size: int = Query(config.PAGE_SIZE_DEFAULT, ge=1, le=config.PAGE_SIZE_MAX),
    after: Optional[str] = Query(None, description="Cursor: published_at to fetch articles older than"),
    rows_only: bool = Query(False, description="If true, return only article rows (no feed header) for scroll-append"),
    from_: Optional[str] = Query(None, alias="from", description="Lower bound on published_at (ISO)"),
    to: Optional[str] = Query(None, description="Upper bound on published_at (ISO)"),
    source_ids: Optional[str] = Query(None, description="Comma-separated source ids (filter bar multi-select)"),
    folder_ids: Optional[str] = Query(None, description="Comma-separated folder ids (filter bar multi-select)"),
    scope_folder_id: Optional[str] = Query(None, description="Sidebar Group/Subgroup scope"),
    keyword: Optional[list[str]] = Query(None, description="Keyword(s) on title/summary; repeatable (CR-260524-0644-001)"),
    keyword_opt: Optional[list[str]] = Query(None, description="Per-keyword 2-char option code aligned to `keyword` order: char0=Match case, char1=Match whole word ('1'/'0'); defaults '00' (CR-260524-1315-001)"),
    keyword_mode: str = Query("any", description="How multiple keywords combine: 'any' (OR) | 'all' (AND)"),
) -> HTMLResponse:
    """Feed partial endpoint.

    Two modes per CR-260522-2101-001 iteration 2 / US-260522-2230-003:
    - **Full** (`rows_only=False`, default): returns the full feed pane
      (header + filter bar + initial article batch). The client replaces
      `#feed-pane` innerHTML on source-filter / scope / filter change.
    - **Rows-only** (`rows_only=True`): returns just the `.article` rows
      for the next batch starting after the supplied `after` cursor.

    Filter parameters (CR-260523-1500-001 / CR-260523-1501-001 / CR-260524-0644-001):
      `from`, `to`, `source_ids`, `folder_ids`, `scope_folder_id`, `keyword`
      (repeatable), `keyword_mode`.
    """
    if source is not None:
        src = models.get_source(source)
        if src is None or src["muted"]:
            source = None
    if scope_folder_id is not None and models.get_folder(scope_folder_id) is None:
        scope_folder_id = None
    feed = views.build_feed_view(
        source_id=source,
        page_size=size,
        after=after,
        from_date=from_ or None,
        to_date=to or None,
        source_ids=_parse_csv(source_ids),
        folder_ids=_parse_csv(folder_ids),
        scope_folder_id=scope_folder_id,
        keywords=_zip_keyword_options(keyword, keyword_opt),
        keyword_mode=keyword_mode,
    )
    template = "_feed_rows.html" if rows_only else "_feed.html"
    return templates.TemplateResponse(
        template,
        {
            "request": request,
            "feed": feed,
            "active_source_id": source,
            "active_folder_id": scope_folder_id,
        },
    )


@app.get("/filter-tree")
async def filter_tree() -> dict:
    """Return the flattened source tree for the filter-bar content dropdown
    (CR-260523-1500-001). Mirrors sidebar order but is a JSON list, not HTML.
    """
    return {"tree": views.list_filter_tree()}


# ---------- source API ----------


class DupCheckIn(BaseModel):
    url: str


class DupCheckOut(BaseModel):
    is_duplicate: bool
    existing_source_id: Optional[str] = None


@app.post("/sources/check-duplicate", response_model=DupCheckOut)
async def check_duplicate(payload: DupCheckIn) -> DupCheckOut:
    if not is_valid_http_url(payload.url):
        raise HTTPException(status_code=400, detail="Invalid URL — must use http or https with a host.")
    canonical = canonical_source_url(payload.url)
    existing = models.find_source_by_canonical_url(canonical)
    if existing is None:
        return DupCheckOut(is_duplicate=False)
    return DupCheckOut(is_duplicate=True, existing_source_id=existing["id"])


class AddSourceIn(BaseModel):
    url: str


class AddSourceErrorOut(BaseModel):
    error: str
    details: Optional[str] = None
    message: str


@app.post("/sources", status_code=201)
async def create_source(payload: AddSourceIn):
    if not is_valid_http_url(payload.url):
        raise HTTPException(
            status_code=422,
            detail={
                "error": "invalid_url",
                "details": "URL must use http or https and include a host.",
                "message": "Invalid URL — must start with http:// or https://.",
            },
        )
    canonical = canonical_source_url(payload.url)
    if models.find_source_by_canonical_url(canonical) is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "duplicate",
                "details": "A source with this canonical URL already exists.",
                "message": "Already added.",
            },
        )

    result = discovery.discover(canonical)
    if not result.success:
        raise HTTPException(
            status_code=422,
            detail={
                "error": result.error or "fetch_error",
                "details": result.details,
                "message": discovery.humanise(result.error),
            },
        )

    display_name = _resolve_display_name(result.feed_url, canonical)
    colour = settings_store.next_palette_colour()
    src = models.insert_source(
        url=canonical,
        feed_url=result.feed_url,
        discovery_method=result.method,
        display_name=display_name,
        colour=colour,
    )
    # Kick off a poll for this source so the feed populates immediately.
    scheduler.trigger_manual_poll()
    return {
        "id": src["id"],
        "url": src["url"],
        "feed_url": src["feed_url"],
        "discovery_method": src["discovery_method"],
        "display_name": src["display_name"],
        "colour": src["colour"],
        "muted": bool(src["muted"]),
    }


class RenameIn(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)


@app.patch("/sources/{source_id}")
async def patch_source(source_id: str, payload: RenameIn):
    src = models.get_source(source_id)
    if src is None:
        raise HTTPException(status_code=404, detail="source not found")
    label = payload.display_name.strip()
    if not label:
        raise HTTPException(status_code=400, detail="display_name cannot be blank")
    models.update_display_name(source_id, label)
    return {"id": source_id, "display_name": label}


class MuteIn(BaseModel):
    muted: bool


@app.patch("/sources/{source_id}/mute")
async def patch_mute(source_id: str, payload: MuteIn):
    src = models.get_source(source_id)
    if src is None:
        raise HTTPException(status_code=404, detail="source not found")
    models.set_muted(source_id, payload.muted)
    return {"id": source_id, "muted": payload.muted}


@app.delete("/sources/{source_id}", status_code=204)
async def remove_source(source_id: str):
    src = models.get_source(source_id)
    if src is None:
        raise HTTPException(status_code=404, detail="source not found")
    models.delete_source(source_id)
    return Response(status_code=204)


# ---------- folder API (FT05 / CR-260522-2101-001 iteration 3) ----------


_NAME_MIN = 1
_NAME_MAX = 60


def _validate_folder_name(raw: Optional[str]) -> str:
    """Trim + length-check a folder name. Raises 422 on failure."""
    candidate = (raw or "").strip()
    if len(candidate) < _NAME_MIN or len(candidate) > _NAME_MAX:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "invalid_name",
                "details": "folder name must be 1-60 characters after trim.",
                "message": "Folder name must be 1-60 characters",
            },
        )
    return candidate


class FolderCreateIn(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[str] = None


class FolderPatchIn(BaseModel):
    name: Optional[str] = None
    position: Optional[float] = None
    collapsed: Optional[bool] = None
    muted: Optional[bool] = None
    parent_id: Optional[str] = None
    # When the client wants to make a folder a root (parent_id=NULL), we accept
    # the explicit literal — see `parent_id_is_set` flag passed via Pydantic
    # `fields_set`.

    class Config:
        # We rely on `__pydantic_fields_set__` to differentiate "field omitted"
        # from "field set to null" — Pydantic v1 / v2 expose this consistently.
        pass


def _folder_payload(f: dict) -> dict:
    return {
        "id": f["id"],
        "parent_id": f["parent_id"],
        "name": f["name"],
        "position": f["position"],
        "collapsed": bool(f["collapsed"]),
        "muted": bool(f["muted"]),
        "depth": f["depth"],
    }


@app.post("/folders", status_code=201)
async def create_folder(payload: FolderCreateIn):
    name = _validate_folder_name(payload.name)
    if payload.parent_id is not None and models.get_folder(payload.parent_id) is None:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "parent_not_found",
                "details": "Supplied parent_id does not match any folder.",
                "message": "Parent folder not found.",
            },
        )
    try:
        # First-folder creation also auto-dismisses the onboarding banner per
        # the iteration-1 AC-260522-2118-030 contract (retargeted to /folders).
        folder = models.insert_folder_with_banner_dismiss(
            name, parent_id=payload.parent_id
        )
    except models.DepthLimitExceeded as e:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "depth_limit",
                "details": str(e),
                "message": "Maximum folder nesting depth is 5.",
            },
        )
    return _folder_payload(folder)


@app.patch("/folders/{folder_id}")
async def patch_folder(folder_id: str, payload: FolderPatchIn):
    if models.get_folder(folder_id) is None:
        raise HTTPException(status_code=404, detail="folder not found")
    name = _validate_folder_name(payload.name) if payload.name is not None else None
    # Detect explicit parent_id usage — Pydantic exposes `model_fields_set`
    # (v2) / `__fields_set__` (v1). Use either; default to "unchanged" if
    # not in the explicit-set list (so a missing field doesn't reparent).
    fields_set = getattr(payload, "model_fields_set", None) or getattr(payload, "__fields_set__", set())
    if "parent_id" in fields_set:
        if payload.parent_id is not None and models.get_folder(payload.parent_id) is None:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "parent_not_found",
                    "details": "Supplied parent_id does not match any folder.",
                    "message": "Target folder not found.",
                },
            )
        try:
            models.update_folder(
                folder_id,
                name=name,
                position=payload.position,
                collapsed=payload.collapsed,
                muted=payload.muted,
                parent_id=payload.parent_id,
            )
        except models.DepthLimitExceeded as e:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "depth_limit",
                    "details": str(e),
                    "message": "Maximum folder nesting depth is 5.",
                },
            )
        except models.CycleViolation as e:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "cycle",
                    "details": str(e),
                    "message": "Cannot move a folder under one of its own descendants.",
                },
            )
    else:
        models.update_folder(
            folder_id,
            name=name,
            position=payload.position,
            collapsed=payload.collapsed,
            muted=payload.muted,
        )
    return _folder_payload(models.get_folder(folder_id))


@app.delete("/folders/{folder_id}", status_code=204)
async def delete_folder(folder_id: str):
    if models.get_folder(folder_id) is None:
        raise HTTPException(status_code=404, detail="folder not found")
    models.delete_folder(folder_id)
    return Response(status_code=204)


class SourceParentIn(BaseModel):
    folder_id: Optional[str] = None
    position: Optional[float] = None


@app.patch("/sources/{source_id}/parent")
async def patch_source_parent(source_id: str, payload: SourceParentIn):
    src = models.get_source(source_id)
    if src is None:
        raise HTTPException(status_code=404, detail="source not found")
    try:
        models.set_source_folder(
            source_id,
            folder_id=payload.folder_id,
            position=payload.position,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "parent_not_found",
                "details": str(e),
                "message": "Folder not found.",
            },
        )
    return {
        "id": source_id,
        "folder_id": payload.folder_id,
    }


class BannerDismissIn(BaseModel):
    dismissed: bool


@app.patch("/settings/grouping_banner_dismissed")
async def patch_grouping_banner(payload: BannerDismissIn):
    models.set_grouping_banner_dismissed(payload.dismissed)
    return {"grouping_banner_dismissed": payload.dismissed}


class SidebarWidthIn(BaseModel):
    width_px: int = Field(ge=0, le=10000)


@app.patch("/settings/sidebar_width_px")
async def patch_sidebar_width(payload: SidebarWidthIn):
    """Persist user-chosen sidebar width (CR-260523-0900-004)."""
    clamped = models.set_sidebar_width_px(payload.width_px)
    return {"sidebar_width_px": clamped}


# ---------- article API ----------


@app.post("/articles/{article_id}/read")
async def mark_article_read(article_id: str):
    art = models.get_article(article_id)
    if art is None:
        raise HTTPException(status_code=404, detail="article not found")
    models.mark_read(article_id)
    return {"id": article_id, "read": True}


class ArticleParentIn(BaseModel):
    folder_id: Optional[str] = None
    position: Optional[float] = None


@app.patch("/articles/{article_id}/parent")
async def patch_article_parent(article_id: str, payload: ArticleParentIn):
    """Reassign an article to a folder (CR-260523-0900-001 AC-260523-0900-022).

    NULL `folder_id` returns the article to inheriting from its Source.
    """
    art = models.get_article(article_id)
    if art is None:
        raise HTTPException(status_code=404, detail="article not found")
    try:
        models.set_article_folder(
            article_id,
            folder_id=payload.folder_id,
            position=payload.position,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "parent_not_found",
                "details": str(e),
                "message": "Folder not found.",
            },
        )
    return {"id": article_id, "folder_id": payload.folder_id}


# ---------- promote / demote (CR-260523-0900-001) ----------


class PromoteDemoteIn(BaseModel):
    # For demote, the frontend identifies the preceding sibling whose group/
    # folder the row should inherit. Omitted on promote.
    preceding_id: Optional[str] = None


@app.patch("/sources/{source_id}/promote")
async def promote_source_endpoint(source_id: str):
    if models.get_source(source_id) is None:
        raise HTTPException(status_code=404, detail="source not found")
    return models.promote_source(source_id)


@app.patch("/sources/{source_id}/demote")
async def demote_source_endpoint(source_id: str, payload: PromoteDemoteIn):
    if models.get_source(source_id) is None:
        raise HTTPException(status_code=404, detail="source not found")
    return models.demote_source(source_id, payload.preceding_id)


@app.patch("/folders/{folder_id}/promote")
async def promote_folder_endpoint(folder_id: str):
    if models.get_folder(folder_id) is None:
        raise HTTPException(status_code=404, detail="folder not found")
    try:
        return models.promote_folder(folder_id)
    except (models.DepthLimitExceeded, models.CycleViolation) as e:
        raise HTTPException(status_code=422, detail={"error": "invalid_move", "message": str(e)})


@app.patch("/folders/{folder_id}/demote")
async def demote_folder_endpoint(folder_id: str, payload: PromoteDemoteIn):
    if models.get_folder(folder_id) is None:
        raise HTTPException(status_code=404, detail="folder not found")
    try:
        return models.demote_folder(folder_id, payload.preceding_id)
    except models.DepthLimitExceeded as e:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "depth_limit",
                "details": str(e),
                "message": "Maximum folder nesting depth is 5.",
            },
        )
    except models.CycleViolation as e:
        raise HTTPException(status_code=422, detail={"error": "cycle", "message": str(e)})


@app.patch("/articles/{article_id}/promote")
async def promote_article_endpoint(article_id: str):
    if models.get_article(article_id) is None:
        raise HTTPException(status_code=404, detail="article not found")
    return models.promote_article(article_id)


# ---------- header / system ----------


@app.post("/refresh")
async def manual_refresh():
    """Run a poll cycle synchronously so the response only returns when done.

    Frontend (US-260522-2050-004) treats this completion as the trigger to
    end the button loading state and update the header last-sync indicator.
    """
    await run_in_threadpool(scheduler.run_manual_poll_blocking)
    return {
        "status": "completed",
        "last_sync": views.humanise_delta(scheduler.last_sync_at()),
    }


@app.get("/last-sync")
async def last_sync() -> dict:
    """Return the current humanised last-sync text.

    Used by the frontend to refresh #last-sync-label without a full page reload
    (US-260522-2050-003 + AC-260522-2030-007/009).
    """
    return {"last_sync": views.humanise_delta(scheduler.last_sync_at())}


# ---------- helpers ----------


def _resolve_display_name(feed_url: str, canonical: str) -> str:
    """Best-effort: fetch the feed and use its <title>; fall back to host."""
    try:
        import feedparser

        from . import ingestion as _ing  # avoid circular import at module top

        raw = _ing.fetch_feed_bytes(feed_url, timeout=5)
        parsed = feedparser.parse(raw)
        title = (parsed.feed.get("title") if hasattr(parsed, "feed") else None) or ""
        title = title.strip()
        if title:
            return title[:120]
    except Exception:
        pass
    from urllib.parse import urlparse

    host = urlparse(canonical).hostname or canonical
    if host.startswith("www."):
        host = host[4:]
    return host


SEED_SOURCES = [
    "https://www.theverge.com",
    "https://arstechnica.com",
    "https://news.ycombinator.com",
    "https://www.bbc.com/news",
    "https://www.reuters.com",
    "https://www.lemonde.fr",
    "https://www.lesechos.fr",
    "https://feeds.npr.org/1001/rss.xml",
    "https://techcrunch.com",
    "https://www.theguardian.com/international",
]


def _seed_if_empty() -> None:
    """First-run seed: add up to 10 popular sources if the DB has no sources.

    Each seed is added through the same discovery + persist path used by the
    UI — failures are tolerated (a seed that no longer publishes a feed is
    skipped, not fatal).
    """
    if models.list_sources():
        return
    for raw in SEED_SOURCES:
        try:
            canonical = canonical_source_url(raw)
            if models.find_source_by_canonical_url(canonical):
                continue
            result = discovery.discover(canonical)
            if not result.success:
                log.info("seed skipped (%s): %s", raw, result.error)
                continue
            display_name = _resolve_display_name(result.feed_url, canonical)
            colour = settings_store.next_palette_colour()
            models.insert_source(
                url=canonical,
                feed_url=result.feed_url,
                discovery_method=result.method,
                display_name=display_name,
                colour=colour,
            )
            log.info("seeded source: %s (%s)", display_name, raw)
        except Exception as e:
            log.warning("seed failed for %s: %s", raw, e)
