(function () {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const state = {
    activeSourceId: null,
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
    const url = "/sidebar-partial" + (state.activeSourceId ? "?active=" + encodeURIComponent(state.activeSourceId) : "");
    const html = await api(url);
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

  async function refreshFeed() {
    // Full reload — replaces the whole feed pane (header + first batch).
    // Resets the scroll cursor.
    const params = new URLSearchParams();
    if (state.activeSourceId) params.set("source", state.activeSourceId);
    params.set("size", state.pageSize);
    const html = await api("/feed-partial?" + params.toString());
    $("#feed-pane").innerHTML = html;
    readFeedCursor();
    bindFeed();
    bindBanner();
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
      const params = new URLSearchParams();
      if (state.activeSourceId) params.set("source", state.activeSourceId);
      params.set("size", state.pageSize);
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
    refreshFeed();
    $$("#source-list .source-item").forEach(r => r.classList.remove("active"));
    row.classList.add("active");
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
    menu.hidden = false;
    const rect = anchor.getBoundingClientRect();
    // Overlap the spawning row by 2 px so cursor never enters a true "gap";
    // the .row-menu::before bridge covers the remaining traversal.
    menu.style.top = (window.scrollY + rect.bottom - 2) + "px";
    menu.style.left = (window.scrollX + rect.left - 100) + "px";
    state.menuOpenFor = row;
    state.overRow = true;
    state.overMenu = false;
    cancelMenuClose();

    menu.querySelectorAll(".row-menu-item").forEach(item => {
      item.onclick = async (ev) => {
        ev.stopPropagation();
        const action = item.getAttribute("data-action");
        closeRowMenu();
        await handleRowAction(row, action);
      };
    });
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
      return;
    }
    const id = row.getAttribute("data-source-id");
    if (action === "rename") return startRename(row);
    if (action === "mute") return toggleMute(row, id);
    if (action === "remove") return confirmRemove(row, id);
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
    });
  }

  async function onArticleClick(ev) {
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
    // Double-click on a folder name → inline rename.
    $$("#source-list .folder-name").forEach(nameEl => {
      nameEl.addEventListener("dblclick", (ev) => {
        ev.stopPropagation();
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

  let drag = null;  // { kind, id, originRow, currentGroupId, currentSubgroupId }
  let dropPlan = null;

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
  }

  function rowContentX(row) {
    // Use the row's .folder-name (or .source-name) left edge as the
    // content-start. This is the indent baseline against which X-offset is
    // measured.
    const inner = row.querySelector(".folder-name, .source-name");
    if (!inner) return row.getBoundingClientRect().left + 16;
    return inner.getBoundingClientRect().left;
  }

  const MAX_DEPTH = 5;

  function computeDropPlan(target, x, y) {
    // target is a .folder-row, .source-item, or .ungrouped-zone.
    if (!target || !drag) return null;

    if (target.classList.contains("ungrouped-zone")) {
      if (drag.kind !== "source") return null;
      return { kind: "into-ungrouped", target };
    }

    const rect = target.getBoundingClientRect();
    const half = rect.top + rect.height / 2;
    const above = y < half;
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
        endpoint = "/sources/" + drag.id + "/parent";
        body = { folder_id: null };
      }

      if (endpoint && body) {
        await api(endpoint, { method: "PATCH", body });
        await refreshSidebar();
      }
    } catch (e) {
      const msg = (e.detail && e.detail.message) || "Move failed.";
      showToast(msg, "error");
    }
    onDragEnd();
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
