BetterStash.createDiff = function (settings) {
  "use strict";

  const TAB_MENU_LINK_SELECTOR = "ul.tabs-menu > li[data-testid^='tab-'] > a";
  const TAB_HINT_KEYCAPS = ["1\uFE0F\u20E3", "2\uFE0F\u20E3", "3\uFE0F\u20E3", "4\uFE0F\u20E3"];

  function annotateTabShortcuts() {
    document.querySelectorAll(TAB_MENU_LINK_SELECTOR).forEach((a, i) => {
      if (i > 8 || a.querySelector(".wip-sorter-tab-hint")) return;
      const hint = document.createElement("span");
      hint.className = "wip-sorter-tab-hint";
      hint.textContent = TAB_HINT_KEYCAPS[i] || `(${i + 1})`;
      (a.querySelector("strong") || a).appendChild(hint);
    });
  }

  const DIFF_TAB_PATH = /\/pull-requests\/\d+\/diff(\/|$)/;
  const PANE_SELECTOR = ".pull-request-tabs .tabs-pane.active-pane > div";
  const PANE_BOTTOM_GAP = 3;

  // The PR header is only restyled (never moved) because Bitbucket's React tree owns those nodes.
  // Bitbucket sizes the diff pane with an inline "100vh - header height"; once the header leaves the
  // flow we recompute it from where the pane actually starts.
  function refreshPrBar() {
    const root = document.documentElement;
    const active =
      settings.prBar && DIFF_TAB_PATH.test(location.pathname) && !!document.querySelector("header.pull-request-header");
    root.classList.toggle("wip-sorter-prbar", active);
    const percent = Math.min(100, Math.max(20, Number(settings.prBarOpacity) || 50));
    root.style.setProperty("--wip-sorter-prbar-opacity", String(percent / 100));
    const pane = active && document.querySelector(PANE_SELECTOR);
    if (!pane) return root.style.removeProperty("--wip-sorter-pane-top");
    const top = Math.round(pane.getBoundingClientRect().top + window.scrollY);
    root.style.setProperty("--wip-sorter-pane-top", `${top + PANE_BOTTOM_GAP}px`);
  }

  // Image diffs (snapshots) are often far taller than the screen. Cap each image at the height of the
  // visible diff area so the whole picture fits without scrolling.
  function refreshImageFit() {
    const root = document.documentElement;
    const view = document.querySelector(".diff-view");
    const active = settings.imageFit && DIFF_TAB_PATH.test(location.pathname) && !!view?.querySelector(".diff-image");
    root.classList.toggle("wip-sorter-imgfit", active);
    if (!active) return root.style.removeProperty("--wip-sorter-diff-h");
    const rect = view.getBoundingClientRect();
    const height = Math.round(Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    if (height > 0) root.style.setProperty("--wip-sorter-diff-h", `${height}px`);
  }

  // Bitbucket's classes are hashed, so the selected mode is the one button whose class differs from the rest.
  function markActiveMode() {
    const bar = document.querySelector(".diff-image .diff-modes-buttons");
    if (!bar) return;
    const buttons = [...bar.querySelectorAll("button")];
    const counts = new Map();
    buttons.forEach((b) => counts.set(b.className, (counts.get(b.className) || 0) + 1));
    const active = buttons.length > 2 ? buttons.filter((b) => counts.get(b.className) === 1) : [];
    const holder = active.length === 1 ? active[0].closest(".diff-modes-buttons > span") : null;
    bar.querySelectorAll(":scope > span").forEach((s) => s.classList.toggle("wip-sorter-mode-active", s === holder));
    bar.classList.toggle("wip-sorter-modes-collapsible", !!holder);
  }

  function refresh() {
    markActiveMode();
    refreshPrBar();
    refreshImageFit();
  }

  window.addEventListener("resize", refresh);
  document.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest(".diff-image .diff-modes-buttons")) {
      setTimeout(markActiveMode, 50);
    }
  });
  document.addEventListener("load", (event) => {
    if (event.target instanceof HTMLImageElement && event.target.closest(".diff-image")) refresh();
  }, true);

  return { refresh, annotateTabShortcuts };
};
