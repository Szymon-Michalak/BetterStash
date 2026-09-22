BetterStash.createLayout = function (settings) {
  "use strict";
  const { text, isSinglePrPage, button, save } = BetterStash;

  const originalPositions = new WeakMap();

  function prepareStateLabel(row) {
    const cell = row.querySelector("td.state-column");
    if (!cell || !cell.firstElementChild) return;
    const wrapper = cell.firstElementChild;
    if (originalPositions.has(wrapper)) return;

    const leaf = [...wrapper.querySelectorAll("span, div")].find(
      (el) => el.children.length === 0 && text(el)
    );
    if (!leaf) return;

    originalPositions.set(wrapper, { parent: cell, next: wrapper.nextSibling });
    wrapper.classList.add("wip-sorter-state-badge", "details-item");
    leaf.classList.add("wip-sorter-state-text");
  }

  function placeStateLabel(wrapper, zen) {
    const original = originalPositions.get(wrapper);
    if (!original) return;
    const details = original.parent.closest("tr, li, [role='row']")?.querySelector(".details");
    const parent = zen && details ? details : original.parent;
    if (wrapper.parentElement === parent) return;
    const next = !zen && original.next?.parentNode === parent ? original.next : null;
    parent.insertBefore(wrapper, next);
  }

  function applyStateLabelPlacement() {
    const zen = !!settings.zenMode;
    document.querySelectorAll(".wip-sorter-state-badge").forEach((wrapper) => placeStateLabel(wrapper, zen));
  }

  function applyZenColumnCollapse() {
    const zen = !!settings.zenMode;
    document.querySelectorAll("table").forEach((table) => {
      const hasState = !!table.querySelector("td.state-column");
      const hasCommits = !!table.querySelector("td.new-commits-column");
      if (!hasState && !hasCommits) return;
      const th = table.querySelector("thead th.summary-column[colspan]");
      if (!th) return;
      if (!th.dataset.wipOrigColspan) th.dataset.wipOrigColspan = th.getAttribute("colspan") || "";
      const orig = parseInt(th.dataset.wipOrigColspan, 10);
      if (!orig) return;
      const hiddenCount = (hasState ? 1 : 0) + (hasCommits ? 1 : 0);
      th.setAttribute("colspan", zen ? String(Math.max(1, orig - hiddenCount)) : th.dataset.wipOrigColspan);
    });
  }

  function markNewCommitsIndicator(row) {
    const cell = row.querySelector("td.new-commits-column");
    const hasNewCommits = !!(cell && cell.querySelector(".new-commits-icon"));
    const avatar = row.querySelector("td.avatar-column .user-avatar") || row.querySelector("td.avatar-column");
    if (!avatar) return;
    avatar.classList.toggle("wip-sorter-has-new-commits", hasNewCommits);
    if (hasNewCommits) avatar.title = "New commits since your last review";
    else if (avatar.title === "New commits since your last review") avatar.removeAttribute("title");
  }

  const SIDE_PANEL_SELECTOR = ".side-panel";
  let zenToggleBtn = null;

  function setZenMode(enabled) {
    settings.zenMode = enabled;
    save({ zenMode: enabled });
    applyZenMode();
  }

  function buildZenToggle() {
    const btn = button("wip-sorter-zen-toggle", "🧘", "Toggle zen mode (Z)",
      () => setZenMode(!settings.zenMode));
    document.body.appendChild(btn);
    return btn;
  }

  function applyZenMode() {
    if (isSinglePrPage()) {
      if (zenToggleBtn) {
        zenToggleBtn.remove();
        zenToggleBtn = null;
      }
      return;
    }
    if (!document.querySelector(SIDE_PANEL_SELECTOR)) return;

    document.documentElement.classList.toggle("wip-sorter-zen", !!settings.zenMode);
    applyStateLabelPlacement();
    applyZenColumnCollapse();
    if (!zenToggleBtn || !zenToggleBtn.isConnected) zenToggleBtn = buildZenToggle();
    zenToggleBtn.classList.toggle("wip-sorter-zen-toggle-active", !!settings.zenMode);
    zenToggleBtn.setAttribute("aria-pressed", String(!!settings.zenMode));
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "z" && e.key !== "Z") return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (!document.querySelector(SIDE_PANEL_SELECTOR)) return;
    e.preventDefault();
    setZenMode(!settings.zenMode);
  });

  return { prepareStateLabel, markNewCommitsIndicator, applyZenMode,
    applyStateLabelPlacement, applyZenColumnCollapse };
};
