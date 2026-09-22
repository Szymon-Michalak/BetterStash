(function () {
  "use strict";
  const { defaults, createDashboard, createLayout, createDiff } = BetterStash;
  const settings = { ...defaults };
  const layout = createLayout(settings);
  const dashboard = createDashboard(settings, layout);
  const diff = createDiff(settings);
  const storage = globalThis.chrome?.storage;
  let timer;
  let booted = false;

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        dashboard.refresh();
        diff.refresh();
        layout.applyZenMode();
        diff.annotateTabShortcuts();
      } catch (error) {
        console.error("[better-stash] Could not refresh page:", error);
      }
    }, 150);
  }

  const observer = new MutationObserver((mutations) => {
    const external = mutations.some(({ addedNodes }) =>
      !addedNodes.length || ![...addedNodes].every((node) =>
        node.nodeType === 1 && /wip-sorter-/.test(node.className)));
    if (external) schedule();
  });

  function boot(saved = {}) {
    if (booted) return;
    booted = true;
    Object.assign(settings, saved);
    dashboard.configure();
    layout.applyZenMode();
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();
  }

  if (!storage?.local) return boot();
  storage.local.get(defaults, (saved) => {
    if (chrome.runtime.lastError) console.warn("[better-stash]", chrome.runtime.lastError.message);
    boot(saved);
  });
  setTimeout(boot, 1500); // Start with defaults if storage never answers.
  storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const keys = Object.keys(changes).filter((key) => key in defaults && key !== "sitePattern");
    if (!keys.length) return;
    for (const key of keys) settings[key] = changes[key].newValue ?? defaults[key];
    if (keys.every((key) => key === "collapsedTiers" || key === "zenMode")) {
      dashboard.applyTierCollapsed();
      layout.applyZenMode();
      return;
    }
    dashboard.configure();
    dashboard.reset();
    schedule();
  });
})();
