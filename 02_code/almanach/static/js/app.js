(function () {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const state = {
    activeSourceId: null,
    page: 1,
    pageSize: 50,
    menuOpenFor: null,
    menuHoverTimer: null,
  };

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
    const opts = Object.assign({ headers: {} }, options || {});
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
  }

  async function refreshFeed() {
    const params = new URLSearchParams();
    if (state.activeSourceId) params.set("source", state.activeSourceId);
    params.set("page", state.page);
    params.set("size", state.pageSize);
    const html = await api("/feed-partial?" + params.toString());
    $("#feed-pane").innerHTML = html;
    bindFeed();
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
      row.addEventListener("mouseleave", () => {
        if (state.menuOpenFor === row) {
          clearTimeout(state.menuHoverTimer);
          state.menuHoverTimer = setTimeout(() => closeRowMenu(), 320);
        }
      });
      row.addEventListener("mouseenter", () => {
        if (state.menuOpenFor === row) clearTimeout(state.menuHoverTimer);
      });
    });
  }

  function onRowClick(ev) {
    if (ev.target.closest(".row-action-btn")) return;
    if (ev.target.closest(".source-name-input")) return;
    const row = ev.currentTarget;
    if (row.classList.contains("muted")) return;
    const id = row.getAttribute("data-source-id");
    state.activeSourceId = id || null;
    state.page = 1;
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
    menu.hidden = false;
    const rect = anchor.getBoundingClientRect();
    menu.style.top = (window.scrollY + rect.bottom + 4) + "px";
    menu.style.left = (window.scrollX + rect.left - 100) + "px";
    state.menuOpenFor = row;

    menu.querySelectorAll(".row-menu-item").forEach(item => {
      item.onclick = async () => {
        const action = item.getAttribute("data-action");
        closeRowMenu();
        await handleRowAction(row, action);
      };
    });
  }

  function closeRowMenu() {
    $("#row-menu").hidden = true;
    state.menuOpenFor = null;
  }

  async function handleRowAction(row, action) {
    const id = row.getAttribute("data-source-id");
    if (action === "rename") return startRename(row);
    if (action === "mute") return toggleMute(row, id);
    if (action === "remove") return confirmRemove(row, id);
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
        state.page = 1;
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
    $$("#feed-pane .article").forEach(art => {
      art.addEventListener("click", onArticleClick);
    });
    $$("#feed-pane .pagination .btn[data-page]").forEach(btn => {
      btn.addEventListener("click", () => {
        state.page = parseInt(btn.getAttribute("data-page"), 10) || 1;
        refreshFeed().then(() => {
          $("#feed-pane").scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });
    });
    const refresh = $("#refresh-btn");
    if (refresh) {
      refresh.addEventListener("click", onManualRefresh);
    }
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
    try {
      await api("/refresh", { method: "POST" });
      showToast("Refresh started.");
      setTimeout(async () => {
        await refreshSidebar();
        await refreshFeed();
      }, 1500);
    } catch (e) {
      showToast("Refresh failed.", "error");
    }
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
    bindSidebar();
    bindFeed();
    bindAddSourceForm();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
