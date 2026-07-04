(function () {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const state = {
    activeSourceId: null,
    // Sidebar folder scope (CR-260523-1501-001) — single id or null.
    scopeFolderId: null,
    scopeFolderName: null,
    // Filter bar (CR-260523-1500-001) — date predicates and content multi-select.
    filter: {
      from: null,        // ISO date string "YYYY-MM-DD"
      to: null,          // ISO date string "YYYY-MM-DD"
      shortcut: null,    // "1d" | "1w" | "1m" | null  (mutually-exclusive with from/to)
      sourceIds: [],     // explicit source ids
      folderIds: [],     // folder ids (server expands to subtree)
      // CR-260524-0644-001 / CR-260524-1315-001 — active keyword chips, each
      // {word, matchCase, wholeWord} (trimmed, deduped case-insensitively on word).
      keywords: [],
      keywordMode: "any",// "any" (OR) | "all" (AND) — how multiple keywords combine
      // FT — Source Ratings (US-260525-1200-007): reliability threshold filter
      // (null | "high" | "medium" | "low") + impact sort (null | "impact").
      reliability: null,
      sort: null,
      // CR-260524-1421-001 — sticky "Exact match" toggle: when on, the next word
      // added is committed as a whole-word match (case-insensitive, wholeWord only);
      // off = loose case-insensitive substring (default).
      exactMode: false,
    },
    // Media Content Projects (FT-260704-1620-001): active project view (null =
    // normal news feed), cached /projects list, and the article row the save
    // popover is open for (+ its anchor button).
    activeProjectId: null,
    projects: [],
    saveMenuFor: null,
    saveMenuAnchor: null,
    // Cache of /filter-tree response so reopening the popover is instant.
    filterTree: null,
    filterTreeNameById: null,
    pageSize: 50,
    feedNextAfter: null,
    feedHasMore: false,
    feedLoading: false,
    menuOpenFor: null,
    menuCloseTimer: null,
    overRow: false,
    overMenu: false,
  };

  // BUG-260704-0735-004: monotonic request tokens per pane. Every full
  // re-render bumps its pane's token; a response (or in-flight scroll batch)
  // whose captured token is stale is discarded instead of overwriting newer
  // state — the last user action always wins (AC-260704-0735-007/-008).
  const seq = { feed: 0, sidebar: 0 };

  const HOVER_GRACE_MS = 500;
  const LAST_SYNC_POLL_MS = 15000;
  const REVIEW_POLL_MS = 4000;
  const REFRESH_CONFIRM_MS = 1400;
  const SCROLL_TRIGGER_PX = 200;

  // ----- helpers -----

  function showToast(message, kind) {
    const t = $("#toast");
    t.querySelector(".toast-message").textContent = message;
    t.classList.toggle("toast-error", kind === "error");
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  async function api(path, options) {
    const opts = Object.assign({ headers: {}, cache: "no-store" }, options || {});
    if (opts.body && typeof opts.body !== "string") {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(opts.body);
    }
    const resp = await fetch(path, opts);
    if (!resp.ok) {
      let detail = null;
      try { detail = (await resp.json()).detail || null; } catch (e) { /* ignore */ }
      const err = new Error(resp.statusText);
      err.status = resp.status;
      err.detail = detail;
      throw err;
    }
    if (resp.status === 204) return null;
    const ct = resp.headers.get("content-type") || "";
    return ct.includes("application/json") ? resp.json() : resp.text();
  }

  // ----- sidebar partial swap -----

  // BUG-260704-0735-005: never rejects. On failure the existing sidebar DOM is
  // retained and a toast surfaces the problem. Returns false on failure so
  // callers that report an overall outcome (onManualRefresh) can stay honest.
  async function refreshSidebar() {
    const token = ++seq.sidebar;   // BUG-260704-0735-004
    try {
      const params = new URLSearchParams();
      if (state.activeSourceId) params.set("active", state.activeSourceId);
      if (state.scopeFolderId) params.set("scope", state.scopeFolderId);
      // CR-260523-1630-001: forward the active date predicate so sidebar
      // unread pills narrow with the filter bar. Content multi-select and
      // sidebar scope deliberately NOT forwarded (AC-260523-1630-004).
      const dateBounds = computeFilterDateBounds();
      if (dateBounds.from) params.set("from", dateBounds.from);
      if (dateBounds.to) params.set("to", dateBounds.to);
      const q = params.toString();
      const html = await api("/sidebar-partial" + (q ? "?" + q : ""));
      if (token !== seq.sidebar) return true;   // superseded — drop stale response
      $("#source-list").innerHTML = html;
      bindSidebar();
      bindFolders();
      bindDragDrop();
      bindProjects();
      updateLastSyncLabel();
      // CR-260525-0745-002: re-apply the sidebar selection visuals after a rebuild
      // (the content selection lives in client state, not the server-rendered HTML).
      paintSidebarSelection();
      return true;
    } catch (e) {
      if (token === seq.sidebar) showToast("Could not update the sidebar.", "error");
      return false;
    }
  }

  async function updateLastSyncLabel() {
    try {
      const data = await api("/last-sync");
      const el = $("#last-sync-label");
      if (el && data && typeof data.last_sync === "string") {
        el.textContent = "Last sync · " + data.last_sync;
      }
    } catch (e) { /* silent */ }
  }

  function buildFeedParams() {
    const params = new URLSearchParams();
    // Project view (FT-260704-1620-001): one param, filters don't apply.
    if (state.activeProjectId) {
      params.set("project", state.activeProjectId);
      return params;
    }
    if (state.activeSourceId) params.set("source", state.activeSourceId);
    if (state.scopeFolderId) params.set("scope_folder_id", state.scopeFolderId);
    const dateBounds = computeFilterDateBounds();
    if (dateBounds.from) params.set("from", dateBounds.from);
    if (dateBounds.to) params.set("to", dateBounds.to);
    if (state.filter.sourceIds.length) {
      params.set("source_ids", state.filter.sourceIds.join(","));
    }
    if (state.filter.folderIds.length) {
      params.set("folder_ids", state.filter.folderIds.join(","));
    }
    if (state.filter.keywords.length) {
      // CR-260524-1315-001: each keyword carries an aligned 2-char option code
      // (char0=Match case, char1=Match whole word).
      state.filter.keywords.forEach(k => {
        params.append("keyword", k.word);
        params.append("keyword_opt", (k.matchCase ? "1" : "0") + (k.wholeWord ? "1" : "0"));
      });
      params.set("keyword_mode", state.filter.keywordMode);
    }
    if (state.filter.reliability) params.set("reliability", state.filter.reliability);
    if (state.filter.sort) params.set("sort", state.filter.sort);
    params.set("size", state.pageSize);
    return params;
  }

  // BUG-260704-0735-006: single time semantics for every date bound sent to
  // the server. The DB stores naive-UTC ISO strings, so bounds are serialised
  // as naive UTC too (toISOString minus the Z suffix). Custom-range days are
  // interpreted in the user's LOCAL time and converted — previously they were
  // sent as raw local wall-clock strings while shortcut chips sent UTC, so the
  // same nominal range returned different article sets (AC-260704-0735-011).
  function toNaiveUtc(d) {
    return d.toISOString().replace("Z", "");
  }

  function computeFilterDateBounds() {
    // Shortcut wins if set (mutually exclusive with custom range — UI keeps
    // them in sync). Returns {from, to} as naive-UTC strings, both inclusive.
    if (state.filter.shortcut) {
      const now = new Date();
      const ms = { "1d": 86400e3, "1w": 7 * 86400e3, "1m": 30 * 86400e3 }[state.filter.shortcut];
      return { from: toNaiveUtc(new Date(now.getTime() - ms)), to: null };
    }
    let from = null, to = null;
    if (state.filter.from) from = toNaiveUtc(new Date(state.filter.from + "T00:00:00"));
    if (state.filter.to) to = toNaiveUtc(new Date(state.filter.to + "T23:59:59.999"));
    return { from, to };
  }

  // BUG-260704-0735-005: never rejects. On failure the current feed DOM is
  // retained and a toast surfaces the problem. Returns false on failure.
  async function refreshFeed() {
    // Full reload — replaces the whole feed pane (header + first batch).
    // Resets the scroll cursor.
    const token = ++seq.feed;   // BUG-260704-0735-004
    try {
      const params = buildFeedParams();
      const html = await api("/feed-partial?" + params.toString());
      if (token !== seq.feed) return true;   // superseded — drop stale response
      $("#feed-pane").innerHTML = html;
      readFeedCursor();
      bindFeed();
      bindBanner();
      bindFilterBar();
      // CR-260524-0644-001: keep the keyword input focused after an Enter-apply
      // re-renders the pane, so the user can keep refining without re-clicking.
      if (keywordShouldRefocus) {
        keywordShouldRefocus = false;
        const kw = $("#keyword-input");
        if (kw) {
          kw.focus();
          const v = kw.value;
          kw.value = "";
          kw.value = v;  // move caret to end
        }
      }
      return true;
    } catch (e) {
      if (token === seq.feed) showToast("Could not update the feed.", "error");
      return false;
    }
  }

  function readFeedCursor() {
    // BUG-260525-0654-001: every (re)render starts from a clean scroll state —
    // no in-flight fetch, spinner hidden. A spinner left visible by a prior
    // batch must never carry over into a fresh feed, and the inline spinner is
    // driven by JS state here (not only by the template `hidden` attribute), so
    // its lifecycle is explicit on each render.
    state.feedLoading = false;
    const spinner = $("#feed-spinner");
    if (spinner) spinner.hidden = true;
    // BUG-260704-0735-005: a fresh render clears any prior batch-failure state.
    const loadErr = $("#feed-load-error");
    if (loadErr) loadErr.hidden = true;
    const list = $("#article-list");
    if (!list) {
      state.feedNextAfter = null;
      state.feedHasMore = false;
      return;
    }
    state.feedNextAfter = list.getAttribute("data-next-after") || null;
    state.feedHasMore = list.getAttribute("data-has-more") === "1";
    // BUG-260704-0735-004: the full render embeds _feed_rows.html, which now
    // carries a .feed-batch-meta sentinel. #article-list's own attributes are
    // authoritative here — drop the sentinel so the first scroll batch can't
    // read a stale one.
    list.querySelectorAll(".feed-batch-meta").forEach(m => m.remove());
    const end = $("#feed-end-marker");
    // End-of-feed marker shows only at the end of a NON-empty feed; an empty
    // feed shows the empty-state instead (no marker, no spinner).
    if (end) end.hidden = state.feedHasMore || !list.querySelector(".article");
  }

  async function loadMoreFeed() {
    if (state.feedLoading || !state.feedHasMore || !state.feedNextAfter) return;
    // BUG-260704-0735-004: bind this batch to the filter state active at
    // dispatch. If a full re-render (filter/sidebar change) bumps the token
    // while the fetch is in flight, the batch belongs to the OLD list and is
    // discarded instead of being appended to the new one.
    const token = seq.feed;
    state.feedLoading = true;
    const spinner = $("#feed-spinner");
    if (spinner) spinner.hidden = false;
    try {
      const params = buildFeedParams();
      params.set("after", state.feedNextAfter);
      params.set("rows_only", "true");
      const html = await api("/feed-partial?" + params.toString());
      if (token !== seq.feed) return;   // stale batch — discard
      const list = $("#article-list");
      if (list && html) {
        list.insertAdjacentHTML("beforeend", html);
      }
      // BUG-260704-0735-004: cursor + end-of-feed come from the explicit
      // .feed-batch-meta sentinel the server appends to every rows_only
      // response — no more regex counting.
      const metas = list ? list.querySelectorAll(".feed-batch-meta") : [];
      const meta = metas.length ? metas[metas.length - 1] : null;
      if (meta) {
        state.feedNextAfter = meta.getAttribute("data-next-after") || null;
        state.feedHasMore = meta.getAttribute("data-has-more") === "1";
      } else {
        state.feedHasMore = false;
      }
      if (metas.length) metas.forEach(m => m.remove());
      if (!state.feedHasMore) {
        const end = $("#feed-end-marker");
        if (end) end.hidden = false;
      }
      // Re-bind the article click handler on the newly-appended rows.
      bindArticleRows();
    } catch (e) {
      // BUG-260704-0735-005: a failed batch is distinguishable from
      // end-of-feed — show the inline retry affordance near the list bottom.
      if (token === seq.feed) {
        const err = $("#feed-load-error");
        if (err) err.hidden = false;
        const end = $("#feed-end-marker");
        if (end) end.hidden = true;
      }
    } finally {
      // Only release the loading state if this batch still owns the pane —
      // a newer render manages its own spinner/loading lifecycle.
      if (token === seq.feed) {
        state.feedLoading = false;
        if (spinner) spinner.hidden = true;
      }
    }
  }

  function bindFeedScroll() {
    const pane = $("#feed-pane");
    if (!pane) return;
    pane.addEventListener("scroll", () => {
      const dist = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
      if (dist < SCROLL_TRIGGER_PX) loadMoreFeed();
    });
  }

  // ----- sidebar -----

  function bindSidebar() {
    $$("#source-list .source-item").forEach(row => {
      row.addEventListener("click", onRowClick);
      const btn = row.querySelector(".row-action-btn");
      if (btn) {
        btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          openRowMenu(row, btn);
        });
      }
      row.addEventListener("mouseenter", () => {
        if (state.menuOpenFor === row) {
          state.overRow = true;
          cancelMenuClose();
        }
      });
      row.addEventListener("mouseleave", () => {
        if (state.menuOpenFor === row) {
          state.overRow = false;
          scheduleMenuClose();
        }
      });
    });
  }

  function scheduleMenuClose() {
    if (state.overRow || state.overMenu) return;
    clearTimeout(state.menuCloseTimer);
    state.menuCloseTimer = setTimeout(() => {
      if (!state.overRow && !state.overMenu) closeRowMenu();
    }, HOVER_GRACE_MS);
  }

  function cancelMenuClose() {
    clearTimeout(state.menuCloseTimer);
    state.menuCloseTimer = null;
  }

  function onRowClick(ev) {
    if (ev.target.closest(".row-action-btn")) return;
    if (ev.target.closest(".source-name-input")) return;
    const row = ev.currentTarget;
    if (row.classList.contains("muted")) return;
    const id = row.getAttribute("data-source-id");
    // CR-260525-0745-002: a sidebar click drives the right-pane content filter.
    // "All sources" clears the whole selection; a real source row selects that
    // source — plain click replaces the selection, shift-click toggles it
    // cumulatively.
    // BUG-260704-0735-005: fire-and-forget with an explicit catch — a failed
    // selection must surface, not vanish as an unhandled rejection.
    if (!id || row.classList.contains("all-sources")) {
      selectSidebarBranch({ kind: "all" }, false)
        .catch(() => showToast("Could not apply the selection.", "error"));
    } else {
      selectSidebarBranch({ kind: "source", id: id }, ev.shiftKey)
        .catch(() => showToast("Could not apply the selection.", "error"));
    }
  }

  function onFolderTitleClick(ev) {
    // CR-260525-0745-002: clicking a Group/Subgroup title selects that branch
    // in the content filter — plain click replaces the selection with the
    // branch's descendant sources; shift-click toggles the branch in/out
    // cumulatively. Supersedes the single-scope toggle (CR-260523-1501-001):
    // feed scoping now flows through the filter selection.
    if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
    const nameEl = ev.currentTarget;
    const row = nameEl.closest(".folder-row");
    if (!row) return;
    const id = nameEl.getAttribute("data-folder-id");
    selectSidebarBranch({ kind: "folder", id: id }, !!ev.shiftKey)
      .catch(() => showToast("Could not apply the selection.", "error"));
  }

  // CR-260525-0745-002: drive the content-filter selection from a sidebar
  // click. `target` is {kind:"all"} | {kind:"source",id} | {kind:"folder",id}.
  // `additive` (shift-click) toggles the branch in/out cumulatively; a plain
  // click replaces the selection with exactly the clicked branch. The sidebar
  // rows and the filter dropdown share one effective-source-set model, so both
  // mirror the same selection.
  async function selectSidebarBranch(target, additive) {
    await ensureFilterTreeLoaded();
    if (!state.filterTreeIndex) buildFilterTreeIndex();
    const idx = state.filterTreeIndex;

    // FT-260704-1620-001: any source/folder/all selection leaves the project
    // view — the feed returns to the news list.
    state.activeProjectId = null;

    // Feed scoping now flows through the filter selection — clear the legacy
    // single-scope vars so they never double-filter.
    state.activeSourceId = null;
    state.scopeFolderId = null;
    state.scopeFolderName = null;

    if (target.kind === "all") {
      state.filter.sourceIds = [];
      state.filter.folderIds = [];
      refreshFeed();
      paintSidebarSelection();
      return;
    }

    // The set of source ids the clicked branch represents.
    const branch = target.kind === "folder"
      ? (idx.descendantSourceIds[target.id] || []).slice()
      : [target.id];

    if (additive) {
      const sel = contentSelGetSelectedSources();
      const allOn = branch.length > 0 && branch.every(sid => sel.has(sid));
      if (allOn) branch.forEach(sid => sel.delete(sid));
      else branch.forEach(sid => sel.add(sid));
      contentSelSetSelection(sel);
    } else {
      contentSelSetSelection(new Set(branch));
    }
    refreshFeed();
    paintSidebarSelection();
  }

  // CR-260525-0745-002: mirror the effective filter selection onto the sidebar
  // rows. A source row is active when its source is in the effective set; a
  // folder row is active when every descendant source is selected; "All
  // sources" is active when nothing is selected. Re-applied after each sidebar
  // re-render so the visual state survives a rebuild.
  function paintSidebarSelection() {
    // FT-260704-1620-001: project rows first — independent of the filter tree.
    // While a project view is open it is the only active row.
    $$("#source-list .project-row").forEach(r => {
      r.classList.toggle(
        "active",
        !!state.activeProjectId
          && r.getAttribute("data-project-id") === state.activeProjectId
      );
    });
    if (state.activeProjectId) {
      $$("#source-list .source-item, #source-list .folder-row").forEach(
        r => r.classList.remove("active")
      );
      return;
    }
    if (!state.filterTreeIndex) return;
    const idx = state.filterTreeIndex;
    const sel = contentSelGetSelectedSources();
    const empty = sel.size === 0;
    $$("#source-list .source-item").forEach(r => {
      if (r.classList.contains("all-sources")) {
        r.classList.toggle("active", empty);
        return;
      }
      const sid = r.getAttribute("data-source-id");
      r.classList.toggle("active", !!sid && sel.has(sid));
    });
    $$("#source-list .folder-row").forEach(r => {
      const fid = r.getAttribute("data-folder-id");
      const desc = idx.descendantSourceIds[fid] || [];
      const allOn = desc.length > 0 && desc.every(s => sel.has(s));
      r.classList.toggle("active", allOn);
    });
  }

  // ----- add-source modal -----

  function openAddSourceModal() {
    const modal = $("#add-source-modal");
    modal.hidden = false;
    modalOpened("add-source-modal", false);  // CR-260704-0800-002 (own focus below)
    const input = $("#add-source-url");
    input.value = "";
    $("#add-source-error").hidden = true;
    setTimeout(() => input.focus(), 0);
  }

  function closeAddSourceModal() {
    $("#add-source-modal").hidden = true;
    toggleSubmitSpinner(false);
    modalClosed("add-source-modal");  // CR-260704-0800-002: focus restore
  }

  function toggleSubmitSpinner(on) {
    $("#add-source-submit").disabled = !!on;
    $("#add-source-submit .submit-label").hidden = !!on;
    $("#add-source-submit .submit-spinner").hidden = !on;
  }

  function showFormError(message) {
    const el = $("#add-source-error");
    el.textContent = message;
    el.hidden = false;
  }

  function bindAddSourceForm() {
    $("#add-source-btn").addEventListener("click", openAddSourceModal);
    $("#add-source-close").addEventListener("click", closeAddSourceModal);
    $("#add-source-cancel").addEventListener("click", closeAddSourceModal);
    $("#add-source-modal").addEventListener("click", (ev) => {
      if (ev.target.id === "add-source-modal") closeAddSourceModal();
    });
    $("#add-source-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const url = $("#add-source-url").value.trim();
      $("#add-source-error").hidden = true;

      if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(url)) {
        showFormError("Invalid URL — must start with http:// or https:// and include a host.");
        return;
      }

      toggleSubmitSpinner(true);
      try {
        const dup = await api("/sources/check-duplicate", {
          method: "POST",
          body: { url },
        });
        if (dup.is_duplicate) {
          showToast("Already added.", "error");
          toggleSubmitSpinner(false);
          return;
        }
        await api("/sources", { method: "POST", body: { url } });
        closeAddSourceModal();
        await refreshSidebar();
        showToast("Source added.");
      } catch (e) {
        const msg = (e.detail && e.detail.message) || e.message || "Add failed.";
        showToast(msg, "error");
        toggleSubmitSpinner(false);
      }
    });
  }

  // ----- row action menu -----

  function openRowMenu(row, anchor) {
    const menu = $("#row-menu");
    const muted = row.getAttribute("data-muted") === "1";
    menu.querySelector(".mute-label").textContent = muted ? "Unmute" : "Mute";
    const muteIcon = menu.querySelector(".mute-icon");
    if (muteIcon) {
      muteIcon.classList.toggle("ti-eye-off", !muted);
      muteIcon.classList.toggle("ti-eye", muted);
    }
    applyMenuContextItems(menu, row);
    // Reset any prior flip class so measurement reflects the default-down layout.
    menu.classList.remove("row-menu--flipped");
    menu.hidden = false;
    menu.style.visibility = "hidden";
    menu.style.top = "0px";
    menu.style.left = "0px";

    const rect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Default: open downward, anchored to the trigger's right edge.
    let top = rect.bottom - 2;
    let left = rect.left - 100;
    let flipped = false;

    // Vertical overflow → flip upward (anchor on trigger's bottom: 100%).
    if (top + menuRect.height > vh - 4 && rect.top - menuRect.height + 2 >= 4) {
      top = rect.top - menuRect.height + 2;
      flipped = true;
    } else if (top + menuRect.height > vh - 4) {
      // Neither direction fits — pin the menu within the viewport, let body scroll.
      top = Math.max(4, vh - menuRect.height - 4);
    }

    // Horizontal overflow.
    if (left + menuRect.width > vw - 4) left = Math.max(4, vw - menuRect.width - 4);
    if (left < 4) left = 4;

    menu.style.top = (window.scrollY + top) + "px";
    menu.style.left = (window.scrollX + left) + "px";
    menu.style.maxHeight = (vh - 8) + "px";
    if (flipped) menu.classList.add("row-menu--flipped");
    menu.style.visibility = "";
    state.menuOpenFor = row;
    state.overRow = true;
    state.overMenu = false;
    cancelMenuClose();

    menu.querySelectorAll(".row-menu-item").forEach(item => {
      item.onclick = async (ev) => {
        ev.stopPropagation();
        const action = item.getAttribute("data-action");
        if (item.classList.contains("is-disabled")) return;
        closeRowMenu();
        await handleRowAction(row, action);
      };
    });
    // FT — Source Ratings (US-260525-1200-006): rating-option clicks set the
    // value without closing the menu, so the user can adjust both dimensions.
    menu.querySelectorAll(".rating-opt").forEach(opt => {
      opt.onclick = async (ev) => {
        ev.stopPropagation();
        const dim = opt.getAttribute("data-rating");
        const val = opt.getAttribute("data-value");
        if (opt.classList.contains("is-active")) return;
        await setSourceRating(row, dim, val);
      };
    });
    // CR-260704-0800-002: menus are keyboard-reachable — move focus to the
    // first visible menu item so Tab traverses the items (disabled ones stay
    // focusable but inert via the is-disabled click guard, AC-260704-0800-004).
    const firstItem = Array.from(menu.querySelectorAll(".row-menu-item"))
      .find(el => !el.hidden);
    if (firstItem) firstItem.focus();
  }

  // PATCH the rating, update the row's badge + data-attr in place so the change
  // shows immediately (AC-260525-1200-060), then sync the sidebar in the
  // background. The open menu's active highlight is refreshed too.
  async function setSourceRating(row, dim, value) {
    const id = row.getAttribute("data-source-id");
    if (!id) return;
    try {
      const body = {};
      body[dim] = value;
      const res = await api("/sources/" + id + "/ratings", { method: "PATCH", body });
      row.setAttribute("data-reliability", res.reliability);
      row.setAttribute("data-impact", res.impact);
      updateRowRatingBadges(row, res.reliability, res.impact);
      const menu = $("#row-menu");
      if (menu && state.menuOpenFor === row) applyMenuRatingItems(menu, row, "source");
      showToast("Rating updated.");
      refreshSidebar();
    } catch (e) {
      const msg = (e.detail && e.detail.message) || "Could not update rating.";
      showToast(msg, "error");
    }
  }

  // Re-render the two rating pills on a source row to match the new levels.
  function updateRowRatingBadges(row, rel, imp) {
    const wrap = row.querySelector(".rating-badges");
    if (!wrap) return;
    const relBadge = wrap.querySelector(".rating-rel");
    const impBadge = wrap.querySelector(".rating-imp");
    if (relBadge) {
      relBadge.className = "rating-badge rating-rel rating-" + rel;
      relBadge.title = "Reliability: " + rel;
      relBadge.innerHTML = '<i class="ti ti-shield-half-filled"></i>' + rel.charAt(0).toUpperCase();
    }
    if (impBadge) {
      impBadge.className = "rating-badge rating-imp rating-" + imp;
      impBadge.title = "Impact: " + imp;
      impBadge.innerHTML = '<i class="ti ti-bolt"></i>' + imp.charAt(0).toUpperCase();
    }
  }

  // ----- promote/demote enablement (CR-260523-0900-001) -----

  function applyMenuContextItems(menu, row) {
    // Mark Promote / Demote items as enabled or disabled based on whether the
    // move is legal for this row. We never hide the items so the menu stays
    // structurally identical across row types — only the .is-disabled class
    // and tooltip change.
    const items = {
      promote: menu.querySelector('[data-action="promote"]'),
      demote: menu.querySelector('[data-action="demote"]'),
    };
    if (!items.promote || !items.demote) return;
    const kind = rowKind(row);
    const can = canPromoteDemote(row, kind);
    setMenuItemEnabled(items.promote, can.promote, can.promoteReason);
    setMenuItemEnabled(items.demote, can.demote, can.demoteReason);
    // BUG-260704-0735-007: article rows have no rename/mute/remove handlers —
    // hide those items (and their divider) instead of rendering enabled
    // actions that silently no-op. Source/folder contexts are unchanged.
    const isArticle = kind === "article";
    ["rename", "mute", "remove"].forEach(action => {
      const el = menu.querySelector('[data-action="' + action + '"]');
      if (el) el.hidden = isArticle;
    });
    const divider = menu.querySelector(".row-menu-divider:not(.source-only):not(.article-only)");
    if (divider) divider.hidden = isArticle;
    // BUG-260704-1629-001: the save-to-project entry (and its divider) is the
    // article-row way into the popover — hidden for source/folder rows.
    menu.querySelectorAll(".article-only").forEach(el => {
      el.hidden = !isArticle;
    });
    applyMenuRatingItems(menu, row, kind);
  }

  // FT — Source Ratings (US-260525-1200-006): show the reliability/impact
  // editors only for source rows, and mark the row's current values active.
  function applyMenuRatingItems(menu, row, kind) {
    const isSource = kind === "source";
    menu.querySelectorAll(".source-only").forEach(el => {
      el.hidden = !isSource;
    });
    if (!isSource) return;
    const current = {
      reliability: row.getAttribute("data-reliability") || "medium",
      impact: row.getAttribute("data-impact") || "medium",
    };
    menu.querySelectorAll(".rating-opt").forEach(btn => {
      const dim = btn.getAttribute("data-rating");
      const val = btn.getAttribute("data-value");
      btn.classList.toggle("is-active", current[dim] === val);
    });
  }

  function setMenuItemEnabled(el, enabled, reason) {
    el.classList.toggle("is-disabled", !enabled);
    if (!enabled && reason) el.setAttribute("title", reason);
    else el.removeAttribute("title");
  }

  function rowKind(row) {
    if (row.classList.contains("folder-row")) return "folder";
    if (row.classList.contains("article")) return "article";
    return "source";
  }

  function canPromoteDemote(row, kind) {
    if (kind === "folder") {
      const depth = parseInt(row.getAttribute("data-depth") || "1", 10);
      const parentId = row.getAttribute("data-parent-id") || "";
      const promote = depth > 1;
      const prevSibling = previousSiblingFolderRow(row);
      const demote = !!prevSibling && depth < MAX_DEPTH;
      return {
        promote,
        promoteReason: promote ? "" : "Already at root.",
        demote,
        demoteReason: demote ? "" : (prevSibling ? "Demote would exceed max depth." : "No preceding folder to nest under."),
      };
    }
    if (kind === "source") {
      const folderId = row.getAttribute("data-folder-id") || "";
      const promote = !!folderId;
      const prevSibling = previousSiblingSourceRow(row);
      const demote = !!prevSibling;
      return {
        promote,
        promoteReason: promote ? "" : "Already in Ungrouped.",
        demote,
        demoteReason: demote ? "" : "No preceding source to nest under.",
      };
    }
    // article
    const folderId = row.getAttribute("data-folder-id") || "";
    return {
      promote: !!folderId,
      promoteReason: folderId ? "" : "Article inherits Source folder.",
      demote: false,
      demoteReason: "Articles cannot demote in MVP.",
    };
  }

  function previousSiblingFolderRow(row) {
    let el = row.previousElementSibling;
    while (el) {
      if (el.classList && el.classList.contains("folder-row")) return el;
      el = el.previousElementSibling;
    }
    return null;
  }

  function previousSiblingSourceRow(row) {
    let el = row.previousElementSibling;
    while (el) {
      if (el.classList && el.classList.contains("source-item") &&
          !el.classList.contains("all-sources")) return el;
      el = el.previousElementSibling;
    }
    return null;
  }

  function closeRowMenu() {
    const menu = $("#row-menu");
    // CR-260704-0800-002: if focus lives inside the menu, hand it back to the
    // spawning row so keyboard users keep their place.
    const focusWasInMenu = menu && menu.contains(document.activeElement);
    const row = state.menuOpenFor;
    menu.hidden = true;
    state.menuOpenFor = null;
    state.overRow = false;
    state.overMenu = false;
    cancelMenuClose();
    if (focusWasInMenu && row && document.contains(row)) row.focus();
  }

  function bindRowMenuHover() {
    const menu = $("#row-menu");
    if (!menu) return;
    menu.addEventListener("mouseenter", () => {
      if (!state.menuOpenFor) return;
      state.overMenu = true;
      cancelMenuClose();
    });
    menu.addEventListener("mouseleave", () => {
      if (!state.menuOpenFor) return;
      state.overMenu = false;
      scheduleMenuClose();
    });
  }

  async function handleRowAction(row, action) {
    if (row.classList.contains("folder-row")) {
      const folderId = row.getAttribute("data-folder-id");
      if (action === "rename") {
        const nameEl = row.querySelector(".folder-name");
        if (nameEl) startFolderRename(nameEl);
        return;
      }
      if (action === "mute") return toggleFolderMute(row, folderId);
      if (action === "remove") return confirmFolderRemove(row, folderId);
      if (action === "promote") return promoteRow("folder", folderId, row);
      if (action === "demote") return demoteRow("folder", folderId, row);
      return;
    }
    if (row.classList.contains("article")) {
      const articleId = row.getAttribute("data-article-id");
      if (action === "promote") return promoteRow("article", articleId, row);
      if (action === "save-project") {
        // BUG-260704-1629-001: ⋮ menu entry opens the same save popover as the
        // bookmark button (checkbox toggle = add/remove assignment), anchored
        // to the bookmark per the handoff geometry.
        return toggleSaveMenu(row, row.querySelector(".bookmark-btn"));
      }
      // Articles have no rename/mute/remove in MVP; those items are HIDDEN for
      // article rows by applyMenuContextItems (BUG-260704-0735-007).
      return;
    }
    const id = row.getAttribute("data-source-id");
    if (action === "rename") return startRename(row);
    if (action === "mute") return toggleMute(row, id);
    if (action === "remove") return confirmRemove(row, id);
    if (action === "promote") return promoteRow("source", id, row);
    if (action === "demote") return demoteRow("source", id, row);
  }

  async function promoteRow(kind, id, row) {
    const endpoint = kind === "folder"
      ? "/folders/" + id + "/promote"
      : kind === "article"
        ? "/articles/" + id + "/promote"
        : "/sources/" + id + "/promote";
    try {
      await api(endpoint, { method: "PATCH" });
      await refreshSidebar();
      if (kind === "article") await refreshFeed();
      showToast("Promoted.");
    } catch (e) {
      const msg = (e.detail && e.detail.message) || "Promote failed.";
      showToast(msg, "error");
    }
  }

  async function demoteRow(kind, id, row) {
    let preceding = null;
    if (kind === "folder") {
      const prev = previousSiblingFolderRow(row);
      if (prev) preceding = prev.getAttribute("data-folder-id");
    } else if (kind === "source") {
      const prev = previousSiblingSourceRow(row);
      if (prev) preceding = prev.getAttribute("data-source-id");
    }
    const endpoint = kind === "folder"
      ? "/folders/" + id + "/demote"
      : "/sources/" + id + "/demote";
    try {
      await api(endpoint, {
        method: "PATCH",
        body: { preceding_id: preceding },
      });
      await refreshSidebar();
      showToast("Demoted.");
    } catch (e) {
      const msg = (e.detail && e.detail.message) || "Demote failed.";
      showToast(msg, "error");
    }
  }

  async function toggleFolderMute(row, id) {
    const muted = row.getAttribute("data-muted") === "1";
    try {
      await api("/folders/" + id, { method: "PATCH", body: { muted: !muted } });
      await refreshSidebar();
      await refreshFeed();
      showToast(muted ? "Unmuted." : "Muted.");
    } catch (e) {
      showToast("Mute toggle failed.", "error");
    }
  }

  // CR-260704-0800-003: single confirm-dialog implementation — formerly
  // duplicated across confirmRemove / confirmFolderRemove.
  function confirmAction(message, onConfirm) {
    const modal = $("#confirm-modal");
    $("#confirm-message").textContent = message;
    modal.hidden = false;
    modalOpened("confirm-modal");  // CR-260704-0800-002
    const cleanup = () => {
      modal.hidden = true;
      $("#confirm-cancel").onclick = null;
      $("#confirm-ok").onclick = null;
      modalClosed("confirm-modal");
    };
    $("#confirm-cancel").onclick = cleanup;
    $("#confirm-ok").onclick = async () => {
      cleanup();
      await onConfirm();
    };
  }

  function confirmFolderRemove(row, id) {
    const name = row.getAttribute("data-folder-name") || "folder";
    confirmAction(
      "Remove folder " + name + "? Its sub-folders will be deleted and its sources will move to Ungrouped.",
      async () => {
        try {
          await api("/folders/" + id, { method: "DELETE" });
          await refreshSidebar();
          await refreshFeed();
          showToast("Removed.");
        } catch (e) {
          showToast("Remove failed.", "error");
        }
      }
    );
  }

  // ----- rename inline -----

  // CR-260704-0800-003: single inline-rename implementation — formerly
  // duplicated as startRename (source) / startFolderRename (folder).
  // opts: {inputClass, requireValue, makeSpan(label) -> span, submit(label)}.
  function startInlineRename(nameEl, opts) {
    const original = nameEl.textContent.trim();
    const input = document.createElement("input");
    input.type = "text";
    input.className = opts.inputClass;
    input.value = original;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const restore = (label) => {
      input.replaceWith(opts.makeSpan(label));
    };

    const save = async () => {
      if (done) return;
      const newLabel = input.value.trim();
      if (!newLabel) {
        if (opts.requireValue) {
          input.classList.add("error");
          input.focus();
          return;
        }
        done = true;
        restore(original);
        return;
      }
      if (newLabel === original) { done = true; restore(original); return; }
      done = true;
      try {
        await opts.submit(newLabel);
        await refreshSidebar();
        showToast("Renamed.");
      } catch (e) {
        restore(original);
        const msg = (e.detail && e.detail.message) || "Rename failed.";
        showToast(msg, "error");
      }
    };

    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); save(); }
      else if (ev.key === "Escape") { ev.preventDefault(); done = true; restore(original); }
    });
    input.addEventListener("blur", () => save());
  }

  function startRename(row) {
    const nameEl = row.querySelector(".source-name");
    if (!nameEl) return;
    const id = row.getAttribute("data-source-id");
    startInlineRename(nameEl, {
      inputClass: "source-name-input",
      requireValue: false,
      makeSpan: (label) => {
        const span = document.createElement("span");
        span.className = "source-name";
        span.textContent = label;
        return span;
      },
      submit: (label) => api("/sources/" + id, {
        method: "PATCH",
        body: { display_name: label },
      }),
    });
  }

  // ----- mute -----

  async function toggleMute(row, id) {
    const muted = row.getAttribute("data-muted") === "1";
    try {
      await api("/sources/" + id + "/mute", {
        method: "PATCH",
        body: { muted: !muted },
      });
      if (state.activeSourceId === id && !muted) {
        state.activeSourceId = null;
      }
      await refreshSidebar();
      await refreshFeed();
      showToast(muted ? "Unmuted." : "Muted.");
    } catch (e) {
      showToast("Mute toggle failed.", "error");
    }
  }

  // ----- remove confirm -----

  function confirmRemove(row, id) {
    const name = row.getAttribute("data-display-name") || "source";
    confirmAction(
      "Remove " + name + "? This will delete the source and all its articles.",
      async () => {
        try {
          await api("/sources/" + id, { method: "DELETE" });
          if (state.activeSourceId === id) {
            state.activeSourceId = null;
          }
          await refreshSidebar();
          await refreshFeed();
          showToast("Removed.");
        } catch (e) {
          showToast("Remove failed.", "error");
        }
      }
    );
  }

  // ----- feed pane -----

  function bindFeed() {
    bindArticleRows();
    const refresh = $("#refresh-btn");
    if (refresh) {
      refresh.addEventListener("click", onManualRefresh);
    }
    // Project view (FT-260704-1620-001): "‹ Back to news" returns to the All
    // sources feed (AC-260704-1620-014).
    const back = $("#back-to-news");
    if (back) {
      back.addEventListener("click", () => {
        selectSidebarBranch({ kind: "all" }, false)
          .catch(() => showToast("Could not go back to the news feed.", "error"));
      });
    }
    // BUG-260704-0735-005: retry a failed scroll batch.
    const retry = $("#feed-retry-btn");
    if (retry) {
      retry.addEventListener("click", () => {
        const err = $("#feed-load-error");
        if (err) err.hidden = true;
        loadMoreFeed();
      });
    }
  }

  function bindArticleRows() {
    // Only attach to rows that have not yet been bound. Idempotent so a
    // scroll-append re-binding does not stack duplicate handlers.
    $$("#feed-pane .article").forEach(art => {
      if (art.__almBound) return;
      art.__almBound = true;
      art.addEventListener("click", onArticleClick);
      // Article ⋮ menu (CR-260523-0900-001).
      const btn = art.querySelector(".article-menu-btn");
      if (btn) {
        btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          openRowMenu(art, btn);
        });
      }
      // Article drag (CR-260523-0900-001 AC-260523-0900-022).
      art.addEventListener("dragstart", onArticleDragStart);
      art.addEventListener("dragend", onDragEnd);
    });
  }

  function onArticleDragStart(ev) {
    const row = ev.currentTarget;
    drag = {
      kind: "article",
      id: row.getAttribute("data-article-id"),
      originRow: row,
      currentFolderId: row.getAttribute("data-folder-id") || null,
    };
    row.classList.add("is-dragging");
    ev.dataTransfer.effectAllowed = "move";
    try { ev.dataTransfer.setData("text/plain", drag.id || ""); } catch (e) {}
    snapshotRowRects();
    lastAboveByTarget = new WeakMap();
  }

  async function onArticleClick(ev) {
    if (ev.target.closest(".row-action-btn")) return;
    const article = ev.currentTarget;
    // FT-260704-1620-001 (handoff screen 5): a folder tag opens its project
    // view; the bookmark button (or the row ⋮ menu's "Save to project" entry)
    // opens the save-to-project popover. The title is NOT a trigger
    // (BUG-260704-1629-001) — clicks anywhere else on the card open the article.
    const tag = ev.target.closest(".article-saved-tag");
    if (tag) {
      selectProject(tag.getAttribute("data-project-id"));
      return;
    }
    if (ev.target.closest(".bookmark-btn")) {
      toggleSaveMenu(article, article.querySelector(".bookmark-btn"));
      return;
    }
    const id = article.getAttribute("data-article-id");
    const url = article.getAttribute("data-url");
    if (!url) return;
    window.open(url, "_blank", "noopener");
    article.classList.add("read");
    try {
      await api("/articles/" + id + "/read", { method: "POST" });
      refreshSidebar();
    } catch (e) { /* network blip — silent */ }
  }

  async function onManualRefresh() {
    const btn = $("#refresh-btn");
    if (btn && btn.disabled) return;
    setRefreshButtonState("loading");
    try {
      const result = await api("/refresh", { method: "POST" });
      // BUG-260704-0735-005: pane refreshers no longer throw — they toast their
      // own failure and return false. Only report overall success when both
      // panes actually updated.
      const sidebarOk = await refreshSidebar();
      const feedOk = await refreshFeed();
      if (result && typeof result.last_sync === "string") {
        const el = $("#last-sync-label");
        if (el) el.textContent = "Last sync · " + result.last_sync;
      } else {
        updateLastSyncLabel();
      }
      if (sidebarOk && feedOk) {
        setRefreshButtonState("done");
        // BUG-260704-0735-001: /refresh no longer queues concurrent cycles — a
        // cycle already in flight reports "already_running".
        showToast(result && result.status === "already_running"
          ? "Refresh already in progress."
          : "Refresh complete.");
      } else {
        setRefreshButtonState("error");
      }
    } catch (e) {
      setRefreshButtonState("error");
      showToast("Refresh failed.", "error");
    }
  }

  function setRefreshButtonState(state) {
    const btn = $("#refresh-btn");
    if (!btn) return;
    const icon = btn.querySelector("i");
    btn.classList.remove("is-loading", "is-done", "is-error");
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
    if (icon) {
      icon.classList.remove("ti-check", "ti-x");
      icon.classList.add("ti-refresh");
    }
    if (state === "loading") {
      btn.classList.add("is-loading");
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
    } else if (state === "done") {
      btn.classList.add("is-done");
      if (icon) { icon.classList.remove("ti-refresh"); icon.classList.add("ti-check"); }
      setTimeout(() => setRefreshButtonState("idle"), REFRESH_CONFIRM_MS);
    } else if (state === "error") {
      btn.classList.add("is-error");
      if (icon) { icon.classList.remove("ti-refresh"); icon.classList.add("ti-x"); }
      setTimeout(() => setRefreshButtonState("idle"), REFRESH_CONFIRM_MS);
    }
  }

  // ----- Media Content Projects (FT-260704-1620-001) -----

  // Sidebar PROJECTS section + save-to-project popover, per the handoff
  // bundle (screens 3/5/7). Server-side persistence via /projects.

  function bindProjects() {
    const addBtn = $("#new-project-btn");
    if (addBtn) addBtn.addEventListener("click", onNewProject);
    $$("#source-list .project-row").forEach(row => {
      row.addEventListener("click", (ev) => {
        if (ev.target.closest("input")) return;
        if (ev.target.closest(".project-rename-btn")) {
          ev.stopPropagation();
          startProjectRename(row);
          return;
        }
        if (ev.target.closest(".project-delete-btn")) {
          ev.stopPropagation();
          confirmDeleteProject(row);
          return;
        }
        selectProject(row.getAttribute("data-project-id"));
      });
      // Delegated at row level so it survives the span swap an empty-commit
      // revert performs (startInlineRename.restore).
      row.addEventListener("dblclick", (ev) => {
        if (!ev.target.closest(".project-name")) return;
        ev.stopPropagation();
        startProjectRename(row);
      });
    });
  }

  function selectProject(id) {
    if (!id) return;
    closeSaveMenu();
    state.activeProjectId = id;
    refreshFeed();
    paintSidebarSelection();
  }

  // "+" creates the project, then immediately enters inline rename on the
  // fresh row with the placeholder name selected (AC-260704-1620-005).
  async function onNewProject() {
    try {
      const created = await api("/projects", { method: "POST", body: {} });
      await refreshSidebar();
      const row = $('#source-list .project-row[data-project-id="' + created.id + '"]');
      if (row) {
        row.scrollIntoView({ block: "nearest" });
        startProjectRename(row);
      }
    } catch (e) {
      showToast("Could not create the project.", "error");
    }
  }

  // Inline rename via the shared implementation: Enter/blur commits, Escape
  // cancels, an empty commit reverts to the previous name (AC-260704-1620-008).
  function startProjectRename(row) {
    const nameEl = row.querySelector(".project-name");
    if (!nameEl) return;
    const id = row.getAttribute("data-project-id");
    startInlineRename(nameEl, {
      inputClass: "source-name-input",
      requireValue: false,
      makeSpan: (label) => {
        const span = document.createElement("span");
        span.className = "project-name";
        span.textContent = label;
        return span;
      },
      submit: (label) => api("/projects/" + id, {
        method: "PATCH",
        body: { name: label },
      }),
    });
  }

  // Delete with saved articles asks for confirmation naming the project and
  // count (AC-260704-1620-007); an empty project deletes directly.
  function confirmDeleteProject(row) {
    const id = row.getAttribute("data-project-id");
    const name = row.getAttribute("data-project-name") || "project";
    const count = parseInt(row.getAttribute("data-count") || "0", 10) || 0;
    const doDelete = async () => {
      try {
        await api("/projects/" + id, { method: "DELETE" });
        if (state.activeProjectId === id) state.activeProjectId = null;
        await refreshSidebar();
        await refreshFeed();
        showToast("Project deleted.");
      } catch (e) {
        showToast("Delete failed.", "error");
      }
    };
    if (count > 0) {
      confirmAction(
        'Delete "' + name + '"? ' + count + " saved article"
          + (count === 1 ? "" : "s") + " will be removed from it.",
        doDelete
      );
    } else {
      doDelete();
    }
  }

  // -- save-to-project popover (handoff screen 5) --

  function articleProjectIds(articleRow) {
    const raw = articleRow.getAttribute("data-project-ids") || "";
    return new Set(raw.split(",").filter(Boolean));
  }

  function toggleSaveMenu(articleRow, anchor) {
    if (state.saveMenuFor === articleRow) {
      closeSaveMenu();
      return;
    }
    openSaveMenu(articleRow, anchor);
  }

  async function openSaveMenu(articleRow, anchor) {
    closeSaveMenu();
    try {
      const data = await api("/projects");
      state.projects = data.projects || [];
    } catch (e) {
      showToast("Could not load projects.", "error");
      return;
    }
    state.saveMenuFor = articleRow;
    state.saveMenuAnchor = anchor || null;
    if (anchor) anchor.classList.add("active");
    const menu = $("#save-menu");
    const input = $("#save-menu-input");
    if (input) input.value = "";
    updateSaveMenuCreateEnabled();
    renderSaveMenuList();
    positionSaveMenu(menu, anchor || articleRow);
    menu.hidden = false;
  }

  function closeSaveMenu() {
    const menu = $("#save-menu");
    if (menu) menu.hidden = true;
    if (state.saveMenuAnchor) state.saveMenuAnchor.classList.remove("active");
    state.saveMenuFor = null;
    state.saveMenuAnchor = null;
  }

  // Right-align the 232px popover under its anchor (handoff: top 32px,
  // right 0 relative to the bookmark), clamped to the viewport; opens above
  // when there is no room below.
  function positionSaveMenu(menu, anchor) {
    const rect = anchor.getBoundingClientRect();
    menu.style.visibility = "hidden";
    menu.hidden = false;
    const pr = menu.getBoundingClientRect();
    let left = rect.right - pr.width;
    let top = rect.bottom + 4;
    if (left < 8) left = 8;
    if (left + pr.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - pr.width - 8);
    }
    if (top + pr.height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - pr.height - 4);
    }
    menu.style.top = top + "px";
    menu.style.left = left + "px";
    menu.hidden = true;
    menu.style.visibility = "";
  }

  function renderSaveMenuList() {
    const list = $("#save-menu-list");
    if (!list || !state.saveMenuFor) return;
    const inIds = articleProjectIds(state.saveMenuFor);
    if (!state.projects.length) {
      list.innerHTML = '<div class="save-menu-empty">No projects yet — create one below.</div>';
      return;
    }
    list.innerHTML = state.projects.map(p => {
      const on = inIds.has(p.id);
      return '<button type="button" class="save-menu-item' + (on ? " on" : "") + '"'
        + ' role="menuitemcheckbox" aria-checked="' + on + '"'
        + ' data-project-id="' + escapeHtml(p.id) + '">'
        + '<span class="save-menu-check" aria-hidden="true">'
        + (on ? '<i class="ti ti-check"></i>' : "")
        + "</span>"
        + '<span class="save-menu-name">' + escapeHtml(p.name) + "</span>"
        + '<span class="save-menu-count">' + p.count + "</span>"
        + "</button>";
    }).join("");
    $$(".save-menu-item", list).forEach(item => {
      item.addEventListener("click", (ev) => {
        ev.stopPropagation();
        toggleArticleInProject(item.getAttribute("data-project-id"));
      });
    });
  }

  // Checkbox toggle = save/unsave, effective immediately (AC-260704-1620-009):
  // bookmark fill, folder tags, popover row, and sidebar count pill all update
  // in place; unsaving from inside the open project view removes the row via a
  // re-render (AC-260704-1620-016).
  async function toggleArticleInProject(projectId) {
    const articleRow = state.saveMenuFor;
    if (!articleRow || !projectId) return;
    const articleId = articleRow.getAttribute("data-article-id");
    const saved = articleProjectIds(articleRow).has(projectId);
    try {
      const resp = await api(
        "/projects/" + projectId + "/articles/" + articleId,
        { method: saved ? "DELETE" : "PUT" }
      );
      const ids = articleProjectIds(articleRow);
      if (saved) ids.delete(projectId); else ids.add(projectId);
      articleRow.setAttribute("data-project-ids", Array.from(ids).join(","));
      const cached = state.projects.find(p => p.id === projectId);
      if (cached) cached.count = resp.count;
      updateSidebarProjectCount(projectId, resp.count);
      if (saved && state.activeProjectId === projectId) {
        // Unsaved from inside this project's view — the row leaves the list
        // and the subtitle/pill counts shrink (AC-260704-1620-016).
        closeSaveMenu();
        refreshFeed();
        return;
      }
      updateArticleProjectUI(articleRow);
      renderSaveMenuList();
    } catch (e) {
      showToast(saved ? "Could not remove from the project." : "Could not save to the project.", "error");
    }
  }

  // Popover footer: Enter or Create makes a new project containing this
  // article; the input clears and refocuses (AC-260704-1620-010/-012).
  async function onSaveMenuCreate() {
    const input = $("#save-menu-input");
    const articleRow = state.saveMenuFor;
    if (!input || !articleRow) return;
    const name = input.value.trim();
    if (!name) return;
    const articleId = articleRow.getAttribute("data-article-id");
    try {
      const created = await api("/projects", {
        method: "POST",
        body: { name: name, article_id: articleId },
      });
      state.projects.push(created);
      const ids = articleProjectIds(articleRow);
      ids.add(created.id);
      articleRow.setAttribute("data-project-ids", Array.from(ids).join(","));
      updateArticleProjectUI(articleRow);
      renderSaveMenuList();
      input.value = "";
      updateSaveMenuCreateEnabled();
      input.focus();
      refreshSidebar();
    } catch (e) {
      const msg = (e.detail && e.detail.message) || "Could not create the project.";
      showToast(msg, "error");
    }
  }

  function updateSaveMenuCreateEnabled() {
    const input = $("#save-menu-input");
    const btn = $("#save-menu-create");
    if (!input || !btn) return;
    const enabled = !!input.value.trim();
    btn.disabled = !enabled;
    btn.classList.toggle("disabled", !enabled);
  }

  // Rebuild an article row's bookmark fill + folder tags from its membership
  // set (data-project-ids) and the cached project names.
  function updateArticleProjectUI(articleRow) {
    const ids = articleProjectIds(articleRow);
    const names = {};
    state.projects.forEach(p => { names[p.id] = p.name; });
    const bm = articleRow.querySelector(".bookmark-btn");
    if (bm) {
      bm.classList.toggle("saved", ids.size > 0);
      bm.title = ids.size
        ? "Saved to " + ids.size + " project" + (ids.size === 1 ? "" : "s")
        : "Save to project";
      const icon = bm.querySelector("i");
      if (icon) icon.className = "ti " + (ids.size ? "ti-bookmark-filled" : "ti-bookmark");
    }
    const tags = articleRow.querySelector(".article-saved-tags");
    if (tags) {
      tags.innerHTML = Array.from(ids).map(pid =>
        '<button type="button" class="article-saved-tag" data-project-id="' + escapeHtml(pid) + '"'
          + ' title="Open ' + escapeHtml(names[pid] || "project") + '">'
          + '<i class="ti ti-folder"></i><span>' + escapeHtml(names[pid] || "project") + "</span>"
          + "</button>"
      ).join("");
      tags.hidden = ids.size === 0;
    }
  }

  function updateSidebarProjectCount(projectId, count) {
    const row = $('#source-list .project-row[data-project-id="' + projectId + '"]');
    if (!row) return;
    row.setAttribute("data-count", String(count));
    const pill = row.querySelector(".project-count");
    if (pill) pill.textContent = String(count);
  }

  // Static popover bindings (the element persists across partial re-renders).
  function bindSaveMenu() {
    const menu = $("#save-menu");
    const input = $("#save-menu-input");
    const create = $("#save-menu-create");
    if (!menu || menu.__almBound) return;
    menu.__almBound = true;
    if (input) {
      input.addEventListener("input", updateSaveMenuCreateEnabled);
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          onSaveMenuCreate();
        }
      });
    }
    if (create) create.addEventListener("click", onSaveMenuCreate);
    // Handoff dismissal contract: outside mousedown closes without changing
    // any saves (AC-260704-1620-011). Re-clicking the trigger is left to the
    // click handler so it toggles instead of reopening.
    document.addEventListener("mousedown", (ev) => {
      if (!state.saveMenuFor) return;
      if (ev.target.closest("#save-menu")) return;
      if (ev.target.closest(".bookmark-btn")) return;
      closeSaveMenu();
    });
  }

  // ----- FT05 grouping (CR-260522-2101-001) -----

  function bindFolders() {
    // Chevron click → toggle collapse on a folder at any depth.
    $$("#source-list .chevron").forEach(btn => {
      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const id = btn.getAttribute("data-folder-id");
        const row = btn.closest(".folder-row");
        const newCollapsed = !row.classList.contains("collapsed");
        try {
          await api("/folders/" + id, { method: "PATCH", body: { collapsed: newCollapsed } });
          await refreshSidebar();
        } catch (e) {
          showToast("Could not toggle.", "error");
        }
      });
    });
    // Single-click on a folder name → scope feed (CR-260523-1501-001).
    // Double-click → inline rename. A short delay defers the single-click
    // action so a second click within 280ms registers as a dblclick and
    // cancels the scope toggle.
    $$("#source-list .folder-name").forEach(nameEl => {
      let clickTimer = null;
      nameEl.addEventListener("click", (ev) => {
        if (ev.target.closest(".folder-name-input")) return;
        if (clickTimer) return;  // dblclick about to fire — let it through
        // CR-260525-0745-002: capture Shift before the disambiguation timer
        // fires, so shift-click multi-select reaches onFolderTitleClick.
        const shiftKey = ev.shiftKey;
        clickTimer = setTimeout(() => {
          clickTimer = null;
          onFolderTitleClick({ currentTarget: nameEl, stopPropagation: () => {}, shiftKey: shiftKey });
        }, 240);
      });
      nameEl.addEventListener("dblclick", (ev) => {
        ev.stopPropagation();
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
        startFolderRename(nameEl);
      });
    });
    // Hover-`+` on a folder row → create-subfolder inline input. Only
    // present on folders with depth < 5 (template-controlled).
    $$("#source-list .folder-add-btn").forEach(btn => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const parentId = btn.getAttribute("data-parent-id");
        openCreateSubfolderInput(parentId);
      });
    });
    // ⋮ menu on folder rows — reuses the FT04 _row_menu.html popover.
    $$("#source-list .folder-menu-btn").forEach(btn => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const row = btn.closest(".folder-row");
        openRowMenu(row, btn);
      });
    });
    // Folder rows track hover for menu close-grace, same as source rows.
    $$("#source-list .folder-row").forEach(row => {
      row.addEventListener("mouseenter", () => {
        if (state.menuOpenFor === row) {
          state.overRow = true;
          cancelMenuClose();
        }
      });
      row.addEventListener("mouseleave", () => {
        if (state.menuOpenFor === row) {
          state.overRow = false;
          scheduleMenuClose();
        }
      });
    });
  }

  // -- create-group --

  function bindNewGroupBtn() {
    const btn = $("#new-group-btn");
    if (!btn) return;
    btn.addEventListener("click", openCreateGroupInput);
  }

  function openCreateGroupInput() {
    // Inject an inline input right at the top of #source-list (above All sources).
    const list = $("#source-list");
    if (list.querySelector(".folder-inline-input.create-group")) return;
    const wrap = document.createElement("div");
    wrap.className = "folder-inline-input create-group";
    wrap.innerHTML = '<input class="folder-name-input" type="text" placeholder="Folder name" />';
    list.insertBefore(wrap, list.firstChild);
    const input = wrap.querySelector("input");
    input.focus();
    wireFolderInput(input, wrap, {
      submit: async (name) => {
        const created = await api("/folders", { method: "POST", body: { name } });
        await refreshSidebar();
        await refreshFeed();  // banner may have auto-dismissed
        showToast("Folder created.");
        return created;
      },
      errorLabel: "Folder",
    });
  }

  // -- create-subfolder (any depth ≤ 5) --

  function openCreateSubfolderInput(parentId) {
    const parentRow = $('#source-list .folder-row[data-folder-id="' + parentId + '"]');
    if (!parentRow) return;
    const parentDepth = parseInt(parentRow.getAttribute("data-depth") || "1", 10);
    if (parentDepth >= 5) {
      showToast("Maximum folder nesting depth is 5.", "error");
      return;
    }
    // Find or create the children container right after the parent row.
    let children = document.querySelector(
      '#source-list .folder-children[data-parent-folder-id="' + parentId + '"]'
    );
    if (!children) {
      // Parent is collapsed — render a new container so the input is visible.
      children = document.createElement("div");
      children.className = "folder-children";
      children.setAttribute("data-parent-folder-id", parentId);
      children.setAttribute("data-parent-depth", String(parentDepth));
      parentRow.parentNode.insertBefore(children, parentRow.nextSibling);
    }
    if (children.querySelector(".folder-inline-input.create-subfolder")) return;
    const wrap = document.createElement("div");
    wrap.className = "folder-inline-input create-subfolder";
    wrap.style.setProperty("--depth", String(parentDepth + 1));
    wrap.style.paddingLeft = "calc(8px + (" + (parentDepth + 1 - 1) + ") * var(--folder-indent))";
    wrap.innerHTML = '<input class="folder-name-input" type="text" placeholder="Sub-folder name" />';
    children.insertBefore(wrap, children.firstChild);
    const input = wrap.querySelector("input");
    input.focus();
    wireFolderInput(input, wrap, {
      submit: async (name) => {
        const created = await api("/folders", {
          method: "POST",
          body: { parent_id: parentId, name },
        });
        await refreshSidebar();
        showToast("Folder created.");
        return created;
      },
      errorLabel: "Folder",
    });
  }

  function wireFolderInput(input, wrap, opts) {
    let submitted = false;
    const close = () => { if (wrap.isConnected) wrap.remove(); };
    const showErr = (msg) => {
      input.classList.add("error");
      let err = wrap.querySelector(".folder-name-error");
      if (!err) {
        err = document.createElement("div");
        err.className = "folder-name-error";
        wrap.appendChild(err);
      }
      err.textContent = msg;
    };
    const trySubmit = async () => {
      if (submitted) return;
      const name = input.value.trim();
      if (!name) {
        showErr(opts.errorLabel + " name must be 1-60 characters");
        input.focus();
        return;
      }
      submitted = true;
      input.disabled = true;
      try {
        await opts.submit(name);
        close();
      } catch (e) {
        submitted = false;
        input.disabled = false;
        const msg = (e.detail && e.detail.message)
          || opts.errorLabel + " name must be 1-60 characters";
        showErr(msg);
        input.focus();
      }
    };
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); trySubmit(); }
      else if (ev.key === "Escape") { ev.preventDefault(); close(); }
    });
    input.addEventListener("blur", () => {
      // Esc-or-empty cancels; non-empty value triggers a submit on blur.
      if (!input.value.trim() && !submitted) close();
      else if (!submitted) trySubmit();
    });
  }

  // -- inline rename (group / subgroup) --

  function startFolderRename(nameEl) {
    const id = nameEl.getAttribute("data-folder-id");
    startInlineRename(nameEl, {
      inputClass: "folder-name-input",
      requireValue: true,
      makeSpan: (label) => {
        const span = document.createElement("span");
        span.className = "folder-name";
        span.setAttribute("data-folder-id", id);
        span.textContent = label;
        span.addEventListener("dblclick", (ev) => {
          ev.stopPropagation();
          startFolderRename(span);
        });
        return span;
      },
      submit: (label) => api("/folders/" + id, {
        method: "PATCH",
        body: { name: label },
      }),
    });
  }

  // -- drag and drop (US-260522-2116-008 — Notion-style outliner UX) --
  //
  // Drop intent is computed from two axes of the cursor relative to the row
  // under it:
  //   * Y-axis: top half of row → "above" (sibling above the target).
  //             bottom half      → "below" (sibling below the target).
  //   * X-axis: cursor X minus the target row's content-start X picks the
  //             nesting depth.
  //       INDENT_THRESHOLD px to the right → "child" (drop as child of target).
  //       OUTDENT_THRESHOLD px to the left  → "outdent" (drop as sibling of
  //                                            target's parent — promote).
  // Per type constraints:
  //   * group rows: only top-level sibling reorder.
  //   * subgroup rows: sibling reorder within parent group, or move to
  //                    another group via drop-as-child on a Group row.
  //   * source rows: anywhere.

  const DROP_INDENT_PX = 24;
  const DROP_OUTDENT_PX = -8;
  // BUG-260523-0900-002: hysteresis band around row midpoints prevents
  // above/below flicker when the cursor lingers near a boundary. The
  // indicator only flips when the cursor crosses the midpoint by more
  // than this band.
  const DROP_HYSTERESIS_PX = 6;

  let drag = null;  // { kind, id, originRow, currentGroupId, currentSubgroupId }
  let dropPlan = null;
  // Cached rects keyed by row element — captured at dragstart so dragover
  // events don't trigger expensive layout reads on every mouse move
  // (BUG-260523-0900-002 root cause #2).
  let dragRectCache = null;
  // Last computed "above" verdict per target, to apply hysteresis on the
  // next dragover against the same target.
  let lastAboveByTarget = null;

  function bindDragDrop() {
    $$('#source-list [draggable="true"]').forEach(row => {
      row.addEventListener("dragstart", onDragStart);
      row.addEventListener("dragend", onDragEnd);
    });
    // Listen on the source-list root for movement / drop events so we can
    // resolve the cursor against the row beneath it in one place.
    const list = $("#source-list");
    if (!list) return;
    if (list.__almDndBound) return;
    list.__almDndBound = true;
    list.addEventListener("dragover", onListDragOver);
    list.addEventListener("drop", onListDrop);
    list.addEventListener("dragleave", onListDragLeave);
  }

  function onDragStart(ev) {
    const row = ev.currentTarget;
    if (row.classList.contains("folder-row")) {
      drag = {
        kind: "folder",
        id: row.getAttribute("data-folder-id"),
        originRow: row,
        currentParentId: row.getAttribute("data-parent-id") || null,
        depth: parseInt(row.getAttribute("data-depth") || "1", 10),
        subtreeMaxDepth: computeSubtreeMaxDepth(row),
      };
    } else {
      drag = {
        kind: "source",
        id: row.getAttribute("data-source-id"),
        originRow: row,
        currentFolderId: row.getAttribute("data-folder-id") || null,
      };
    }
    row.classList.add("is-dragging");
    ev.dataTransfer.effectAllowed = "move";
    try { ev.dataTransfer.setData("text/plain", drag.id || ""); } catch (e) {}
    snapshotRowRects();
    lastAboveByTarget = new WeakMap();
  }

  function snapshotRowRects() {
    // BUG-260523-0900-002: cache row rects so dragover doesn't recompute
    // layout each event. Refreshed on scroll/resize via attached listeners.
    dragRectCache = new WeakMap();
    $$("#source-list .folder-row, #source-list .source-item, #source-list .ungrouped-zone")
      .forEach(el => dragRectCache.set(el, el.getBoundingClientRect()));
  }

  function cachedRect(el) {
    if (!dragRectCache) return el.getBoundingClientRect();
    let r = dragRectCache.get(el);
    if (!r) {
      r = el.getBoundingClientRect();
      dragRectCache.set(el, r);
    }
    return r;
  }

  function computeSubtreeMaxDepth(folderRow) {
    // Walk the DOM under the folder row's sibling .folder-children
    // container to find the maximum descendant depth. Returns the
    // delta from this folder's depth (0 if no descendant folders).
    const id = folderRow.getAttribute("data-folder-id");
    const children = document.querySelector(
      '#source-list .folder-children[data-parent-folder-id="' + id + '"]'
    );
    if (!children) return 0;
    let max = 0;
    children.querySelectorAll('.folder-row').forEach(r => {
      const d = parseInt(r.getAttribute("data-depth") || "0", 10);
      const root = parseInt(folderRow.getAttribute("data-depth") || "0", 10);
      const delta = d - root;
      if (delta > max) max = delta;
    });
    return max;
  }

  function onDragEnd(ev) {
    if (drag && drag.originRow) drag.originRow.classList.remove("is-dragging");
    clearDropIndicator();
    drag = null;
    dropPlan = null;
    dragRectCache = null;
    lastAboveByTarget = null;
  }

  function rowContentX(row) {
    // Use the row's .folder-name (or .source-name) left edge as the
    // content-start. This is the indent baseline against which X-offset is
    // measured. Uses cached row rect so dragover doesn't trigger reflow on
    // every event (BUG-260523-0900-002).
    const inner = row.querySelector(".folder-name, .source-name");
    if (!inner) return cachedRect(row).left + 16;
    // Inner rects also cached — fallback to live read on cache miss.
    if (dragRectCache) {
      let r = dragRectCache.get(inner);
      if (!r) {
        r = inner.getBoundingClientRect();
        dragRectCache.set(inner, r);
      }
      return r.left;
    }
    return inner.getBoundingClientRect().left;
  }

  const MAX_DEPTH = 5;

  function computeDropPlan(target, x, y) {
    // target is a .folder-row, .source-item, or .ungrouped-zone.
    if (!target || !drag) return null;

    if (target.classList.contains("ungrouped-zone")) {
      if (drag.kind !== "source" && drag.kind !== "article") return null;
      return { kind: "into-ungrouped", target };
    }

    const rect = cachedRect(target);
    const half = rect.top + rect.height / 2;
    // BUG-260523-0900-002: hysteresis band — only flip the above/below
    // verdict when the cursor crosses the midpoint by more than
    // DROP_HYSTERESIS_PX. Within the band, retain the previous verdict.
    const distance = y - half;
    let above;
    const prev = lastAboveByTarget ? lastAboveByTarget.get(target) : undefined;
    if (Math.abs(distance) <= DROP_HYSTERESIS_PX && prev !== undefined) {
      above = prev;
    } else {
      above = distance < 0;
      if (lastAboveByTarget) lastAboveByTarget.set(target, above);
    }
    const contentX = rowContentX(target);
    const xOffset = x - contentX;

    const childIntent = xOffset > DROP_INDENT_PX;
    const outdentIntent = xOffset < DROP_OUTDENT_PX;

    if (target === drag.originRow) return null;

    // FOLDER dragging — depth-cap + cycle checks.
    if (drag.kind === "folder") {
      if (target.classList.contains("folder-row")) {
        const tDepth = parseInt(target.getAttribute("data-depth") || "1", 10);
        // Cycle check: target must not be a descendant of drag.id.
        if (isDomDescendantOfFolder(target, drag.id)) return null;

        if (childIntent) {
          // Drop-as-child: dragged folder becomes child of target at
          // depth = tDepth + 1. Subtree max depth = tDepth + 1 + subtreeMaxDepth.
          if (tDepth + 1 + drag.subtreeMaxDepth > MAX_DEPTH) return null;
          return { kind: "folder-into-folder", target };
        }
        // Sibling drop — dragged folder becomes sibling of target at
        // depth = tDepth. Subtree max depth = tDepth + subtreeMaxDepth.
        if (tDepth + drag.subtreeMaxDepth > MAX_DEPTH) return null;
        return { kind: "folder-sibling", target, above };
      }
      // Drop on a source row → become sibling under the source's parent
      // (matched to that source's folder_id).
      if (target.classList.contains("source-item")) {
        const tFolderId = target.getAttribute("data-folder-id") || null;
        if (tFolderId) {
          // The folder we'd land under is at some depth — find it.
          const parentRow = document.querySelector(
            '.folder-row[data-folder-id="' + tFolderId + '"]'
          );
          const pDepth = parentRow
            ? parseInt(parentRow.getAttribute("data-depth") || "0", 10)
            : 0;
          // Cycle guard.
          if (parentRow && isDomDescendantOfFolder(parentRow, drag.id)) return null;
          if (pDepth + 1 + drag.subtreeMaxDepth > MAX_DEPTH) return null;
          return { kind: "folder-into-parent-of-source", target };
        }
        // Source is in Ungrouped — folder lands at root level.
        if (1 + drag.subtreeMaxDepth > MAX_DEPTH) return null;
        return { kind: "folder-to-root", target };
      }
      return null;
    }

    // SOURCE dragging — drops anywhere.
    if (drag.kind === "source") {
      if (target.classList.contains("folder-row")) {
        if (childIntent) return { kind: "source-into-folder", target };
        return { kind: "source-sibling-of-folder", target, above };
      }
      if (target.classList.contains("source-item")) {
        if (outdentIntent) return { kind: "source-outdent-from", target };
        return { kind: "source-sibling-of-source", target, above };
      }
      return null;
    }

    // ARTICLE dragging — drop onto a folder or Ungrouped zone only.
    if (drag.kind === "article") {
      if (target.classList.contains("folder-row")) {
        return { kind: "article-into-folder", target };
      }
      if (target.classList.contains("source-item")) {
        // Drop onto a source row → inherit that source's folder (NULL =
        // Ungrouped behaviour).
        const tFolderId = target.getAttribute("data-folder-id") || null;
        return { kind: "article-into-source-folder", target, folderId: tFolderId };
      }
      return null;
    }

    return null;
  }

  function isDomDescendantOfFolder(targetRow, draggedFolderId) {
    // Walk up the DOM from targetRow looking for a .folder-children with
    // data-parent-folder-id matching draggedFolderId. If we find one, the
    // target is inside the dragged folder's subtree.
    let el = targetRow;
    while (el) {
      if (el.classList && el.classList.contains("folder-children") &&
          el.getAttribute("data-parent-folder-id") === draggedFolderId) {
        return true;
      }
      el = el.parentElement;
    }
    // Also check: target row's own id equals dragged id (handled separately
    // by `target === drag.originRow`).
    return false;
  }

  function paintDropIndicator(plan) {
    clearDropIndicator();
    if (!plan) return;
    const t = plan.target;
    const childKinds = [
      "folder-into-folder", "folder-into-parent-of-source", "folder-to-root",
      "source-into-folder", "into-ungrouped",
      "article-into-folder", "article-into-source-folder",
    ];
    if (childKinds.includes(plan.kind)) {
      t.classList.add("drop-target");
      return;
    }
    // sibling-style: render a horizontal bar above/below the target row.
    const bar = document.createElement("div");
    bar.className = "drop-indicator";
    if (plan.above) {
      t.parentNode.insertBefore(bar, t);
    } else {
      t.parentNode.insertBefore(bar, t.nextSibling);
    }
  }

  function clearDropIndicator() {
    $$("#source-list .drop-target").forEach(el => el.classList.remove("drop-target"));
    $$("#source-list .drop-indicator").forEach(el => el.remove());
  }

  function onListDragOver(ev) {
    if (!drag) return;
    const targetEl = (document.elementFromPoint(ev.clientX, ev.clientY) || ev.target);
    const target = targetEl.closest(".folder-row, .source-item, .ungrouped-zone");
    const plan = computeDropPlan(target, ev.clientX, ev.clientY);
    dropPlan = plan;
    if (plan) {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "move";
      paintDropIndicator(plan);
    } else {
      clearDropIndicator();
    }
  }

  function onListDragLeave(ev) {
    if (!ev.relatedTarget || !ev.currentTarget.contains(ev.relatedTarget)) {
      clearDropIndicator();
    }
  }

  function siblingPositionsAroundTarget(plan) {
    // Return [prevPosition, nextPosition] surrounding the insert point.
    const t = plan.target;
    let prev = null, next = null;
    const parent = t.parentElement;
    if (plan.kind === "source-sibling-of-source") {
      const siblings = parent ? Array.from(parent.querySelectorAll(":scope > .source-item")) : [t];
      const idx = siblings.indexOf(t);
      prev = plan.above ? siblings[idx - 1] : t;
      next = plan.above ? t : siblings[idx + 1];
    } else if (plan.kind === "folder-sibling" || plan.kind === "source-sibling-of-folder") {
      const sibs = parent
        ? Array.from(parent.querySelectorAll(":scope > .folder-row"))
        : [t];
      const idx = sibs.indexOf(t);
      prev = plan.above ? sibs[idx - 1] : t;
      next = plan.above ? t : sibs[idx + 1];
    }
    const posOf = (el) => el ? parseFloat(el.getAttribute("data-position") || "0") : null;
    return [posOf(prev), posOf(next)];
  }

  function midpoint(prevPos, nextPos) {
    if (prevPos == null && nextPos == null) return 0;
    if (prevPos == null) return nextPos - 1;
    if (nextPos == null) return prevPos + 1;
    return (prevPos + nextPos) / 2;
  }

  async function onListDrop(ev) {
    if (!drag || !dropPlan) { onDragEnd(); return; }
    ev.preventDefault();
    const plan = dropPlan;
    clearDropIndicator();

    let endpoint, body;
    try {
      // === FOLDER drops ===
      if (plan.kind === "folder-sibling") {
        // Sibling under same parent: only position changes.
        // Cross-parent sibling: also parent_id.
        const parentChildren = plan.target.parentElement;
        const newParent = parentChildren && parentChildren.classList.contains("folder-children")
          ? parentChildren.getAttribute("data-parent-folder-id")
          : null;
        const [a, b] = siblingPositionsAroundTarget(plan);
        endpoint = "/folders/" + drag.id;
        body = { position: midpoint(a, b) };
        if (newParent !== drag.currentParentId) {
          body.parent_id = newParent;  // null = root, string = some folder
        }
      } else if (plan.kind === "folder-into-folder") {
        const newParent = plan.target.getAttribute("data-folder-id");
        endpoint = "/folders/" + drag.id;
        body = { parent_id: newParent };
      } else if (plan.kind === "folder-into-parent-of-source") {
        const newParent = plan.target.getAttribute("data-folder-id") || null;
        endpoint = "/folders/" + drag.id;
        body = { parent_id: newParent };
      } else if (plan.kind === "folder-to-root") {
        endpoint = "/folders/" + drag.id;
        body = { parent_id: null };
      // === SOURCE drops ===
      } else if (plan.kind === "source-into-folder") {
        const fid = plan.target.getAttribute("data-folder-id");
        endpoint = "/sources/" + drag.id + "/parent";
        body = { folder_id: fid };
      } else if (plan.kind === "source-sibling-of-folder") {
        // Drop source above/below a folder row → attach to that folder's
        // parent (or Ungrouped if root).
        const parentChildren = plan.target.parentElement;
        const fid = parentChildren && parentChildren.classList.contains("folder-children")
          ? parentChildren.getAttribute("data-parent-folder-id")
          : null;
        endpoint = "/sources/" + drag.id + "/parent";
        body = { folder_id: fid };
      } else if (plan.kind === "source-sibling-of-source") {
        const tFolderId = plan.target.getAttribute("data-folder-id") || null;
        const [a, b] = siblingPositionsAroundTarget(plan);
        endpoint = "/sources/" + drag.id + "/parent";
        body = { folder_id: tFolderId, position: midpoint(a, b) };
      } else if (plan.kind === "source-outdent-from") {
        // Source dropped left of another source → outdent.
        const tFolderId = plan.target.getAttribute("data-folder-id") || null;
        endpoint = "/sources/" + drag.id + "/parent";
        if (tFolderId) {
          // Move up one level: find the source's folder's parent.
          const folderRow = document.querySelector(
            '.folder-row[data-folder-id="' + tFolderId + '"]'
          );
          const parentOfFolder = folderRow
            ? (folderRow.getAttribute("data-parent-id") || null)
            : null;
          body = { folder_id: parentOfFolder };
        } else {
          // Already in Ungrouped — no further outdent.
          body = { folder_id: null };
        }
      } else if (plan.kind === "into-ungrouped") {
        if (drag.kind === "article") {
          endpoint = "/articles/" + drag.id + "/parent";
          body = { folder_id: null };
        } else {
          endpoint = "/sources/" + drag.id + "/parent";
          body = { folder_id: null };
        }
      // === ARTICLE drops ===
      } else if (plan.kind === "article-into-folder") {
        const fid = plan.target.getAttribute("data-folder-id");
        endpoint = "/articles/" + drag.id + "/parent";
        body = { folder_id: fid };
      } else if (plan.kind === "article-into-source-folder") {
        endpoint = "/articles/" + drag.id + "/parent";
        body = { folder_id: plan.folderId };
      }

      if (endpoint && body) {
        await api(endpoint, { method: "PATCH", body });
        await refreshSidebar();
        if (drag.kind === "article") await refreshFeed();
      }
    } catch (e) {
      const msg = (e.detail && e.detail.message) || "Move failed.";
      showToast(msg, "error");
    }
    onDragEnd();
  }

  // -- pane separator (CR-260523-0900-004) --

  const SIDEBAR_MIN = 200;
  const SIDEBAR_MAX = 480;
  let resizeRaf = 0;
  let persistTimer = 0;
  let pendingWidth = null;

  function bindPaneSeparator() {
    const handle = $("#pane-separator");
    const container = $("#app-container");
    if (!handle || !container) return;
    handle.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      startPaneResize(handle, container, ev.clientX);
    });
    handle.addEventListener("keydown", (ev) => {
      // Keyboard accessibility — arrow keys nudge by 8px.
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      const current = parseInt(
        getComputedStyle(container).getPropertyValue("--sidebar-width")
        || "260", 10
      );
      const delta = ev.key === "ArrowLeft" ? -8 : 8;
      applyPaneWidth(container, current + delta, true);
      ev.preventDefault();
    });
  }

  function startPaneResize(handle, container, startX) {
    const currentWidth = container.getBoundingClientRect()
      ? parseInt(getComputedStyle(container).getPropertyValue("--sidebar-width")
                 || "260", 10)
      : 260;
    document.body.classList.add("is-resizing-pane");
    handle.classList.add("is-dragging");

    const onMove = (ev) => {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        const delta = ev.clientX - startX;
        applyPaneWidth(container, currentWidth + delta, false);
      });
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.classList.remove("is-resizing-pane");
      handle.classList.remove("is-dragging");
      if (pendingWidth != null) persistPaneWidth(pendingWidth);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function applyPaneWidth(container, raw, persistNow) {
    const clamped = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, raw));
    container.style.setProperty("--sidebar-width", clamped + "px");
    pendingWidth = clamped;
    if (persistNow) persistPaneWidth(clamped);
  }

  function persistPaneWidth(value) {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(async () => {
      try {
        await api("/settings/sidebar_width_px", {
          method: "PATCH",
          body: { width_px: value },
        });
      } catch (e) { /* silent — local state already reflects the change */ }
      pendingWidth = null;
    }, 250);
  }

  // -- onboarding banner --

  function bindBanner() {
    const dismiss = $("#grouping-banner-dismiss");
    if (!dismiss) return;
    dismiss.addEventListener("click", async () => {
      const banner = $("#grouping-banner");
      try {
        await api("/settings/grouping_banner_dismissed", {
          method: "PATCH",
          body: { dismissed: true },
        });
      } catch (e) { /* silent — UI hides regardless */ }
      if (banner) banner.remove();
    });
  }

  // ----- filter bar (CR-260523-1500-001) -----

  // CR-260524-0644-001: set when a keyword apply triggers a feed re-render, so
  // refreshFeed can restore focus to the freshly-rendered keyword input.
  let keywordShouldRefocus = false;

  function bindFilterBar() {
    // Date shortcut chips.
    $$("#filter-bar .date-shortcut").forEach(btn => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const code = btn.getAttribute("data-shortcut");
        if (state.filter.shortcut === code) {
          state.filter.shortcut = null;
        } else {
          state.filter.shortcut = code;
          state.filter.from = null;
          state.filter.to = null;
        }
        applyFilterChange();
      });
    });
    // Custom date-range button.
    const dateBtn = $("#date-range-btn");
    if (dateBtn) {
      dateBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        toggleDateRangePopover(dateBtn);
      });
    }
    // Content-select button.
    const contentBtn = $("#content-select-btn");
    if (contentBtn) {
      contentBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        toggleContentSelectPopover(contentBtn);
      });
    }
    // Keyword input — Enter (or the Add button) commits the typed word as a chip,
    // baking in the current Exact-toggle mode (CR-260524-0644-001 /
    // CR-260524-1315-001 / CR-260524-1421-001).
    const kwInput = $("#keyword-input");
    if (kwInput) {
      kwInput.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          beginAddKeyword(kwInput.value);
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          kwInput.value = "";
          kwInput.blur();
        }
      });
    }
    // Explicit Add button — equivalent to pressing Enter (AC-260524-1315-001).
    const kwAddBtn = $("#keyword-add-btn");
    if (kwAddBtn) {
      kwAddBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        beginAddKeyword(kwInput ? kwInput.value : "");
      });
    }
    // CR-260524-1421-001 — sticky Exact toggle. Flips the mode applied to the
    // next word added; existing chips keep their baked-in mode, so no re-query.
    const kwExact = $("#keyword-exact-toggle");
    if (kwExact) {
      kwExact.addEventListener("click", (ev) => {
        ev.stopPropagation();
        state.filter.exactMode = !state.filter.exactMode;
        syncExactToggle();
      });
    }
    // Any/All toggle — how multiple active keywords combine (AC-260524-0650-004).
    $$("#keyword-mode-toggle .keyword-mode-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const mode = btn.getAttribute("data-mode") === "all" ? "all" : "any";
        if (mode === state.filter.keywordMode) return;
        state.filter.keywordMode = mode;
        repaintFilterBar();
        // Only re-query when the choice can change the result (>=2 keywords).
        if (state.filter.keywords.length >= 2) applyFilterChange();
      });
    });
    // Reliability threshold chips (FT — Source Ratings, US-260525-1200-007).
    $$("#filter-bar .rel-shortcut").forEach(btn => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const rel = btn.getAttribute("data-rel");
        state.filter.reliability = state.filter.reliability === rel ? null : rel;
        applyFilterChange();
      });
    });
    // Impact-sort toggle.
    const impactSort = $("#filter-bar .impact-sort-btn");
    if (impactSort) {
      impactSort.addEventListener("click", (ev) => {
        ev.stopPropagation();
        state.filter.sort = state.filter.sort === "impact" ? null : "impact";
        applyFilterChange();
      });
    }
    // Empty-state "Clear filters" button.
    const clear = $("#clear-filters-btn");
    if (clear) {
      clear.addEventListener("click", (ev) => {
        ev.stopPropagation();
        clearAllFilters();
      });
    }
    repaintFilterBar();
  }

  function beginAddKeyword(raw) {
    // Blank / whitespace-only adds nothing (AC-260524-0650-003).
    const kw = (raw || "").trim();
    const input = $("#keyword-input");
    if (input) input.value = "";
    if (!kw) return;
    // Case-insensitive dedup — re-adding an existing word is a no-op
    // (the mode comes from the Exact toggle at add time: remove + re-add,
    // toggling Exact, to change it).
    if (state.filter.keywords.some(k => k.word.toLowerCase() === kw.toLowerCase())) return;
    // CR-260524-1421-001: commit immediately, baking in the sticky Exact-match
    // mode. Exact match on => whole-word, case-insensitive (wholeWord only, never
    // matchCase => keyword_opt "01"); off => loose case-insensitive substring ("00").
    const ex = !!state.filter.exactMode;
    state.filter.keywords.push({ word: kw, matchCase: false, wholeWord: ex });
    keywordShouldRefocus = true;
    applyFilterChange();
  }

  function syncExactToggle() {
    // CR-260524-1421-001: reflect state.filter.exactMode on the toggle control.
    const t = $("#keyword-exact-toggle");
    if (!t) return;
    const on = !!state.filter.exactMode;
    t.classList.toggle("is-on", on);
    t.setAttribute("aria-checked", on ? "true" : "false");
  }

  function removeKeyword(word) {
    const before = state.filter.keywords.length;
    state.filter.keywords = state.filter.keywords.filter(k => k.word !== word);
    if (state.filter.keywords.length !== before) applyFilterChange();
  }

  function clearAllFilters() {
    state.filter.shortcut = null;
    state.filter.from = null;
    state.filter.to = null;
    state.filter.sourceIds = [];
    state.filter.folderIds = [];
    state.filter.keywords = [];
    state.filter.reliability = null;
    state.filter.sort = null;
    applyFilterChange();
  }

  function applyFilterChange() {
    closeDateRangePopover();
    closeContentSelectPopover();
    refreshFeed();
    // CR-260523-1630-001: sidebar unread pills honour the date predicate.
    // Content multi-select / sidebar scope are intentionally ignored by
    // refreshSidebar (AC-260523-1630-004), so a single refresh covers
    // every applyFilterChange path safely.
    refreshSidebar();
  }

  function repaintFilterBar() {
    // Reflect state on the chip-btn UI affordances + render active-chip strip.
    $$("#filter-bar .date-shortcut").forEach(btn => {
      const code = btn.getAttribute("data-shortcut");
      btn.classList.toggle("is-active", state.filter.shortcut === code);
    });
    const dateBtn = $("#date-range-btn");
    const dateLabel = dateBtn && dateBtn.querySelector(".date-range-label");
    if (dateBtn && dateLabel) {
      const hasCustom = !!(state.filter.from || state.filter.to);
      dateBtn.classList.toggle("is-active", hasCustom);
      if (hasCustom) {
        const lo = state.filter.from || "…";
        const hi = state.filter.to || "…";
        dateLabel.textContent = lo + " → " + hi;
      } else {
        dateLabel.textContent = "Custom";
      }
    }
    const contentBtn = $("#content-select-btn");
    const contentLabel = contentBtn && contentBtn.querySelector(".content-select-label");
    if (contentBtn && contentLabel) {
      const n = state.filter.sourceIds.length + state.filter.folderIds.length;
      contentBtn.classList.toggle("is-active", n > 0);
      contentLabel.textContent = n > 0 ? n + " selected" : "All";
    }
    // Keyword input is a transient add-box now (keywords live as chips), so the
    // user's in-progress text is left alone. Reflect the Any/All toggle, shown
    // only when >=2 keywords are active (CR-260524-0644-001 / AC-260524-0650-004).
    const modeToggle = $("#keyword-mode-toggle");
    if (modeToggle) {
      modeToggle.hidden = state.filter.keywords.length < 2;
      $$("#keyword-mode-toggle .keyword-mode-btn").forEach(btn => {
        const m = btn.getAttribute("data-mode") === "all" ? "all" : "any";
        btn.classList.toggle("is-active", m === state.filter.keywordMode);
      });
    }
    // Rating threshold + impact-sort affordances (FT — Source Ratings).
    $$("#filter-bar .rel-shortcut").forEach(btn => {
      btn.classList.toggle("is-active", state.filter.reliability === btn.getAttribute("data-rel"));
    });
    const impactSort = $("#filter-bar .impact-sort-btn");
    if (impactSort) impactSort.classList.toggle("is-active", state.filter.sort === "impact");
    syncExactToggle();
    repaintFilterActive();
  }

  function repaintFilterActive() {
    const container = $("#filter-active");
    if (!container) return;
    container.innerHTML = "";
    const chips = [];

    // CR-260704-0800-003: the legacy sidebar-scope chip was removed here —
    // state.scopeFolderId is never set non-null since CR-260525-0745-002
    // routed sidebar selection through the content filter, so the chip code
    // was unreachable.
    if (state.filter.shortcut) {
      chips.push({
        kind: "date",
        label: "Last " + state.filter.shortcut,
        onClear: () => { state.filter.shortcut = null; applyFilterChange(); },
      });
    } else if (state.filter.from || state.filter.to) {
      const lo = state.filter.from || "…";
      const hi = state.filter.to || "…";
      chips.push({
        kind: "date",
        label: lo + " → " + hi,
        onClear: () => { state.filter.from = null; state.filter.to = null; applyFilterChange(); },
      });
    }
    state.filter.keywords.forEach(kw => {
      chips.push({
        kind: "keyword",
        label: "“" + kw.word + "”",
        // CR-260524-1315-001: committed chip shows its active match mode(s).
        modes: { matchCase: kw.matchCase, wholeWord: kw.wholeWord },
        onClear: () => removeKeyword(kw.word),
      });
    });
    if (state.filter.reliability) {
      const relLabel = { high: "High", medium: "Medium", low: "Low" }[state.filter.reliability] || state.filter.reliability;
      chips.push({
        kind: "rating",
        label: "Reliability ≥ " + relLabel,
        onClear: () => { state.filter.reliability = null; applyFilterChange(); },
      });
    }
    if (state.filter.sort === "impact") {
      chips.push({
        kind: "sort",
        label: "Sorted by impact",
        onClear: () => { state.filter.sort = null; applyFilterChange(); },
      });
    }
    const nameById = state.filterTreeNameById || {};
    state.filter.folderIds.forEach(fid => {
      const n = nameById["folder:" + fid] || "Folder";
      chips.push({
        kind: "folder",
        label: n,
        onClear: () => {
          state.filter.folderIds = state.filter.folderIds.filter(x => x !== fid);
          applyFilterChange();
        },
      });
    });
    state.filter.sourceIds.forEach(sid => {
      const n = nameById["source:" + sid] || "Source";
      chips.push({
        kind: "source",
        label: n,
        onClear: () => {
          state.filter.sourceIds = state.filter.sourceIds.filter(x => x !== sid);
          applyFilterChange();
        },
      });
    });

    if (chips.length === 0) {
      container.hidden = true;
      return;
    }
    container.hidden = false;
    chips.forEach(c => {
      const el = document.createElement("span");
      el.className = "filter-active-chip" + (c.kind === "scope" ? " is-scope" : "");
      let modeHtml = "";
      if (c.kind === "keyword" && c.modes && c.modes.wholeWord) {
        // CR-260524-1421-001: a single "Exact match" badge (whole word, case-insensitive).
        modeHtml += '<span class="filter-active-chip-mode" title="Exact match (whole word, case-insensitive)">Exact match</span>';
      }
      el.innerHTML =
        '<span class="filter-active-chip-label"></span>' + modeHtml +
        '<button type="button" class="filter-active-chip-x" aria-label="Clear filter"><i class="ti ti-x"></i></button>';
      el.querySelector(".filter-active-chip-label").textContent = c.label;
      el.querySelector(".filter-active-chip-x").addEventListener("click", c.onClear);
      container.appendChild(el);
    });
    const clearAll = document.createElement("button");
    clearAll.type = "button";
    clearAll.className = "filter-clear-all-btn";
    clearAll.textContent = "Clear all";
    // CR-260704-0800-003: single clear-filters implementation.
    clearAll.addEventListener("click", clearAllFilters);
    container.appendChild(clearAll);
  }

  // -- date-range popover --

  function toggleDateRangePopover(anchor) {
    const pop = $("#date-range-popover");
    if (!pop) return;
    if (!pop.hidden) { closeDateRangePopover(); return; }
    positionPopover(pop, anchor);
    $("#date-range-from").value = state.filter.from || "";
    $("#date-range-to").value = state.filter.to || "";
    const err = $("#date-range-error");
    if (err) { err.hidden = true; err.textContent = ""; }
    pop.hidden = false;
    // Wire actions (idempotent per open — replace handlers).
    $("#date-range-apply").onclick = applyDateRange;
    $("#date-range-clear").onclick = () => {
      state.filter.from = null;
      state.filter.to = null;
      applyFilterChange();
    };
  }

  function closeDateRangePopover() {
    const pop = $("#date-range-popover");
    if (pop) pop.hidden = true;
  }

  function applyDateRange() {
    const from = $("#date-range-from").value || null;
    const to = $("#date-range-to").value || null;
    const err = $("#date-range-error");
    if (from && to && new Date(to) < new Date(from)) {
      err.hidden = false;
      err.textContent = "End date must be on or after start date.";
      return;
    }
    if (from && to) {
      const diffDays = (new Date(to) - new Date(from)) / 86400e3;
      if (diffDays > 365) {
        err.hidden = false;
        err.textContent = "Range cannot exceed 1 year.";
        return;
      }
    }
    state.filter.from = from;
    state.filter.to = to;
    state.filter.shortcut = null;  // mutually exclusive
    applyFilterChange();
  }

  // -- content-select popover --

  async function toggleContentSelectPopover(anchor) {
    const pop = $("#content-select-popover");
    if (!pop) return;
    if (!pop.hidden) { closeContentSelectPopover(); return; }
    positionPopover(pop, anchor);
    pop.hidden = false;
    await ensureFilterTreeLoaded();
    renderContentSelectList();
    const search = $("#content-select-search");
    if (search) {
      search.value = "";
      search.oninput = onContentSelectSearch;
      setTimeout(() => search.focus(), 0);
    }
    $("#content-select-clear").onclick = () => {
      state.filter.sourceIds = [];
      state.filter.folderIds = [];
      renderContentSelectList();
      repaintFilterBar();
      paintSidebarSelection();
    };
    $("#content-select-done").onclick = () => {
      closeContentSelectPopover();
      // Apply the staged selection.
      refreshFeed();
    };
  }

  function closeContentSelectPopover() {
    const pop = $("#content-select-popover");
    if (pop) pop.hidden = true;
  }

  async function ensureFilterTreeLoaded() {
    if (state.filterTree) return;
    try {
      const data = await api("/filter-tree");
      state.filterTree = (data && data.tree) || [];
      // Build a name lookup for chip labels.
      const idx = {};
      state.filterTree.forEach(n => {
        if (n.kind === "folder") idx["folder:" + n.id] = n.name;
        if (n.kind === "source") idx["source:" + n.id] = n.name;
      });
      state.filterTreeNameById = idx;
      buildFilterTreeIndex();
    } catch (e) {
      state.filterTree = [];
      state.filterTreeNameById = {};
      buildFilterTreeIndex();
    }
  }

  // CR-260525-0730-001: precompute the tree relationships needed to make the
  // content-selection dropdown a proper tree-checkbox (cascade + parent
  // tri-state). The server tree is a flat list with parent_id per node.
  function buildFilterTreeIndex() {
    const tree = state.filterTree || [];
    const parentFolderOf = {};         // nodeId -> parent folder id (or null)
    const childFoldersOf = {};         // folderId|null -> [child folder ids]
    const directSourcesOf = {};        // folderId|null -> [direct source ids]
    const folderOrder = [];
    const allSourceIds = [];
    tree.forEach(n => {
      if (n.kind === "ungrouped_header") return;
      const p = n.parent_id || null;
      parentFolderOf[n.id] = p;
      if (n.kind === "folder") {
        folderOrder.push(n.id);
        (childFoldersOf[p] = childFoldersOf[p] || []).push(n.id);
      } else if (n.kind === "source") {
        allSourceIds.push(n.id);
        (directSourcesOf[p] = directSourcesOf[p] || []).push(n.id);
      }
    });
    const descendantSourceIds = {};    // folderId -> [all source ids in subtree]
    const compute = (fid) => {
      if (descendantSourceIds[fid]) return descendantSourceIds[fid];
      let acc = (directSourcesOf[fid] || []).slice();
      (childFoldersOf[fid] || []).forEach(cf => { acc = acc.concat(compute(cf)); });
      descendantSourceIds[fid] = acc;
      return acc;
    };
    folderOrder.forEach(compute);
    state.filterTreeIndex = { parentFolderOf, descendantSourceIds, folderOrder, allSourceIds };
  }

  // Effective set of selected SOURCE ids = explicit sources + every source
  // beneath a selected folder. The single source of truth for display state.
  function contentSelGetSelectedSources() {
    if (!state.filterTreeIndex) buildFilterTreeIndex();
    const idx = state.filterTreeIndex;
    const set = new Set(state.filter.sourceIds || []);
    (state.filter.folderIds || []).forEach(fid => {
      (idx.descendantSourceIds[fid] || []).forEach(sid => set.add(sid));
    });
    return set;
  }

  // Normalise a set of selected source ids back into the minimal covering
  // {folderIds, sourceIds} pair: a fully-selected folder collapses to a single
  // folder id (one chip) and its descendants drop out; partially-selected
  // folders contribute their selected leaves individually. Feed-predicate
  // result is identical (folders expand to their sources server-side).
  function contentSelSetSelection(selSet) {
    if (!state.filterTreeIndex) buildFilterTreeIndex();
    const idx = state.filterTreeIndex;
    const fully = {};
    idx.folderOrder.forEach(fid => {
      const desc = idx.descendantSourceIds[fid] || [];
      fully[fid] = desc.length > 0 && desc.every(sid => selSet.has(sid));
    });
    const folderIds = [];
    idx.folderOrder.forEach(fid => {
      if (!fully[fid]) return;
      const p = idx.parentFolderOf[fid];
      if (p && fully[p]) return;       // covered by a fully-selected ancestor
      folderIds.push(fid);
    });
    const sourceIds = [];
    idx.allSourceIds.forEach(sid => {
      if (!selSet.has(sid)) return;
      const p = idx.parentFolderOf[sid];
      if (p && fully[p]) return;        // covered by a folder chip
      sourceIds.push(sid);
    });
    state.filter.folderIds = folderIds;
    state.filter.sourceIds = sourceIds;
  }

  function renderContentSelectList() {
    const list = $("#content-select-list");
    if (!list) return;
    list.innerHTML = "";
    if (!state.filterTree || state.filterTree.length === 0) {
      list.innerHTML = '<div class="content-select-empty">No sources to filter yet.</div>';
      return;
    }
    if (!state.filterTreeIndex) buildFilterTreeIndex();
    const idx = state.filterTreeIndex;
    const selSources = contentSelGetSelectedSources();
    state.filterTree.forEach(node => {
      const row = document.createElement("div");
      row.className = "content-select-row";
      row.setAttribute("data-kind", node.kind);
      row.setAttribute("data-depth", String(node.depth || 0));
      row.setAttribute("data-id", node.id);
      row.setAttribute("data-name-lc", (node.name || "").toLowerCase());
      // Indent based on depth.
      row.style.paddingLeft = (8 + (node.depth || 0) * 14) + "px";
      if (node.kind === "ungrouped_header") {
        row.innerHTML = '<span class="content-select-row-name">' + escapeHtml(node.name) + '</span>';
        list.appendChild(row);
        return;
      }
      const check = document.createElement("span");
      check.className = "content-select-row-check";
      check.innerHTML = '<i class="ti ti-check"></i>';
      row.appendChild(check);
      if (node.kind === "source" && node.colour) {
        const dot = document.createElement("span");
        dot.className = "content-select-row-dot";
        dot.style.background = node.colour;
        row.appendChild(dot);
      }
      const name = document.createElement("span");
      name.className = "content-select-row-name";
      name.textContent = node.name;
      row.appendChild(name);
      // Tree-checkbox display state (CR-260525-0730-001). A source is checked
      // when in the effective set; a folder reflects its descendant sources:
      // all checked -> checked, some -> indeterminate, none -> empty.
      if (node.kind === "folder") {
        const desc = idx.descendantSourceIds[node.id] || [];
        const selCount = desc.reduce((c, sid) => c + (selSources.has(sid) ? 1 : 0), 0);
        if (desc.length > 0 && selCount === desc.length) row.classList.add("is-selected");
        else if (selCount > 0) row.classList.add("is-indeterminate");
      } else if (selSources.has(node.id)) {
        row.classList.add("is-selected");
      }
      row.addEventListener("click", (ev) => {
        ev.stopPropagation();
        toggleContentSelectRow(node);
        // Re-render so selection visuals update; dropdown stays open
        // (AC-260523-1500-004).
        renderContentSelectList();
        repaintFilterBar();
        // CR-260525-0745-002: keep the sidebar selection visuals in sync.
        paintSidebarSelection();
      });
      list.appendChild(row);
    });
  }

  // CR-260525-0730-001: ticking a Group/Subgroup cascades the checked state to
  // every descendant; unticking clears them. Operate on the effective source
  // set, then normalise back to {folderIds, sourceIds}.
  function toggleContentSelectRow(node) {
    if (!state.filterTreeIndex) buildFilterTreeIndex();
    const idx = state.filterTreeIndex;
    const sel = contentSelGetSelectedSources();
    if (node.kind === "folder") {
      const desc = idx.descendantSourceIds[node.id] || [];
      const allOn = desc.length > 0 && desc.every(sid => sel.has(sid));
      if (allOn) desc.forEach(sid => sel.delete(sid));
      else desc.forEach(sid => sel.add(sid));
    } else if (node.kind === "source") {
      if (sel.has(node.id)) sel.delete(node.id);
      else sel.add(node.id);
    }
    contentSelSetSelection(sel);
  }

  function onContentSelectSearch(ev) {
    const q = (ev.target.value || "").trim().toLowerCase();
    $$("#content-select-list .content-select-row").forEach(row => {
      if (!q) { row.classList.remove("is-hidden"); return; }
      const name = row.getAttribute("data-name-lc") || "";
      row.classList.toggle("is-hidden", !name.includes(q));
    });
  }

  function positionPopover(pop, anchor) {
    const rect = anchor.getBoundingClientRect();
    // Reset so measurement is accurate.
    pop.style.visibility = "hidden";
    pop.hidden = false;
    pop.style.top = "0px";
    pop.style.left = "0px";
    const pr = pop.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = rect.bottom + 6;
    let left = rect.left;
    if (left + pr.width > vw - 8) left = Math.max(8, vw - pr.width - 8);
    if (top + pr.height > vh - 8) top = Math.max(8, rect.top - pr.height - 6);
    pop.style.top = (window.scrollY + top) + "px";
    pop.style.left = (window.scrollX + left) + "px";
    pop.hidden = true;
    pop.style.visibility = "";
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function bindFilterPopoverDismiss() {
    // Click-outside closes either popover. Listening once on document.
    document.addEventListener("click", (ev) => {
      const inDate = ev.target.closest("#date-range-popover") || ev.target.closest("#date-range-btn");
      const inContent = ev.target.closest("#content-select-popover") || ev.target.closest("#content-select-btn");
      if (!inDate) closeDateRangePopover();
      if (!inContent) {
        const pop = $("#content-select-popover");
        if (pop && !pop.hidden) {
          closeContentSelectPopover();
          // Apply the staged selection on click-outside (AC-260523-1500-004).
          refreshFeed();
        }
      }
    });
  }

  // ----- settings modal + library export (EP — Data Portability) -----

  function bindSettingsModal() {
    const btn = $("#settings-btn");
    if (btn) btn.addEventListener("click", openSettingsModal);
    const close = $("#settings-close");
    if (close) close.addEventListener("click", closeSettingsModal);
    const overlay = $("#settings-modal");
    if (overlay) {
      overlay.addEventListener("click", (ev) => {
        if (ev.target.id === "settings-modal") closeSettingsModal();
      });
    }
    const exportBtn = $("#export-library-btn");
    if (exportBtn) exportBtn.addEventListener("click", onExportLibrary);
    const openReview = $("#open-review-btn");
    if (openReview) {
      openReview.addEventListener("click", () => {
        closeSettingsModal();
        openReviewModal();
      });
    }
  }

  function openSettingsModal() {
    const m = $("#settings-modal");
    if (!m) return;
    const res = $("#export-result");
    if (res) res.hidden = true;
    m.hidden = false;
    modalOpened("settings-modal");  // CR-260704-0800-002
    updateReviewCount();
  }

  function closeSettingsModal() {
    const m = $("#settings-modal");
    if (m) m.hidden = true;
    modalClosed("settings-modal");  // CR-260704-0800-002
  }

  function toggleExportSpinner(on) {
    const btn = $("#export-library-btn");
    if (!btn) return;
    btn.disabled = !!on;
    const label = btn.querySelector(".submit-label");
    const spin = btn.querySelector(".submit-spinner");
    if (label) label.hidden = !!on;
    if (spin) spin.hidden = !on;
  }

  async function onExportLibrary() {
    const res = $("#export-result");
    toggleExportSpinner(true);
    try {
      const data = await api("/export", { method: "POST" });
      // AC-260525-1200-010: success names the saved file.
      if (res) {
        res.className = "settings-result is-ok";
        res.textContent = "Export complete — saved " + (data.file || "almanach-library.yaml") + ".";
        res.hidden = false;
      }
      showToast("Export complete — " + (data.file || "almanach-library.yaml"));
    } catch (e) {
      // AC-260525-1200-011: failure shows an error, never a false success.
      const msg = (e.detail && e.detail.message) || "Export failed.";
      if (res) {
        res.className = "settings-result is-error";
        res.textContent = msg;
        res.hidden = false;
      }
      showToast(msg, "error");
    } finally {
      toggleExportSpinner(false);
    }
  }

  // ----- review proposed sources (US-260525-1200-004) -----

  function bindReviewBadge() {
    const badge = $("#review-badge");
    if (badge) badge.addEventListener("click", openReviewModal);
    const close = $("#review-close");
    if (close) close.addEventListener("click", closeReviewModal);
    const done = $("#review-done");
    if (done) done.addEventListener("click", closeReviewModal);
    const overlay = $("#review-modal");
    if (overlay) {
      overlay.addEventListener("click", (ev) => {
        if (ev.target.id === "review-modal") closeReviewModal();
      });
    }
  }

  function closeReviewModal() {
    const m = $("#review-modal");
    if (m) m.hidden = true;
    modalClosed("review-modal");  // CR-260704-0800-002
  }

  async function openReviewModal() {
    const m = $("#review-modal");
    if (!m) return;
    const list = $("#review-list");
    if (list) list.innerHTML = '<div class="content-select-loading">Loading…</div>';
    m.hidden = false;
    modalOpened("review-modal");  // CR-260704-0800-002
    await renderReviewList();
  }

  async function renderReviewList() {
    const list = $("#review-list");
    if (!list) return;
    let data;
    try {
      data = await api("/review");
    } catch (e) {
      list.innerHTML = '<div class="content-select-empty">Could not load proposals.</div>';
      return;
    }
    const items = (data && data.items) || [];
    if (items.length === 0) {
      list.innerHTML = '<div class="content-select-empty">No proposed sources right now.</div>';
      return;
    }
    list.innerHTML = "";
    items.forEach(item => list.appendChild(reviewRow(item)));
  }

  function reviewRow(item) {
    const row = document.createElement("div");
    row.className = "review-row";
    row.setAttribute("data-id", item.id);

    const main = document.createElement("div");
    main.className = "review-row-main";

    const ct = document.createElement("span");
    ct.className = "review-change review-change-" + (item.change_type || "ADDED").toLowerCase();
    ct.textContent = item.change_type;
    main.appendChild(ct);

    const title = document.createElement("span");
    title.className = "review-row-title";
    if (item.object_kind === "folder") {
      title.innerHTML = '<i class="ti ti-folder"></i> ' + escapeHtml((item.folder_path || [item.name]).join(" › "));
    } else {
      const label = item.display_name || item.url || "source";
      const path = (item.folder_path && item.folder_path.length)
        ? '<span class="review-row-path">' + escapeHtml(item.folder_path.join(" › ")) + '</span>'
        : "";
      title.innerHTML = '<span class="review-row-name">' + escapeHtml(label) + "</span>" + path;
    }
    main.appendChild(title);
    row.appendChild(main);

    // Rating selectors only for source ADDED/MODIFIED (not folders, not REMOVED).
    if (item.object_kind === "source" && item.change_type !== "REMOVED") {
      const ratings = document.createElement("div");
      ratings.className = "review-row-ratings";
      ratings.appendChild(reviewRatingGroup("reliability", item.reliability || "medium"));
      ratings.appendChild(reviewRatingGroup("impact", item.impact || "medium"));
      row.appendChild(ratings);
    }

    const actions = document.createElement("div");
    actions.className = "review-row-actions";
    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "btn btn-primary review-approve";
    approve.textContent = item.change_type === "REMOVED" ? "Approve removal" : "Approve";
    approve.addEventListener("click", () => onReviewApprove(row, item, approve));
    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "btn review-reject";
    reject.textContent = "Reject";
    reject.addEventListener("click", () => onReviewReject(row, item));
    actions.appendChild(approve);
    actions.appendChild(reject);
    row.appendChild(actions);
    return row;
  }

  function reviewRatingGroup(dim, value) {
    const group = document.createElement("div");
    group.className = "review-rating";
    group.setAttribute("data-rating", dim);
    group.setAttribute("data-value", value);
    const label = document.createElement("span");
    label.className = "review-rating-label";
    label.textContent = dim === "reliability" ? "Rel" : "Impact";
    group.appendChild(label);
    ["high", "medium", "low"].forEach(l => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rating-opt" + (l === value ? " is-active" : "");
      b.textContent = l.charAt(0).toUpperCase();
      b.title = l;
      b.addEventListener("click", () => {
        group.setAttribute("data-value", l);
        group.querySelectorAll(".rating-opt").forEach(x => x.classList.remove("is-active"));
        b.classList.add("is-active");
      });
      group.appendChild(b);
    });
    return group;
  }

  async function onReviewApprove(row, item, approveBtn) {
    const body = {};
    if (item.object_kind === "source" && item.change_type !== "REMOVED") {
      row.querySelectorAll(".review-rating").forEach(g => {
        body[g.getAttribute("data-rating")] = g.getAttribute("data-value");
      });
    }
    approveBtn.disabled = true;
    approveBtn.textContent = "…";
    try {
      const res = await api("/review/" + item.id + "/approve", { method: "POST", body });
      row.remove();
      await refreshSidebar();
      await refreshFeed();
      setReviewCount(res.remaining);
      const list = $("#review-list");
      if (list && !list.querySelector(".review-row")) {
        list.innerHTML = '<div class="content-select-empty">No proposed sources right now.</div>';
      }
      showToast("Approved.");
    } catch (e) {
      approveBtn.disabled = false;
      approveBtn.textContent = item.change_type === "REMOVED" ? "Approve removal" : "Approve";
      const msg = (e.detail && e.detail.message) || "Approve failed.";
      showToast(msg, "error");
    }
  }

  async function onReviewReject(row, item) {
    try {
      const res = await api("/review/" + item.id + "/reject", { method: "POST" });
      row.remove();
      setReviewCount(res.remaining);
      const list = $("#review-list");
      if (list && !list.querySelector(".review-row")) {
        list.innerHTML = '<div class="content-select-empty">No proposed sources right now.</div>';
      }
      showToast("Rejected.");
    } catch (e) {
      showToast("Reject failed.", "error");
    }
  }

  function setReviewCount(n) {
    const count = typeof n === "number" ? n : 0;
    const badge = $("#review-badge");
    const countEl = $("#review-count");
    const settingsCount = $("#settings-review-count");
    if (countEl) countEl.textContent = count;
    if (settingsCount) settingsCount.textContent = count;
    if (badge) badge.hidden = count <= 0;
  }

  async function updateReviewCount() {
    try {
      const data = await api("/review/count");
      if (data && typeof data.count === "number") setReviewCount(data.count);
    } catch (e) { /* silent */ }
  }

  // ----- Excel sources data menu (CR-260704-1825-001) -----

  // Header "Sources data" popover: export / blank template are plain
  // downloads; upload POSTs the picked .xlsx file's raw bytes and the server
  // replaces the whole hierarchy immediately (no confirmation).
  function bindSourcesIO() {
    const btn = $("#io-btn");
    const menu = $("#io-menu");
    const file = $("#io-file");
    if (!btn || !menu || !file) return;

    function closeMenu() {
      menu.hidden = true;
      btn.classList.remove("active");
      btn.setAttribute("aria-expanded", "false");
    }
    btn.addEventListener("click", () => {
      const open = menu.hidden;
      menu.hidden = !open;
      btn.classList.toggle("active", open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("mousedown", (ev) => {
      if (!menu.hidden && !menu.contains(ev.target) && !btn.contains(ev.target)) closeMenu();
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !menu.hidden) closeMenu();
    });

    function download(path) {
      const a = document.createElement("a");
      a.href = path;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    $("#io-export").addEventListener("click", () => {
      closeMenu();
      download("/io/export");
      showToast("Sources exported.");
    });
    $("#io-template").addEventListener("click", () => {
      closeMenu();
      download("/io/template");
      showToast("Blank template downloaded.");
    });
    $("#io-upload").addEventListener("click", () => {
      closeMenu();
      file.value = "";
      file.click();
    });
    file.addEventListener("change", async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      // The .xlsx bytes are binary, so post the File directly with a raw
      // fetch — the api() helper JSON-stringifies non-string bodies.
      let result;
      try {
        const resp = await fetch("/io/import", { method: "POST", body: f, cache: "no-store" });
        if (!resp.ok) {
          let detail = null;
          try { detail = (await resp.json()).detail; } catch (e) { /* ignore */ }
          const msg = (detail && detail.message) ||
            (typeof detail === "string" ? detail : "Could not import that file.");
          showToast(msg, "error");
          return;
        }
        result = await resp.json();
      } catch (e) {
        showToast("Could not import that file.", "error");
        return;
      }
      // The old selection may not exist any more — reset to All sources.
      state.activeSourceId = null;
      state.scopeFolderId = null;
      state.scopeFolderName = null;
      state.activeProjectId = null;
      await Promise.all([refreshSidebar(), refreshFeed()]);
      const n = result.sources;
      const g = result.groups;
      let msg = "Imported " + n + " source" + (n === 1 ? "" : "s") +
                " across " + g + " group" + (g === 1 ? "" : "s") + ".";
      if (result.skipped && result.skipped.length) {
        msg += " Skipped " + result.skipped.length + " without a valid url.";
      }
      showToast(msg);
    });
  }

  // ----- keyboard accessibility (CR-260704-0800-002) -----

  // Delegated keyboard handling for the sidebar tree and the feed. #source-list
  // and #feed-pane persist across partial re-renders (only their innerHTML is
  // swapped), so binding once at init covers every future row.
  function bindKeyboardNav() {
    const list = $("#source-list");
    if (list && !list.__almKeyBound) {
      list.__almKeyBound = true;
      list.addEventListener("keydown", onSidebarKeydown);
    }
    const pane = $("#feed-pane");
    if (pane && !pane.__almKeyBound) {
      pane.__almKeyBound = true;
      pane.addEventListener("keydown", onFeedKeydown);
    }
  }

  function visibleSidebarRows() {
    return $$("#source-list .source-item, #source-list .folder-row, #source-list .project-row")
      .filter(r => r.offsetParent !== null);
  }

  function onSidebarKeydown(ev) {
    const row = ev.target.closest(".source-item, .folder-row, .project-row");
    if (!row) return;
    if ((ev.key === "Enter" || ev.key === " ") && ev.target === row) {
      ev.preventDefault();
      if (row.classList.contains("project-row")) {
        // FT-260704-1620-001: keyboard activation opens the project view.
        selectProject(row.getAttribute("data-project-id"));
      } else if (row.classList.contains("folder-row")) {
        const nameEl = row.querySelector(".folder-name");
        if (nameEl) {
          onFolderTitleClick({
            currentTarget: nameEl,
            stopPropagation: () => {},
            shiftKey: ev.shiftKey,
          });
        }
      } else {
        // Reuse the click logic (incl. muted no-op) with Shift multi-select.
        onRowClick({ currentTarget: row, target: row, shiftKey: ev.shiftKey });
      }
      return;
    }
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const rows = visibleSidebarRows();
      const next = rows[rows.indexOf(row) + (ev.key === "ArrowDown" ? 1 : -1)];
      if (next) next.focus();
      return;
    }
    // ArrowRight expands / ArrowLeft collapses a folder row.
    if ((ev.key === "ArrowRight" || ev.key === "ArrowLeft")
        && row.classList.contains("folder-row") && ev.target === row) {
      const collapsed = row.classList.contains("collapsed");
      if ((ev.key === "ArrowRight" && collapsed) || (ev.key === "ArrowLeft" && !collapsed)) {
        ev.preventDefault();
        const chev = row.querySelector(".chevron");
        if (chev) chev.click();
      }
    }
  }

  function onFeedKeydown(ev) {
    const card = ev.target.closest(".article");
    if (!card) return;
    if ((ev.key === "Enter" || ev.key === " ") && ev.target === card) {
      ev.preventDefault();
      card.click();   // routes through onArticleClick
      return;
    }
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const cards = $$("#feed-pane .article");
      const next = cards[cards.indexOf(card) + (ev.key === "ArrowDown" ? 1 : -1)];
      if (next) {
        next.focus();
        next.scrollIntoView({ block: "nearest" });
      }
    }
  }

  // -- modal focus management: trap while open, restore on close --

  const modalReturnFocus = {};

  function modalFocusables(overlay) {
    return $$(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      overlay
    ).filter(el => !el.disabled && !el.hidden && el.offsetParent !== null);
  }

  // Record the triggering control and move focus into the modal. Pass
  // focusFirst=false when the modal manages its own initial focus.
  function modalOpened(id, focusFirst) {
    modalReturnFocus[id] = document.activeElement;
    if (focusFirst === false) return;
    const overlay = $("#" + id);
    if (!overlay) return;
    setTimeout(() => {
      const items = modalFocusables(overlay);
      if (items.length) items[0].focus();
    }, 0);
  }

  function modalClosed(id) {
    const prev = modalReturnFocus[id];
    modalReturnFocus[id] = null;
    if (prev && document.contains(prev) && typeof prev.focus === "function") {
      prev.focus();
    }
  }

  // Tab trap: while a modal is open, Tab cycles inside it and wraps at the
  // ends (AC-260704-0800-005).
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Tab") return;
    const open = MODAL_CLOSERS.map(m => $("#" + m.id)).find(el => el && !el.hidden);
    if (!open) return;
    const items = modalFocusables(open);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (!open.contains(document.activeElement)) {
      ev.preventDefault();
      (ev.shiftKey ? last : first).focus();
      return;
    }
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  });

  // ----- global -----

  document.addEventListener("click", (ev) => {
    if (state.menuOpenFor && !ev.target.closest("#row-menu") && !ev.target.closest(".row-action-btn")) {
      closeRowMenu();
    }
  });

  // BUG-260704-0735-008: Escape dismisses the topmost open surface generically
  // — one surface per press, covering ALL four modals (settings + review
  // included), each via its own close routine so per-modal side effects are
  // preserved. Priority: open row menu first, then modals by stacking order.
  const MODAL_CLOSERS = [
    { id: "confirm-modal", close: () => { const c = $("#confirm-cancel"); if (c) c.click(); } },
    { id: "add-source-modal", close: () => closeAddSourceModal() },
    { id: "review-modal", close: () => closeReviewModal() },
    { id: "settings-modal", close: () => closeSettingsModal() },
  ];

  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    // Save-to-project popover closes first, without changing any saves
    // (AC-260704-1620-011).
    if (state.saveMenuFor) { closeSaveMenu(); return; }
    if (state.menuOpenFor) { closeRowMenu(); return; }
    for (const m of MODAL_CLOSERS) {
      const el = $("#" + m.id);
      if (el && !el.hidden) { m.close(); return; }
    }
  });

  // ----- boot -----

  function init() {
    // Read any pre-rendered active source from the first ".active" row that
    // is not the All-sources entry.
    const activeRow = $$("#source-list .source-item.active").find(
      r => !r.classList.contains("all-sources")
    );
    if (activeRow) state.activeSourceId = activeRow.getAttribute("data-source-id");
    readFeedCursor();
    bindSidebar();
    bindFolders();
    bindDragDrop();
    bindNewGroupBtn();
    bindProjects();
    bindSaveMenu();
    bindFeed();
    bindFeedScroll();
    bindAddSourceForm();
    bindRowMenuHover();
    bindBanner();
    bindPaneSeparator();
    bindFilterBar();
    bindFilterPopoverDismiss();
    bindSettingsModal();
    bindReviewBadge();
    bindSourcesIO();  // CR-260704-1825-001
    bindKeyboardNav();  // CR-260704-0800-002
    updateLastSyncLabel();
    updateReviewCount();
    startLastSyncPoll();
  }

  function startLastSyncPoll() {
    // Keeps the header label fresh between manual clicks and scheduled poll
    // cycles. Short interval so the 'N min ago' text never drifts visibly,
    // and so AC-260522-2030-009 (header re-renders after scheduled poll
    // completion) is observably satisfied without a websocket.
    setInterval(updateLastSyncLabel, LAST_SYNC_POLL_MS);
    // Poll the staged-proposal count so the "Review proposed (N)" badge appears
    // / updates as the watcher stages an import, without an app restart
    // (AC-260525-1200-030).
    setInterval(updateReviewCount, REVIEW_POLL_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
