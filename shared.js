(function () {
  "use strict";

  const defaults = Object.freeze({
    sitePattern: "",
    identity: "",
    team: "",
    teamTint: true,
    teamIcon: false,
    pinTeam: false,
    expandReview: true,
    expandYours: false,
    expandClosed: false,
    tierBlocked: true,
    tierApproved: true,
    tierWip: true,
    dimRows: true,
    prBar: true,
    prBarOpacity: 50,
    prBarScope: "diff",
    imageFit: true,
    zenMode: false,
    collapsedTiers: Object.freeze({}),
  });

  function text(el) {
    return (el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function norm(s) {
    return String(s || "").normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  }

  // The sorter and zen mode only belong on the dashboard (not repo PR lists or single PRs).
  function isDashboardPage() {
    return /\/dashboard\/?$/.test(location.pathname);
  }

  function button(className, label, tooltip, onClick) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = className;
    element.textContent = label;
    element.dataset.tooltip = tooltip;
    element.setAttribute("aria-label", tooltip);
    element.addEventListener("click", onClick);
    return element;
  }

  function save(settings) {
    globalThis.chrome?.storage?.local?.set(settings);
  }

  globalThis.BetterStash = { defaults, text, norm, isDashboardPage, button, save };
})();
