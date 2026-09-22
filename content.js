// BetterStash — content script (UI-driven only, no network calls)
//
// Splits pull request lists into tiers, in this order below the main list:
//   1. Blocked           — merge conflict or failed build
//   2. Approved by me    — my reviewer avatar carries an "approved" badge
//   3. Work in progress  — title matches WIP_PATTERN
// Everything else stays in the original list ("needs my review").
// Rows under "Your pull requests" are never touched.

(function () {
  "use strict";
  console.info("[better-stash] content script loaded on", location.href);

  // ---- Configuration ------------------------------------------------------

  const WIP_PATTERN = /(^|[\s\[\(])(wip|draft|do not merge)([\s\]\):\-]|$)/i;

  // Settings live in chrome.storage.local (see options.html). These are defaults.
  const SETTINGS = {
    identity: "",
    team: "",
    teamTint: true,      // subtle row background tint
    teamIcon: false,     // small badge after the author name
    pinTeam: false,
    expandReview: true,
    expandYours: false,
    expandClosed: false,
    tierBlocked: true,
    tierApproved: true,
    tierWip: true,
    dimRows: true,
    fileNav: true,   // prev/next file navigation on the PR diff tab
    zenMode: false,  // dashboard: hide sidebar, widen main panel, dim header
    collapsedTiers: {}, // { [tierId]: boolean } — persisted, not exposed in options
  };
  let MY_IDENTITY = [];
  let TEAM = [];
  let identity = null;

  function applySettings(s) {
    Object.assign(SETTINGS, s);
    MY_IDENTITY = String(SETTINGS.identity || "").split(",").map((x) => x.trim()).filter(Boolean);
    TEAM = String(SETTINGS.team || "").split(",").map(norm).filter(Boolean);
    console.info("[better-stash] settings:", { identity: MY_IDENTITY, team: TEAM, tint: SETTINGS.teamTint, badge: SETTINGS.teamIcon, pin: SETTINGS.pinTeam });
    identity = null; // force re-detect
    document.documentElement.classList.toggle("wip-sorter-no-dim", !SETTINGS.dimRows);
    document.documentElement.classList.toggle("wip-sorter-team-tint", !!SETTINGS.teamTint);
    applyZenMode();
  }

  const SHOW_MORE_PATTERN = /^\s*show more pull requests\s*$/i;
  const MAX_EXPAND_CLICKS = 20;

  // Lists under a heading matching this are left completely untouched.
  const SKIP_SECTION_PATTERN = /^(your pull requests|recently closed)/i;

  // Rows showing one of these state lozenges are also left untouched.
  const CLOSED_STATE_PATTERN = /^\s*(merged|declined)\s*$/i;

  // Reviewer avatar element (matches <span role="img" aria-label="Name"
  // data-testid="reviewer-avatar--image">).
  const REVIEWER_AVATAR_SELECTOR =
    "[data-testid='reviewer-avatar--image'], [data-testid*='reviewer'][aria-label], [data-testid*='avatar'][aria-label]";

  const PR_LINK_SELECTOR = 'a[href*="/pull-requests/"]';
  const MARK = "data-wip-tier";

  // A single PR's own page (overview/diff/commits/…), as opposed to a
  // dashboard/list page. Tab links, comment links, etc. on this page also
  // match PR_LINK_SELECTOR, so tiering must never run here.
  const SINGLE_PR_PATH = /\/pull-requests\/\d+(\/|$)/;
  function isSinglePrPage() {
    return SINGLE_PR_PATH.test(location.pathname);
  }

  const TIERS = [
    { id: "blocked",  label: "Blocked" },
    { id: "approved", label: "Approved by me" },
    { id: "wip",      label: "Work in progress" },
  ];

  // ---- Generic helpers ----------------------------------------------------

  function text(el) {
    return (el && el.textContent ? el.textContent : "").replace(/\s+/g, " ").trim();
  }

  // Unicode-normalised, lower-cased, whitespace-collapsed — safe for name comparison.
  function norm(s) {
    return String(s || "").normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function findRow(link) {
    return (
      link.closest("tr, li, [role='row']") ||
      link.closest("[class*='pull-request'], [class*='PullRequest']") ||
      link.parentElement
    );
  }

  function titleOf(link) {
    return (link.getAttribute("title") || link.textContent || "").trim();
  }

  // ---- Section detection --------------------------------------------------

  // Title of the dashboard section a row belongs to, e.g. "Your pull requests (4)".
  function sectionTitleFor(row) {
    let node = row;
    for (let depth = 0; node && depth < 12; depth++) {
      let sib = node.previousElementSibling;
      while (sib) {
        const t = text(sib);
        if (/pull requests/i.test(t) && (/^H[1-6]$/.test(sib.tagName) || sib.children.length < 10)) {
          return t;
        }
        sib = sib.previousElementSibling;
      }
      if (node.querySelector) {
        const h = [...node.querySelectorAll("h1, h2, h3, h4, h5, h6")].find(
          (x) => !x.contains(row) && /pull requests/i.test(text(x)) &&
                 (x.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING)
        );
        if (h) return text(h);
      }
      node = node.parentElement;
    }
    return "";
  }

  // ---- Current user (derived from the page, no REST) ----------------------

  function detectIdentity() {
    if (identity && identity.length) return identity;
    const ids = new Set(MY_IDENTITY.map(norm));

    // The author of anything under "Your pull requests" is the current user.
    // Author line looks like "Taylor Morgan - #596 project / repo".
    document.querySelectorAll(PR_LINK_SELECTOR).forEach((link) => {
      const row = findRow(link);
      if (!row || !/^your pull requests/i.test(sectionTitleFor(row))) return;
      const a = authorOf(row, link);
      if (a) ids.add(norm(a));
    });

    // Secondary sources.
    ["current-user", "bb-current-user", "ajs-remote-user-fullname", "ajs-remote-user"].forEach((n) => {
      const meta = document.querySelector(`meta[name="${n}"]`);
      if (meta && meta.content) ids.add(meta.content.trim().toLowerCase());
    });

    ["", "user", "profile", "avatar", "menu"].forEach((x) => ids.delete(x));
    identity = [...ids];
    if (identity.length) console.info("[better-stash] current user:", identity);
    return identity;
  }

  function mentionsMe(el) {
    const me = detectIdentity();
    if (!me.length) return false;
    const fields = ["aria-label", "alt", "title", "data-username", "href"]
      .map((a) => el.getAttribute(a))
      .filter(Boolean)
      .map(norm);
    return fields.some((f) => me.some((id) => f === id || f.includes(id)));
  }

  // ---- Team badge ---------------------------------------------------------

  // Any dash variant, e.g. "Name - #2940", "Name – #2940".
  const AUTHOR_LINE = /^\s*(.+?)\s*[-\u2013\u2014]\s*#\d+/;

  function authorOf(row, link) {
    // 0) Classic Stash markup: <span class="user-name">Name</span>
    const userName = row.querySelector(".user-name, [class*='user-name'], [class*='author']");
    if (userName && text(userName)) return text(userName);
    // 1) Explicit user link inside the row.
    const userLink = [...row.querySelectorAll("a[href*='/users/']")].find((a) => text(a));
    if (userLink) return text(userLink);
    // 2) Parse the "Author - #123 project / repo" line.
    const rest = text(row).replace(titleOf(link), "");
    const m = rest.match(AUTHOR_LINE);
    return m ? m[1].trim() : "";
  }

  // Returns the matching team name (as configured) or "".
  function teamMemberIn(row, author) {
    if (!TEAM.length) return "";
    const a = norm(author);
    if (a && TEAM.includes(a)) return author;
    // Fallback: the name appears anywhere in the row's visible text
    // (reviewer avatars use aria-label, so they don't leak in here).
    const t = norm(text(row));
    return TEAM.find((name) => t.includes(name)) || "";
  }

  function makeIcon(cls) {
    const badge = document.createElement("span");
    badge.className = "wip-sorter-team-badge wip-sorter-team-dot " + cls;
    badge.title = "Team member";
    return badge;
  }

  function addTeamBadge(row, link, name) {
    if (row.querySelector(".wip-sorter-team-badge")) return;

    const lname = norm(name);
    // Prefer the author element; else any leaf containing the name; else the title link.
    const leaf =
      row.querySelector(".user-name") ||
      [...row.querySelectorAll("span, a, div, small, strong, b")].find(
        (el) => el.children.length === 0 && norm(text(el)).includes(lname)
      );
    (leaf || link).insertAdjacentElement("afterend", makeIcon("wip-sorter-name-badge"));
  }

  // ---- Row classification -------------------------------------------------

  function hasConflict(row) {
    if (row.querySelector("[class*='conflict' i], [data-conflict], [aria-label*='conflict' i], [title*='conflict' i]")) return true;
    return [...row.querySelectorAll("span, div, small")].some(
      (el) => el.children.length === 0 && /^\s*conflicts?\s*$/i.test(el.textContent)
    );
  }

  function hasFailedBuild(row) {
    return !!row.querySelector(
      [
        "[class*='build'][class*='fail' i]",
        "[class*='failed' i]",
        "[aria-label*='fail' i]",
        "[title*='fail' i]",
        "[data-testid*='fail' i]",
        "[data-build-status='FAILED']",
        "[data-status='FAILED']",
        ".aui-iconfont-error",
        ".aui-iconfont-cross-circle",
      ].join(",")
    );
  }

  const APPROVED = /\bapproved\b/i;

  function isApproved(el) {
    if (!el) return false;
    const cls = (el.className || "").toString();
    const lbl = ["aria-label", "title", "data-testid", "data-status"]
      .map((a) => el.getAttribute(a)).filter(Boolean).join(" ");
    if (APPROVED.test(cls) || APPROVED.test(lbl)) return true;
    return !!el.querySelector(
      "[class*='approved' i], [data-testid*='approved' i], [data-status='APPROVED'], [aria-label*='approved' i], [title*='approved' i], .aui-iconfont-approve, .aui-iconfont-check-circle"
    );
  }

  function isClosedRow(row) {
    return [...row.querySelectorAll("span, div, small")].some(
      (el) => el.children.length === 0 && CLOSED_STATE_PATTERN.test(el.textContent)
    );
  }

  function approvedByMe(row) {
    const mine = [...row.querySelectorAll(REVIEWER_AVATAR_SELECTOR)].filter(mentionsMe);
    // The status badge is rendered alongside the avatar image: check the
    // avatar's wrapper and one level up.
    return mine.some((avatar) => {
      const wrapper = avatar.parentElement;
      return isApproved(wrapper) || isApproved(wrapper && wrapper.parentElement);
    });
  }

  function classify(row, title) {
    if (SETTINGS.tierWip && WIP_PATTERN.test(title)) return "wip";
    if (SETTINGS.tierBlocked && (hasConflict(row) || hasFailedBuild(row))) return "blocked";
    if (SETTINGS.tierApproved && approvedByMe(row)) return "approved";
    return null;
  }

  // ---- Auto-expand "Show more pull requests" ------------------------------

  const expandClicks = new Map(); // section title -> click count

  function wantsExpand(sectionTitle) {
    if (/^your pull requests/i.test(sectionTitle)) return SETTINGS.expandYours;
    if (/^recently closed/i.test(sectionTitle)) return SETTINGS.expandClosed;
    if (/to review/i.test(sectionTitle)) return SETTINGS.expandReview;
    return false;
  }

  function autoExpand() {
    document.querySelectorAll("button, a, [role='button']").forEach((btn) => {
      if (!SHOW_MORE_PATTERN.test(text(btn))) return;
      if (btn.disabled || btn.getAttribute("aria-busy") === "true" || btn.dataset.wipClicked === "1") return;
      // Never trigger a real navigation: only click links with no/empty/hash href.
      const href = btn.getAttribute("href");
      if (btn.tagName === "A" && href && href !== "#" && !/^javascript:/i.test(href)) return;
      const section = sectionTitleFor(btn);
      if (!wantsExpand(section)) return;
      const n = expandClicks.get(section) || 0;
      if (n >= MAX_EXPAND_CLICKS) return;
      expandClicks.set(section, n + 1);
      btn.dataset.wipClicked = "1"; // the button is usually re-rendered after loading
      btn.click();
    });
  }

  // ---- Section management -------------------------------------------------
  //
  // Bitbucket's dashboard is a React app. Physically moving PR rows into a
  // brand-new sibling container (a synthetic <tbody>/<ul>) detaches them from
  // the <tbody>/<ul> React itself renders and tracks. The next time React
  // reconciles that original container it expects the row to still be a
  // child there, calls insertBefore, finds it isn't, and throws
  // "Failed to execute 'insertBefore': ... not a child of this node" —
  // which Bitbucket's ErrorBoundary catches repeatedly until the page goes
  // blank ("this page couldn't be displayed"). To stay safe, headings and
  // rows are always kept as direct children of the SAME original list;
  // grouping is achieved purely by reordering within that one parent
  // (list.appendChild / insertAdjacentElement on an existing child is a safe,
  // React-tolerated reorder — only reparenting to a different element isn't).

  function isTierCollapsed(tierId) {
    return !!(SETTINGS.collapsedTiers && SETTINGS.collapsedTiers[tierId]);
  }

  function setTierCollapsed(tierId, collapsed) {
    SETTINGS.collapsedTiers = { ...(SETTINGS.collapsedTiers || {}), [tierId]: collapsed };
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ collapsedTiers: SETTINGS.collapsedTiers });
    }
    applyTierCollapsed();
  }

  function applyTierCollapsed() {
    document.querySelectorAll(".wip-sorter-section-heading").forEach((heading) => {
      if (!heading.__tierId) return;
      const collapsed = isTierCollapsed(heading.__tierId);
      if (heading.__toggleEl) {
        heading.__toggleEl.setAttribute("aria-expanded", String(!collapsed));
        heading.__toggleEl.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} section`);
      }
    });
    document.querySelectorAll(`[${MARK}]`).forEach((row) => {
      const tier = row.getAttribute(MARK);
      if (!TIERS.some((t) => t.id === tier)) return;
      row.classList.toggle("wip-sorter-row-hidden", isTierCollapsed(tier));
    });
  }

  // Makes `el` (the whole heading bar) the click/keyboard target for
  // collapsing its tier, with a chevron that flips via CSS off aria-expanded.
  function makeToggleable(el, tierId) {
    el.classList.add("wip-sorter-heading-clickable");
    el.setAttribute("role", "button");
    el.tabIndex = 0;
    const toggle = () => setTierCollapsed(tierId, !isTierCollapsed(tierId));
    el.addEventListener("click", toggle);
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      toggle();
    });
    const chevron = document.createElement("span");
    chevron.className = "wip-sorter-chevron";
    chevron.setAttribute("aria-hidden", "true");
    return chevron;
  }

  // Lazily creates (or reuses) the heading element for `tierId`, keeping it
  // as a direct child of `list` — never a new container. Positions it right
  // after the previous tier's current tail so tier order stays canonical.
  function getOrCreateHeading(list, tierId) {
    list.__headings = list.__headings || {};
    let heading = list.__headings[tierId];
    if (heading && heading.isConnected) return heading;

    const tier = TIERS.find((t) => t.id === tierId);
    const isTable = list.tagName.toLowerCase() === "tbody";
    const count = document.createElement("span");
    count.className = "wip-sorter-count";

    let toggleEl;
    if (isTable) {
      heading = document.createElement("tr");
      heading.className = "wip-sorter-header-row";
      const td = document.createElement("td");
      // Deliberately oversized: browsers clamp colspan to the row's real
      // column count, so this always spans full width without needing to
      // (fallibly) count columns ourselves.
      td.colSpan = 1000;
      const headingSpan = document.createElement("span");
      headingSpan.className = `wip-sorter-heading wip-sorter-heading-${tierId}`;
      const chevron = makeToggleable(headingSpan, tierId);
      headingSpan.append(`${tier.label} `, count, chevron);
      td.appendChild(headingSpan);
      heading.appendChild(td);
      toggleEl = headingSpan;
    } else {
      heading = document.createElement(/^(ul|ol)$/i.test(list.tagName) ? "li" : "div");
      heading.className = `wip-sorter-heading wip-sorter-block-heading wip-sorter-heading-${tierId}`;
      const chevron = makeToggleable(heading, tierId);
      heading.append(`${tier.label} `, count, chevron);
      toggleEl = heading;
    }
    heading.classList.add("wip-sorter-section-heading");
    heading.__tierId = tierId;
    heading.__toggleEl = toggleEl;
    heading.__count = count;

    // Anchor after the last preceding tier's current tail (heading or row),
    // else just append it at the current end of `list`.
    list.__tail = list.__tail || {};
    let anchor = null;
    for (const t of TIERS) {
      if (t.id === tierId) break;
      const tail = list.__tail[t.id];
      if (tail && tail.isConnected) anchor = tail;
    }
    if (anchor) anchor.insertAdjacentElement("afterend", heading);
    else list.appendChild(heading);

    list.__headings[tierId] = heading;
    list.__tail[tierId] = heading;
    return heading;
  }

  // Keeps untiered team-member rows as a contiguous block at the very top of
  // `list`. Uses its own tail pointer (like tier groups do) instead of
  // scanning list.children for ".wip-sorter-team-row" — that class is also
  // used by tiered team rows further down the list, so a plain scan would
  // latch onto one of those instead of the actual pinned block.
  function pinTeamRow(list, row) {
    list.__pinTail = list.__pinTail || null;
    if (list.__pinTail && list.__pinTail.isConnected) {
      list.__pinTail.insertAdjacentElement("afterend", row);
    } else {
      list.insertAdjacentElement("afterbegin", row);
    }
    list.__pinTail = row;
  }

  // Moves `row` to become the current tail of its tier's group. `row` is
  // already a child of `list` (it never left it), so this is always a safe
  // same-parent reorder.
  function insertTierRow(list, tierId, row) {
    const heading = getOrCreateHeading(list, tierId);
    list.__tail = list.__tail || {};
    const tail = list.__tail[tierId] || heading;
    tail.insertAdjacentElement("afterend", row);
    list.__tail[tierId] = row;
    heading.__rowCount = (heading.__rowCount || 0) + 1;
    if (heading.__count) heading.__count.textContent = `(${heading.__rowCount})`;
  }

  function refreshCounts() {
    applyTierCollapsed();
  }

  // Undo everything we did: drop headings, clear markers/classes off rows
  // (rows never left their original list, so there's nothing to move back),
  // and allow "show more" clicks again.
  function resetAll() {
    document.querySelectorAll(".wip-sorter-section-heading").forEach((heading) => heading.remove());
    document.querySelectorAll(`[${MARK}]`).forEach((row) => {
      row.removeAttribute(MARK);
      row.classList.remove(
        "wip-sorter-row",
        "wip-sorter-row-blocked",
        "wip-sorter-row-approved",
        "wip-sorter-row-wip",
        "wip-sorter-row-hidden"
      );
    });
    document.querySelectorAll(".wip-sorter-team-badge").forEach((el) => el.remove());
    document.querySelectorAll(".wip-sorter-team-row").forEach((el) => el.classList.remove("wip-sorter-team-row"));
    document.querySelectorAll("[data-wip-clicked]").forEach((el) => delete el.dataset.wipClicked);
    expandClicks.clear();
  }

  // ---- Dashboard: zen mode --------------------------------------------------
  //
  // Hides the sidebar (repository search / recently viewed) and centers the
  // main panel in a narrower column with generous side padding.

  const SIDE_PANEL_SELECTOR = ".side-panel";
  let zenToggleBtn = null;

  function setZenMode(enabled) {
    SETTINGS.zenMode = enabled;
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ zenMode: enabled });
    }
    applyZenMode();
  }

  function buildZenToggle() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wip-sorter-zen-toggle";
    btn.textContent = "🧘";
    setTooltip(btn, "Toggle zen mode (Z)");
    btn.addEventListener("click", () => setZenMode(!SETTINGS.zenMode));
    document.body.appendChild(btn);
    return btn;
  }

  // Applied on every settings change and every sortOnce() pass — cheap (a
  // couple of class toggles) and keeps the toggle button in sync no matter
  // how zenMode got flipped (options page or the floating button itself).
  function applyZenMode() {
    if (isSinglePrPage()) {
      if (zenToggleBtn) {
        zenToggleBtn.remove();
        zenToggleBtn = null;
      }
      return;
    }
    if (!document.querySelector(SIDE_PANEL_SELECTOR)) return; // not the dashboard layout

    document.documentElement.classList.toggle("wip-sorter-zen", !!SETTINGS.zenMode);

    if (!zenToggleBtn || !zenToggleBtn.isConnected) zenToggleBtn = buildZenToggle();
    zenToggleBtn.classList.toggle("wip-sorter-zen-toggle-active", !!SETTINGS.zenMode);
    zenToggleBtn.setAttribute("aria-pressed", String(!!SETTINGS.zenMode));
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "z" && e.key !== "Z") return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (!document.querySelector(SIDE_PANEL_SELECTOR)) return; // only meaningful on the dashboard
    e.preventDefault();
    setZenMode(!SETTINGS.zenMode);
  });

  // ---- Diff view: prev/next file navigation --------------------------------
  //
  // The PR diff tab renders a file tree (<ol class="files"><li class="file">
  // <a href="#<path>">...) alongside the per-file diff blocks. Clicking one of
  // those links is exactly what a user does to jump to a file, so navigation
  // here just clicks through them in document order instead of reimplementing
  // Bitbucket's own scroll/selection behaviour.

  const FILE_LINK_SELECTOR = "ol.files li.file > a[href^='#']";
  let fileNav = null; // { links, index, bar }

  function buildFileNavBar() {
    const bar = document.createElement("div");
    bar.className = "wip-sorter-filenav";
    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "wip-sorter-filenav-btn";
    setTooltip(prev, "Previous file (k)");
    prev.textContent = "◀";
    const label = document.createElement("span");
    label.className = "wip-sorter-filenav-label";
    const next = document.createElement("button");
    next.type = "button";
    next.className = "wip-sorter-filenav-btn";
    setTooltip(next, "Next file (j)");
    next.textContent = "▶";
    prev.addEventListener("click", () => stepFile(-1));
    next.addEventListener("click", () => stepFile(1));

    const divider = document.createElement("span");
    divider.className = "wip-sorter-filenav-divider";
    const collapseAll = document.createElement("button");
    collapseAll.type = "button";
    collapseAll.className = "wip-sorter-filenav-btn";
    setTooltip(collapseAll, "Collapse all folders");
    collapseAll.textContent = "⊟";
    collapseAll.addEventListener("click", () => setAllDirectories(false));
    const expandAll = document.createElement("button");
    expandAll.type = "button";
    expandAll.className = "wip-sorter-filenav-btn";
    setTooltip(expandAll, "Expand all folders");
    expandAll.textContent = "⊞";
    expandAll.addEventListener("click", () => setAllDirectories(true));

    bar.append(prev, label, next, divider, collapseAll, expandAll);
    document.body.appendChild(bar);
    return bar;
  }

  // Custom tooltip (data-tooltip + CSS) instead of the native `title`
  // attribute, which is slow to appear and can't be restyled.
  function setTooltip(el, text) {
    el.dataset.tooltip = text;
    el.setAttribute("aria-label", text);
  }

  // ---- Diff view: expand/collapse all sidebar folders ----------------------
  //
  // A closed directory node has no <ol class="files"> sibling at all (its
  // children aren't in the DOM), so expanding must repeat in passes: each
  // click can reveal previously-hidden nested directories.

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

    if (!open) {
      // Collapsing removes a directory's children from the DOM entirely, so
      // click the deepest (innermost) directories first: otherwise closing an
      // ancestor first can detach a still-open child before its own click
      // fires, leaving it "open" in Bitbucket's internal state (it reappears
      // open the next time that ancestor is expanded). Every open node is
      // already attached at query time, so one depth-sorted pass is enough.
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
    label.textContent = links.length ? `${index + 1} / ${links.length}${name ? " — " + text(name) : ""}` : "";
  }

  // Synthetic j/k keydown events aren't accepted by Bitbucket's own shortcut
  // handler (likely requires a trusted/real event), so the floating buttons
  // step through files themselves. A closed directory removes its files from
  // the DOM entirely, so folders are expanded first (a no-op if nothing is
  // collapsed) and we resume from wherever the current file ends up.
  function stepFile(delta) {
    if (!fileNav || !fileNav.links.length) return;
    const currentLink = fileNav.links[fileNav.index];
    setAllDirectories(true, 15, () => {
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

  // Clicks and native j/k presses both eventually scroll to the target
  // file's diff section, but we can't tell *when* that happens (a synthetic
  // keydown isn't accepted by Bitbucket's own handler, so we can't hook its
  // completion). Watching which file section is actually on screen — via
  // IntersectionObserver — keeps the label/active-file state correct no
  // matter what triggered the navigation (our buttons, native j/k, or the
  // user scrolling by hand).
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
    if (!SETTINGS.fileNav || !isSinglePrPage()) return teardownFileNav();

    const links = [...document.querySelectorAll(FILE_LINK_SELECTOR)];
    if (!links.length) return teardownFileNav();

    links.forEach((link, i) => {
      if (link.dataset.wipFilenavBound) return;
      link.dataset.wipFilenavBound = "1";
      link.addEventListener("click", () => {
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

  // ---- Dashboard: whole-card click-through -----------------------------
  //
  // Clicking a row's empty space navigates to its PR, exactly like clicking
  // its title link. Clicks on any actual link/button/control (avatars'
  // popovers, review controls, the build-status link, etc.) are left alone.

  const INTERACTIVE_SELECTOR =
    "a, button, input, textarea, select, [role='button'], [contenteditable], [data-testid='reviewer-avatar']";

  function cardNavHref(e) {
    if (e.target.closest(INTERACTIVE_SELECTOR)) return null;
    const row = e.target.closest(".wip-sorter-card-clickable");
    return row ? row.dataset.wipCardHref : null;
  }

  document.addEventListener("click", (e) => {
    const href = cardNavHref(e);
    if (!href) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey) window.open(href, "_blank");
    else window.location.assign(href);
  });

  // Middle-click also opens in a new tab.
  document.addEventListener("auxclick", (e) => {
    if (e.button !== 1) return;
    const href = cardNavHref(e);
    if (!href) return;
    e.preventDefault();
    window.open(href, "_blank");
  });

  // ---- PR page: tab shortcut hints ------------------------------------------
  //
  // Bitbucket already lets you press 1/2/3/4 to switch between a pull
  // request's Overview/Diff/Commits/Builds tabs — we don't implement this,
  // we just surface it so it's discoverable. Appended as visible inline text
  // (a CSS tooltip here fights Bitbucket's own hover/active-tab styling).

  const TAB_MENU_LINK_SELECTOR = "ul.tabs-menu > li[data-testid^='tab-'] > a";
  // Real "keycap" emoji glyphs (digit + U+FE0F U+20E3) — a graphical key
  // instead of plain "(1)" text, no extra markup/CSS needed.
  const TAB_HINT_KEYCAPS = ["1\uFE0F\u20E3", "2\uFE0F\u20E3", "3\uFE0F\u20E3", "4\uFE0F\u20E3"];

  function annotateTabShortcuts() {
    document.querySelectorAll(TAB_MENU_LINK_SELECTOR).forEach((a, i) => {
      if (i > 8 || a.querySelector(".wip-sorter-tab-hint")) return;
      const hint = document.createElement("span");
      hint.className = "wip-sorter-tab-hint";
      hint.textContent = TAB_HINT_KEYCAPS[i] || `(${i + 1})`;
      // Append inside the label itself (not as a sibling of it) so it sits
      // on the same line as the text — these tab links are flex containers,
      // so a sibling node would land in its own row instead of next to it.
      (a.querySelector("strong") || a).appendChild(hint);
    });
  }

  // ---- Core ---------------------------------------------------------------

  function sortOnce() {
    // Tiering only applies to dashboard/list pages. A single PR's own page
    // (overview/diff/commits/…) has tab and comment links that also match
    // PR_LINK_SELECTOR, which would otherwise corrupt the diff/file view.
    if (isSinglePrPage()) return;

    const seen = new Set();

    document.querySelectorAll(PR_LINK_SELECTOR).forEach((link) => {
      const row = findRow(link);
      if (!row || seen.has(row)) return;
      seen.add(row);
      // Rows already tiered (or skipped) are settled for good. Rows still
      // marked "main" are re-examined every pass: a freshly-added PR often
      // renders before Bitbucket's async build-status/approval info has
      // arrived, so its first classification can wrongly miss a tier — this
      // lets it get promoted as soon as that info shows up, without waiting
      // for a full page reload.
      if (row.hasAttribute(MARK) && row.getAttribute(MARK) !== "main") return;

      const title = titleOf(link);
      if (!title) return;

      // Make the row's empty space clickable to the PR (links/buttons inside
      // it still behave normally; see the delegated click handler below).
      row.classList.add("wip-sorter-card-clickable");
      row.dataset.wipCardHref = link.href;

      // Leave my own PRs and closed PRs alone.
      if (SKIP_SECTION_PATTERN.test(sectionTitleFor(row)) || isClosedRow(row)) {
        row.setAttribute(MARK, "skip");
        return;
      }

      const author = authorOf(row, link);
      const teamName = teamMemberIn(row, author);
      const team = !!teamName;
      if (team && SETTINGS.teamIcon) addTeamBadge(row, link, teamName);

      const tier = classify(row, title);
      row.setAttribute(MARK, tier || "main");
      row.classList.toggle("wip-sorter-team-row", team);

      if (!tier) {
        if (team && SETTINGS.pinTeam && row.parentElement) {
          pinTeamRow(row.parentElement, row);
        }
        return;
      }

      const list = row.parentElement;
      if (!list) return;
      row.classList.add("wip-sorter-row", `wip-sorter-row-${tier}`);
      insertTierRow(list, tier, row);
    });

    refreshCounts();
    autoExpand();
  }

  let timer = null;
  let runs = 0;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        sortOnce();
        refreshFileNav();
        applyZenMode();
        annotateTabShortcuts();
      } catch (e) {
        console.error("[better-stash] error:", e);
      }
      if (++runs === 1) console.info("[better-stash] first pass done");
    }, 150);
  }

  const observer = new MutationObserver((mutations) => {
    const external = mutations.some((m) => {
      const added = [...m.addedNodes];
      if (added.length && added.every((n) => n.nodeType === 1 && n.className && /wip-sorter-/.test(n.className))) return false;
      return true;
    });
    if (external) schedule();
  });

  function boot() {
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();
  }

  let booted = false;
  function bootOnce(s) {
    if (booted) return;
    booted = true;
    applySettings(s || {});
    boot();
  }

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(SETTINGS, (s) => {
      if (chrome.runtime && chrome.runtime.lastError) console.warn("[better-stash] storage:", chrome.runtime.lastError.message);
      bootOnce(s);
    });
    // Safety net: if storage never answers, run with defaults.
    setTimeout(() => bootOnce({}), 1500);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      const keys = Object.keys(changes);

      // Collapse state is written by this same script (clicking a tier's
      // toggle button); just re-apply it instead of a full re-sort.
      if (keys.length === 1 && keys[0] === "collapsedTiers") {
        SETTINGS.collapsedTiers = changes.collapsedTiers.newValue || {};
        applyTierCollapsed();
        return;
      }

      // Same idea for zen mode: a pure CSS/layout toggle, no need to
      // re-classify every row.
      if (keys.length === 1 && keys[0] === "zenMode") {
        SETTINGS.zenMode = !!changes.zenMode.newValue;
        applyZenMode();
        return;
      }

      const next = {};
      keys.forEach((k) => (next[k] = changes[k].newValue));
      applySettings(next);
      resetAll();   // undo current tiering so every row is re-classified
      schedule();
    });
  } else {
    console.warn("[better-stash] chrome.storage unavailable — running with defaults");
    bootOnce({});
  }
})();
