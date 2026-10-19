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

  const DIFF_TAB_PATH = /\/pull-requests\/\d+\/(diff(\/|$)|commits\/[0-9a-f]+)/i;
  const PR_PATH = /\/pull-requests\/\d+(\/|$)/;
  const PANE_SELECTOR = ".pull-request-tabs .tabs-pane.active-pane > div";
  const PANE_BOTTOM_GAP = 3;

  // The PR header is only restyled (never moved) because Bitbucket's React tree owns those nodes.
  // Bitbucket sizes the diff pane with an inline "100vh - header height"; once the header leaves the
  // flow we recompute it from where the pane actually starts.
  // The task summary ("No open tasks" / "3 open tasks") is an unknown Atlaskit node, so find it by text and
  // tag the flex item that wraps it; the card hides it when there is nothing open.
  function tagTaskSummary() {
    const header = document.querySelector("header.pull-request-header");
    if (!header) return;
    const wrappers = new Set(["pull-request-header-bar", "pull-request-actions", "pull-request-metadata"]);
    header.querySelectorAll("*").forEach((el) => {
      if (el.children.length || !/\btasks?\s*$/i.test(el.textContent.trim()) || el.closest("h2")) return;
      let item = el;
      while (item.parentElement && item.parentElement !== header && ![...wrappers].some((c) => item.parentElement.classList.contains(c))) {
        item = item.parentElement;
      }
      item.classList.add("wip-sorter-tasks");
      item.classList.toggle("wip-sorter-tasks-none", /^no\b/i.test(el.textContent.trim()));
    });
  }

  function refreshPrBar() {
    const root = document.documentElement;
    const onDiff = DIFF_TAB_PATH.test(location.pathname);
    const pathOk = settings.prBarScope === "all" ? PR_PATH.test(location.pathname) : onDiff;
    const active = settings.prBar && pathOk && !!document.querySelector("header.pull-request-header");
    root.classList.toggle("wip-sorter-prbar", active);
    root.classList.toggle("wip-sorter-prbar-diff", active && onDiff);
    if (active) {
      tagTaskSummary();
      const section = document.querySelector(".pull-request-title-review-section");
      const title = section?.querySelector("h2")?.textContent.trim();
      if (section && title && section.dataset.wipTitle !== title) section.dataset.wipTitle = title;
    }
    const percent = Math.min(100, Math.max(20, Number(settings.prBarOpacity) || 50));
    root.style.setProperty("--wip-sorter-prbar-opacity", String(percent / 100));
    const pane = active && onDiff && document.querySelector(PANE_SELECTOR);
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
    if (!active) {
      wantedZoom = 1;
      resetZoom();
      return root.style.removeProperty("--wip-sorter-diff-h");
    }
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

  // Zoom buttons (under the mode switcher): 1x is the fitted size; 2x/3x multiply every image's fitted width.
  // The existing diff scroller pans, so Old and New move together.
  const ZOOM_TARGETS = ".diff-image img, .diff-image canvas";
  const ZOOM_LEVELS = [1, 2, 3];
  let drag = null;
  let wantedZoom = 1; // survives mode switches, which replace the images

  const zoomTargets = () => [...document.querySelectorAll(ZOOM_TARGETS)];
  const zoomedElements = () => [...document.querySelectorAll(".diff-image .wip-sorter-zoomed")];

  function scrollerOf(el) {
    for (let node = el.parentElement; node; node = node.parentElement) {
      const { overflowX, overflowY } = getComputedStyle(node);
      if (/(auto|scroll)/.test(overflowX + overflowY) && (node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight)) return node;
    }
    return document.scrollingElement;
  }

  function resetZoom() {
    zoomedElements().forEach((el) => {
      el.classList.remove("wip-sorter-zoomed");
      el.style.removeProperty("width");
    });
    document.documentElement.classList.remove("wip-sorter-zoom-on");
    document.querySelectorAll(".wip-sorter-zoom-scroller").forEach((el) => el.classList.remove("wip-sorter-zoom-scroller"));
  }

  function applyZoom(factor) {
    if (factor <= 1) return resetZoom();
    const first = zoomTargets()[0];
    if (!first) return;
    const scroller = scrollerOf(first);
    if (scroller && scroller !== document.scrollingElement) scroller.classList.add("wip-sorter-zoom-scroller");
    const before = first.getBoundingClientRect();
    const view = scroller && scroller.getBoundingClientRect();
    const fx = view && before.width ? (view.left + view.width / 2 - before.left) / before.width : 0.5;
    const fy = view && before.height ? (view.top + view.height / 2 - before.top) / before.height : 0.5;
    const fitWidths = zoomTargets().map((el) =>
      el.classList.contains("wip-sorter-zoomed") ? Number(el.dataset.wipFitWidth) : el.getBoundingClientRect().width);
    document.documentElement.classList.add("wip-sorter-zoom-on");
    zoomTargets().forEach((el, i) => {
      el.dataset.wipFitWidth = String(fitWidths[i]);
      el.classList.add("wip-sorter-zoomed");
      if (fitWidths[i]) el.style.width = `${fitWidths[i] * factor}px`;
    });
    const scrolled = scrollerOf(first) || scroller;
    if (!scrolled) return;
    const after = first.getBoundingClientRect();
    const box = scrolled.getBoundingClientRect();
    scrolled.scrollLeft += after.left + fx * after.width - (box.left + box.width / 2);
    scrolled.scrollTop += after.top + fy * after.height - (box.top + box.height / 2);
  }

  function syncZoomControl(bar) {
    bar.dataset.zoom = String(wantedZoom);
    const current = Number(bar.dataset.zoom) || 1;
    bar.querySelectorAll("button").forEach((btn) =>
      btn.classList.toggle("wip-sorter-zoom-active", Number(btn.dataset.zoomLevel) === current));
  }

  function ensureZoomControl() {
    const diffImage = document.querySelector(".diff-image");
    if (!diffImage) return;
    let bar = diffImage.querySelector(":scope > .wip-sorter-zoom-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "wip-sorter-zoom-bar";
      bar.setAttribute("role", "group");
      bar.setAttribute("aria-label", "Zoom image diff");
      ZOOM_LEVELS.forEach((level) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.dataset.zoomLevel = String(level);
        btn.textContent = `${level}x`;
        btn.title = level === 1 ? "Fit to screen" : `Zoom to ${level}x the fitted size (click again to reset)`;
        btn.addEventListener("click", () => {
          wantedZoom = wantedZoom === level ? 1 : level;
          applyZoom(wantedZoom);
          syncZoomControl(bar);
        });
        bar.appendChild(btn);
      });
    }
    // Sticky positioning keys off where the element sits in flow, so it must directly precede the toolbar.
    const toolbar = diffImage.querySelector(":scope > .diff-modes-buttons");
    if (toolbar && bar.nextElementSibling !== toolbar) toolbar.before(bar);
    else if (!toolbar && diffImage.firstElementChild !== bar) diffImage.prepend(bar);
    const targets = zoomTargets();
    if (wantedZoom > 1 && targets.length && targets.some((el) => !el.classList.contains("wip-sorter-zoomed"))) {
      resetZoom();
      applyZoom(wantedZoom);
    }
    syncZoomControl(bar);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !zoomedElements().length) return;
    wantedZoom = 1;
    resetZoom();
    ensureZoomControl();
  });

  document.addEventListener("mousedown", (event) => {
    const target = event.target;
    if (event.button !== 0 || !(target instanceof Element) || !target.classList.contains("wip-sorter-zoomed")) return;
    event.preventDefault();
    const scroller = scrollerOf(target);
    if (!scroller) return;
    drag = { scroller, x: event.clientX, y: event.clientY, left: scroller.scrollLeft, top: scroller.scrollTop };
    document.documentElement.classList.add("wip-sorter-panning");
  });

  document.addEventListener("mousemove", (event) => {
    if (!drag) return;
    drag.scroller.scrollLeft = drag.left - (event.clientX - drag.x);
    drag.scroller.scrollTop = drag.top - (event.clientY - drag.y);
  });

  document.addEventListener("mouseup", () => {
    drag = null;
    document.documentElement.classList.remove("wip-sorter-panning");
  });

  function refresh() {
    markActiveMode();
    ensureZoomControl();
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
