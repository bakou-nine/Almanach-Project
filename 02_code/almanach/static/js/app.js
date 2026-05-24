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
      // CR-260524-1421-001 — sticky "Exact match" toggle: when on, the next word
      // added is committed as a whole-word match (case-insensitive, wholeWord only);
      // off = loose case-insensitive substring (default).
      exactMode: false,
    },
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

  const HOVER_GRACE_MS = 500;
  const LAST_SYNC_POLL_MS = 15000;
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

  async function refreshSidebar() {
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
    $("#source-list").innerHTML = html;
    bindSidebar();
    bindFolders();
    bindDragDrop();
    updateLastSyncLabel();
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
    params.set("size", state.pageSize);
    return params;
  }

  function computeFilterDateBounds() {
    // Shortcut wins if set (mutually exclusive with custom range — UI keeps
    // them in sync). Returns {from, to} as ISO strings, both inclusive.
    if (state.filter.shortcut) {
      const now = new Date();
      const ms = { "1d": 86400e3, "1w": 7 * 86400e3, "1m": 30 * 86400e3 }[state.filter.shortcut];
      const from = new Date(now.getTime() - ms);
      return { from: from.toISOString(), to: null };
    }
    let from = null, to = null;
    if (state.filter.from) from = state.filter.from + "T00:00:00";
    if (state.filter.to) to = state.filter.to + "T23:59:59";
    return { from, to };
  }

  async function refreshFeed() {
    // Full reload — replaces the whole feed pane (header + first batch).
    // Resets the scroll cursor.
    const params = buildFeedParams();
    const html = await api("/feed-partial?" + params.toString());
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
  }

  function readFeedCursor() {
    const list = $("#article-list");
    if (!list) {
      state.feedNextAfter = null;
      state.feedHasMore = false;
      return;
    }
    state.feedNextAfter = list.getAttribute("data-next-after") || null;
    state.feedHasMore = list.getAttribute("data-has-more") === "1";
    const end = $("#feed-end-marker");
    if (end) end.hidden = state.feedHasMore;
  }

  async function loadMoreFeed() {
    if (state.feedLoading || !state.feedHasMore || !state.feedNextAfter) return;
    state.feedLoading = true;
    const spinner = $("#feed-spinner");
    if (spinner) spinner.hidden = false;
    try {
      const params = buildFeedParams();
      params.set("after", state.feedNextAfter);
      params.set("rows_only", "true");
      const html = await api("/feed-partial?" + params.toString());
      const list = $("#article-list");
      if (list && html) {
        list.insertAdjacentHTML("beforeend", html);
      }
      // Re-read the cursor from the LAST card's data-published-at attribute.
      const lastCard = list ? list.querySelector(".article:last-of-type") : null;
      if (lastCard) {
        state.feedNextAfter = lastCard.getAttribute("data-published-at");
      }
      // If the appended html had fewer than pageSize cards, end-of-feed.
      const appendedCount = html
        ? (html.match(/class="article"/g) || []).length
        : 0;
      if (appendedCount < state.pageSize) {
        state.feedHasMore = false;
        const end = $("#feed-end-marker");
        if (end) end.hidden = false;
      }
      // Re-bind the article click handler on the newly-appended rows.
      bindArticleRows();
    } catch (e) {
      // Network blip — silent; user can scroll again.
    } finally {
      state.feedLoading = false;
      if (spinner) spinner.hidden = true;
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
    state.activeSourceId = id || null;
    // CR-260523-1501-001 AC-260523-1501-003: source / folder / All-sources
    // selection is mutually exclusive — clear any active folder scope.
    state.scopeFolderId = null;
    state.scopeFolderName = null;
    refreshFeed();
    $$("#source-list .source-item").forEach(r => r.classList.remove("active"));
    $$("#source-list .folder-row.active").forEach(r => r.classList.remove("active"));
    row.classList.add("active");
  }

  function onFolderTitleClick(ev) {
    // CR-260523-1501-001: clicking a Group/Subgroup title scopes the feed
    // to articles whose source belongs to that folder's subtree. Clicking
    // the active title again clears the scope.
    ev.stopPropagation();
    const nameEl = ev.currentTarget;
    const row = nameEl.closest(".folder-row");
    if (!row) return;
    const id = nameEl.getAttribute("data-folder-id");
    const name = (row.getAttribute("data-folder-name") || "").trim();
    const isActive = row.classList.contains("active");
    if (isActive) {
      state.scopeFolderId = null;
      state.scopeFolderName = null;
    } else {
      state.scopeFolderId = id;
      state.scopeFolderName = name;
      state.activeSourceId = null;
    }
    $$("#source-list .source-item").forEach(r => r.classList.remove("active"));
    $$("#source-list .folder-row.active").forEach(r => r.classList.remove("active"));
    if (state.scopeFolderId) {
      row.classList.add("active");
    } else {
      const all = $("#source-list .source-item.all-sources");
      if (all) all.classList.add("active");
    }
    refreshFeed();
  }

  // ----- add-source modal -----

  function openAddSourceModal() {
    const modal = $("#add-source-modal");
    modal.hidden = false;
    const input = $("#add-source-url");
    input.value = "";
    $("#add-source-error").hidden = true;
    setTimeout(() => input.focus(), 0);
  }

  function closeAddSourceModal() {
    $("#add-source-modal").hidden = true;
    toggleSubmitSpinner(false);
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
    $("#row-menu").hidden = true;
    state.menuOpenFor = null;
    state.overRow = false;
    state.overMenu = false;
    cancelMenuClose();
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
      // Articles have no rename/mute/remove in MVP; menu items are decorative.
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

  function confirmFolderRemove(row, id) {
    const name = row.getAttribute("data-folder-name") || "folder";
    const modal = $("#confirm-modal");
    $("#confirm-message").textContent =
      "Remove folder " + name + "? Its sub-folders will be deleted and its sources will move to Ungrouped.";
    modal.hidden = false;
    const cleanup = () => {
      modal.hidden = true;
      $("#confirm-cancel").onclick = null;
      $("#confirm-ok").onclick = null;
    };
    $("#confirm-cancel").onclick = cleanup;
    $("#confirm-ok").onclick = async () => {
      cleanup();
      try {
        await api("/folders/" + id, { method: "DELETE" });
        await refreshSidebar();
        await refreshFeed();
        showToast("Removed.");
      } catch (e) {
        showToast("Remove failed.", "error");
      }
    };
  }

  // ----- rename inline -----

  function startRename(row) {
    const nameEl = row.querySelector(".source-name");
    if (!nameEl) return;
    const id = row.getAttribute("data-source-id");
    const original = nameEl.textContent;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "source-name-input";
    input.value = original;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const restore = (label) => {
      const span = document.createElement("span");
      span.className = "source-name";
      span.textContent = label;
      input.replaceWith(span);
    };

    const save = async () => {
      const newLabel = input.value.trim();
      if (!newLabel || newLabel === original) {
        restore(original);
        return;
      }
      try {
        await api("/sources/" + id, {
          method: "PATCH",
          body: { display_name: newLabel },
        });
        await refreshSidebar();
        showToast("Renamed.");
      } catch (e) {
        restore(original);
        showToast("Rename failed.", "error");
      }
    };

    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); save(); }
      else if (ev.key === "Escape") { ev.preventDefault(); restore(original); }
    });
    input.addEventListener("blur", () => save());
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
    const modal = $("#confirm-modal");
    $("#confirm-message").textContent =
      "Remove " + name + "? This will delete the source and all its articles.";
    modal.hidden = false;

    const cleanup = () => {
      modal.hidden = true;
      $("#confirm-cancel").onclick = null;
      $("#confirm-ok").onclick = null;
    };
    $("#confirm-cancel").onclick = cleanup;
    $("#confirm-ok").onclick = async () => {
      cleanup();
      try {
        await api("/sources/" + id, { method: "DELETE" });
        if (state.activeSourceId === id) {
          state.activeSourceId = null;
          state.page = 1;
        }
        await refreshSidebar();
        await refreshFeed();
        showToast("Removed.");
      } catch (e) {
        showToast("Remove failed.", "error");
      }
    };
  }

  // ----- feed pane -----

  function bindFeed() {
    bindArticleRows();
    const refresh = $("#refresh-btn");
    if (refresh) {
      refresh.addEventListener("click", onManualRefresh);
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
    const id = article.getAttribute("data-article-id");
    const url = article.getAttribute("data-url");
    if (!url) return;
    window.open(url, "_blank", "noopener");
    article.classList.add("read");
    const badge = article.querySelector(".badge-new");
    if (badge) badge.remove();
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
      await refreshSidebar();
      await refreshFeed();
      if (result && typeof result.last_sync === "string") {
        const el = $("#last-sync-label");
        if (el) el.textContent = "Last sync · " + result.last_sync;
      } else {
        updateLastSyncLabel();
      }
      setRefreshButtonState("done");
      showToast("Refresh complete.");
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
        clickTimer = setTimeout(() => {
          clickTimer = null;
          onFolderTitleClick({ currentTarget: nameEl, stopPropagation: () => {} });
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
    const original = nameEl.textContent.trim();
    const input = document.createElement("input");
    input.type = "text";
    input.className = "folder-name-input";
    input.value = original;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const restore = (label) => {
      const span = document.createElement("span");
      span.className = "folder-name";
      span.setAttribute("data-folder-id", id);
      span.textContent = label;
      span.addEventListener("dblclick", (ev) => {
        ev.stopPropagation();
        startFolderRename(span);
      });
      input.replaceWith(span);
    };

    let done = false;
    const save = async () => {
      if (done) return;
      const newLabel = input.value.trim();
      if (!newLabel) {
        input.classList.add("error");
        input.focus();
        return;
      }
      if (newLabel === original) { done = true; restore(original); return; }
      done = true;
      try {
        await api("/folders/" + id, { method: "PATCH", body: { name: newLabel } });
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
    syncExactToggle();
    repaintFilterActive();
  }

  function repaintFilterActive() {
    const container = $("#filter-active");
    if (!container) return;
    container.innerHTML = "";
    const chips = [];

    if (state.scopeFolderId) {
      chips.push({
        kind: "scope",
        label: "Scope: " + (state.scopeFolderName || "folder"),
        onClear: () => {
          state.scopeFolderId = null;
          state.scopeFolderName = null;
          // Clear active state in the sidebar too.
          $$("#source-list .folder-row.active").forEach(r => r.classList.remove("active"));
          const all = $("#source-list .source-item.all-sources");
          if (all) all.classList.add("active");
          applyFilterChange();
        },
      });
    }
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
    clearAll.addEventListener("click", () => {
      // "Clear all" wipes filter bar; sidebar scope is kept (it has its own chip).
      state.filter.shortcut = null;
      state.filter.from = null;
      state.filter.to = null;
      state.filter.sourceIds = [];
      state.filter.folderIds = [];
      state.filter.keywords = [];
      applyFilterChange();
    });
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
    } catch (e) {
      state.filterTree = [];
      state.filterTreeNameById = {};
    }
  }

  function renderContentSelectList() {
    const list = $("#content-select-list");
    if (!list) return;
    list.innerHTML = "";
    if (!state.filterTree || state.filterTree.length === 0) {
      list.innerHTML = '<div class="content-select-empty">No sources to filter yet.</div>';
      return;
    }
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
      // Mark selected state.
      const selectedKey = node.kind === "folder"
        ? state.filter.folderIds.includes(node.id)
        : state.filter.sourceIds.includes(node.id);
      if (selectedKey) row.classList.add("is-selected");
      row.addEventListener("click", (ev) => {
        ev.stopPropagation();
        toggleContentSelectRow(node);
        // Re-render so selection visuals update; dropdown stays open
        // (AC-260523-1500-004).
        renderContentSelectList();
        repaintFilterBar();
      });
      list.appendChild(row);
    });
  }

  function toggleContentSelectRow(node) {
    if (node.kind === "folder") {
      const i = state.filter.folderIds.indexOf(node.id);
      if (i >= 0) state.filter.folderIds.splice(i, 1);
      else state.filter.folderIds.push(node.id);
    } else if (node.kind === "source") {
      const i = state.filter.sourceIds.indexOf(node.id);
      if (i >= 0) state.filter.sourceIds.splice(i, 1);
      else state.filter.sourceIds.push(node.id);
    }
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

  // ----- global -----

  document.addEventListener("click", (ev) => {
    if (state.menuOpenFor && !ev.target.closest("#row-menu") && !ev.target.closest(".row-action-btn")) {
      closeRowMenu();
    }
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      if (!$("#add-source-modal").hidden) closeAddSourceModal();
      if (!$("#confirm-modal").hidden) $("#confirm-cancel").click();
      if (state.menuOpenFor) closeRowMenu();
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
    bindFeed();
    bindFeedScroll();
    bindAddSourceForm();
    bindRowMenuHover();
    bindBanner();
    bindPaneSeparator();
    bindFilterBar();
    bindFilterPopoverDismiss();
    updateLastSyncLabel();
    startLastSyncPoll();
  }

  function startLastSyncPoll() {
    // Keeps the header label fresh between manual clicks and scheduled poll
    // cycles. Short interval so the 'N min ago' text never drifts visibly,
    // and so AC-260522-2030-009 (header re-renders after scheduled poll
    // completion) is observably satisfied without a websocket.
    setInterval(updateLastSyncLabel, LAST_SYNC_POLL_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
