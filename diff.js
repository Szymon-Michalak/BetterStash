BetterStash.createDiff = function (settings) {
  "use strict";
  const { text, isSinglePrPage, button } = BetterStash;

  const FILE_LINK_SELECTOR = "ol.files li.file > a[href^='#']";
  let fileNav = null;

  function buildFileNavBar() {
    const bar = document.createElement("div");
    bar.className = "wip-sorter-filenav";
    const navButton = (label, tooltip, action) =>
      button("wip-sorter-filenav-btn", label, tooltip, action);
    const prev = navButton("◀", "Previous file (k)", () => stepFile(-1));
    const next = navButton("▶", "Next file (j)", () => stepFile(1));
    const collapseAll = navButton("⊟", "Collapse all folders", () => setAllDirectories(false));
    const expandAll = navButton("⊞", "Expand all folders", () => setAllDirectories(true));
    const label = document.createElement("span");
    label.className = "wip-sorter-filenav-label";
    const divider = document.createElement("span");
    divider.className = "wip-sorter-filenav-divider";

    bar.append(prev, label, next, divider, collapseAll, expandAll);
    document.body.appendChild(bar);
    return bar;
  }

  const DIRECTORY_BUTTON_SELECTOR = "li.directory > button.directory-label";

  function isDirectoryOpen(btn) {
    return !!btn.querySelector(".icon-folder-opened");
  }

  function directoryDepth(btn) {
    let depth = 0;
    for (let el = btn.parentElement; el; el = el.parentElement) {
      if (el.matches && el.matches("li.directory")) depth++;
    }
    return depth;
  }

  function setAllDirectories(open, passesLeft = 15, onDone) {
    const btns = [...document.querySelectorAll(DIRECTORY_BUTTON_SELECTOR)].filter(
      (btn) => isDirectoryOpen(btn) !== open
    );
    if (!btns.length || passesLeft <= 0) {
      if (onDone) onDone();
      return;
    }

    // Close children first; opening parents reveals more directories for the next pass.
    if (!open) {
      btns.sort((a, b) => directoryDepth(b) - directoryDepth(a));
      btns.forEach((btn) => btn.click());
      if (onDone) onDone();
      return;
    }

    btns.forEach((btn) => btn.click());
    setTimeout(() => setAllDirectories(open, passesLeft - 1, onDone), 30);
  }

  function updateFileNavUI() {
    if (!fileNav) return;
    const { links, index, bar } = fileNav;
    links.forEach((l, i) => l.classList.toggle("wip-sorter-filenav-active", i === index));
    const label = bar.querySelector(".wip-sorter-filenav-label");
    const current = links[index];
    const name = current && current.querySelector(".file-label");
    const value = links.length ? `${index + 1} / ${links.length}${name ? " — " + text(name) : ""}` : "";
    if (label.textContent !== value) label.textContent = value;
  }

  function stepFile(delta) {
    if (!fileNav || !fileNav.links.length) return;
    const navigation = fileNav;
    const currentLink = fileNav.links[fileNav.index];
    setAllDirectories(true, 15, () => {
      if (fileNav !== navigation) return;
      const links = [...document.querySelectorAll(FILE_LINK_SELECTOR)];
      if (!links.length) return;
      let idx = currentLink ? links.indexOf(currentLink) : -1;
      if (idx === -1) idx = Math.min(fileNav.index, links.length - 1);
      idx = (idx + delta + links.length) % links.length;
      fileNav.links = links;
      fileNav.index = idx;
      const link = links[idx];
      link.click();
      link.scrollIntoView({ block: "nearest" });
      updateFileNavUI();
    });
  }

  function teardownFileNav() {
    if (!fileNav) return;
    if (fileNavObserver) fileNavObserver.disconnect();
    fileNav.bar.remove();
    fileNav = null;
  }

  let fileNavObserver = null;

  function setupScrollSpy(links) {
    if (fileNavObserver) fileNavObserver.disconnect();
    const targets = links.map((l) => {
      const id = l.getAttribute("href").slice(1);
      return id ? document.getElementById(id) : null;
    });
    if (!targets.some(Boolean)) return;

    fileNavObserver = new IntersectionObserver(
      (entries) => {
        if (!fileNav) return;
        const visible = entries.filter((en) => en.isIntersecting);
        if (!visible.length) return;
        visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const idx = targets.indexOf(visible[0].target);
        if (idx !== -1 && idx !== fileNav.index) {
          fileNav.index = idx;
          updateFileNavUI();
        }
      },
      { rootMargin: "-10% 0px -70% 0px", threshold: 0 }
    );
    targets.forEach((t) => t && fileNavObserver.observe(t));
  }

  function refreshFileNav() {
    if (!settings.fileNav || !isSinglePrPage()) return teardownFileNav();

    const links = [...document.querySelectorAll(FILE_LINK_SELECTOR)];
    if (!links.length) return teardownFileNav();

    links.forEach((link) => {
      if (link.dataset.wipFilenavBound) return;
      link.dataset.wipFilenavBound = "1";
      link.addEventListener("click", () => {
        if (!fileNav) return;
        fileNav.index = fileNav.links.indexOf(link);
        updateFileNavUI();
      });
    });

    if (!fileNav) fileNav = { links, index: 0, bar: buildFileNavBar() };
    else {
      fileNav.links = links;
      if (fileNav.index >= links.length) fileNav.index = links.length - 1;
    }
    setupScrollSpy(links);
    updateFileNavUI();
  }

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

  return { refresh: refreshFileNav, annotateTabShortcuts };
};
