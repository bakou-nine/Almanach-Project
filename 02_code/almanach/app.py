from __future__ import annotations

import logging
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Form, HTTPException, Query, Request
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


@app.get("/", response_class=HTMLResponse)
async def index(
    request: Request,
    source: Optional[str] = Query(None, description="Active Source.id filter"),
    page: int = Query(1, ge=1),
    size: int = Query(config.PAGE_SIZE_DEFAULT, ge=1, le=config.PAGE_SIZE_MAX),
) -> HTMLResponse:
    if source is not None:
        src = models.get_source(source)
        if src is None or src["muted"]:
            return RedirectResponse(url="/", status_code=303)
    sidebar = views.build_sidebar_view()
    feed = views.build_feed_view(source_id=source, page=page, page_size=size)
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "sidebar": sidebar,
            "feed": feed,
            "active_source_id": source,
        },
    )


# ---------- partials ----------


@app.get("/sidebar-partial", response_class=HTMLResponse)
async def sidebar_partial(
    request: Request,
    active: Optional[str] = Query(None),
) -> HTMLResponse:
    sidebar = views.build_sidebar_view()
    return templates.TemplateResponse(
        "_source_list.html",
        {"request": request, "sidebar": sidebar, "active_source_id": active},
    )


@app.get("/feed-partial", response_class=HTMLResponse)
async def feed_partial(
    request: Request,
    source: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(config.PAGE_SIZE_DEFAULT, ge=1, le=config.PAGE_SIZE_MAX),
) -> HTMLResponse:
    if source is not None:
        src = models.get_source(source)
        if src is None or src["muted"]:
            source = None
    feed = views.build_feed_view(source_id=source, page=page, page_size=size)
    return templates.TemplateResponse(
        "_feed.html",
        {"request": request, "feed": feed, "active_source_id": source},
    )


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
    return


# ---------- article API ----------


@app.post("/articles/{article_id}/read")
async def mark_article_read(article_id: str):
    art = models.get_article(article_id)
    if art is None:
        raise HTTPException(status_code=404, detail="article not found")
    models.mark_read(article_id)
    return {"id": article_id, "read": True}


# ---------- header / system ----------


@app.post("/refresh")
async def manual_refresh():
    scheduler.trigger_manual_poll()
    return {"status": "scheduled"}


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
