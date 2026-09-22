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
    document.querySelectorAll(".wip-sorter-section").forEach((sec) => {
      if (!sec.__tierId) return;
      const collapsed = isTierCollapsed(sec.__tierId);
      sec.classList.toggle("wip-sorter-collapsed", collapsed);
      if (sec.__toggleEl) {
        sec.__toggleEl.setAttribute("aria-expanded", String(!collapsed));
        sec.__toggleEl.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} section`);
      }
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

  function sectionFor(list, tierId) {
    list.__sections = list.__sections || {};
    let sec = list.__sections[tierId];
    if (sec && sec.isConnected) return sec;

    const tier = TIERS.find((t) => t.id === tierId);
    const isTable = list.tagName.toLowerCase() === "tbody";

    let heading = null;
    let toggleEl;
    if (isTable) {
      sec = document.createElement("tbody");
      const hr = document.createElement("tr");
      hr.className = "wip-sorter-header-row";
      const td = document.createElement("td");
      // Deliberately oversized: browsers clamp colspan to the row's real
      // column count, so this always spans full width without needing to
      // (fallibly) count columns ourselves.
      td.colSpan = 1000;
      const headingSpan = document.createElement("span");
      headingSpan.className = "wip-sorter-heading";
      const count = document.createElement("span");
      count.className = "wip-sorter-count";
      const chevron = makeToggleable(headingSpan, tierId);
      headingSpan.append(`${tier.label} `, count, chevron);
      td.appendChild(headingSpan);
      hr.appendChild(td);
      sec.appendChild(hr);
      toggleEl = headingSpan;
    } else {
      heading = document.createElement("div");
      heading.className = `wip-sorter-heading wip-sorter-block-heading wip-sorter-heading-${tierId}`;
      const count = document.createElement("span");
      count.className = "wip-sorter-count";
      const chevron = makeToggleable(heading, tierId);
      heading.append(`${tier.label} `, count, chevron);
      sec = document.createElement(list.tagName);
      sec.className = list.className;
      toggleEl = heading;
    }
    sec.classList.add("wip-sorter-section", `wip-sorter-${tierId}`);
    sec.__heading = heading;
    sec.__list = list;
    sec.__tierId = tierId;
    sec.__toggleEl = toggleEl;

    // Insert after the last existing section that precedes this tier.
    let anchor = list;
    for (const t of TIERS) {
      if (t.id === tierId) break;
      const prev = list.__sections[t.id];
      if (prev && prev.isConnected) anchor = prev;
    }
    anchor.insertAdjacentElement("afterend", sec);
    if (heading) sec.insertAdjacentElement("beforebegin", heading);

    list.__sections[tierId] = sec;
    return sec;
  }

  function refreshCounts() {
    document.querySelectorAll(".wip-sorter-section").forEach((sec) => {
      const n = sec.querySelectorAll(`[${MARK}]`).length;
      const count =
        sec.querySelector(".wip-sorter-count") ||
        (sec.__heading && sec.__heading.querySelector(".wip-sorter-count"));
      if (count) count.textContent = n ? `(${n})` : "";
      const hide = n === 0;
      sec.style.display = hide ? "none" : "";
      if (sec.__heading) sec.__heading.style.display = hide ? "none" : "";
    });
    applyTierCollapsed();
  }

  // Undo everything we did: move rows back to their original list, drop
  // sections and headings, clear markers, allow "show more" clicks again.
  function resetAll() {
    document.querySelectorAll(".wip-sorter-section").forEach((sec) => {
      const list = sec.__list;
      sec.querySelectorAll(`[${MARK}]`).forEach((row) => {
        row.removeAttribute(MARK);
        row.classList.remove("wip-sorter-row", "wip-sorter-row-blocked", "wip-sorter-row-approved", "wip-sorter-row-wip");
        if (list && list.isConnected) list.appendChild(row);
      });
      if (sec.__heading) sec.__heading.remove();
      sec.remove();
      if (list) list.__sections = {};
    });
    document.querySelectorAll(`[${MARK}]`).forEach((el) => el.removeAttribute(MARK));
    document.querySelectorAll(".wip-sorter-team-badge").forEach((el) => el.remove());
    document.querySelectorAll(".wip-sorter-team-row").forEach((el) => el.classList.remove("wip-sorter-team-row"));
    document.querySelectorAll("[data-wip-clicked]").forEach((el) => delete el.dataset.wipClicked);
    expandClicks.clear();
  }

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
    setTooltip(prev, "Previous file ( [ )");
    prev.textContent = "◀";
    const label = document.createElement("span");
    label.className = "wip-sorter-filenav-label";
    const next = document.createElement("button");
    next.type = "button";
    next.className = "wip-sorter-filenav-btn";
    setTooltip(next, "Next file ( ] )");
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

  function setAllDirectories(open, passesLeft = 15) {
    const btns = [...document.querySelectorAll(DIRECTORY_BUTTON_SELECTOR)].filter(
      (btn) => isDirectoryOpen(btn) !== open
    );
    if (!btns.length || passesLeft <= 0) return;

    if (!open) {
      // Collapsing removes a directory's children from the DOM entirely, so
      // click the deepest (innermost) directories first: otherwise closing an
      // ancestor first can detach a still-open child before its own click
      // fires, leaving it "open" in Bitbucket's internal state (it reappears
      // open the next time that ancestor is expanded). Every open node is
      // already attached at query time, so one depth-sorted pass is enough.
      btns.sort((a, b) => directoryDepth(b) - directoryDepth(a));
      btns.forEach((btn) => btn.click());
      return;
    }

    btns.forEach((btn) => btn.click());
    setTimeout(() => setAllDirectories(open, passesLeft - 1), 30);
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

  function stepFile(delta) {
    if (!fileNav || !fileNav.links.length) return;
    fileNav.index = (fileNav.index + delta + fileNav.links.length) % fileNav.links.length;
    const link = fileNav.links[fileNav.index];
    link.click();
    link.scrollIntoView({ block: "nearest" });
    updateFileNavUI();
  }

  function teardownFileNav() {
    if (!fileNav) return;
    fileNav.bar.remove();
    fileNav = null;
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
    updateFileNavUI();
  }

  document.addEventListener("keydown", (e) => {
    if (!fileNav || !fileNav.links.length) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "]") { stepFile(1); e.preventDefault(); }
    else if (e.key === "[") { stepFile(-1); e.preventDefault(); }
  });

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
      if (row.closest(".wip-sorter-section") || row.hasAttribute(MARK)) return;

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
          const list = row.parentElement;
          const lastTeam = [...list.children].filter((r) => r !== row && r.classList.contains("wip-sorter-team-row")).pop();
          if (lastTeam) lastTeam.insertAdjacentElement("afterend", row);
          else list.insertAdjacentElement("afterbegin", row);
        }
        return;
      }

      const list = row.parentElement;
      if (!list) return;
      row.classList.add("wip-sorter-row", `wip-sorter-row-${tier}`);
      sectionFor(list, tier).appendChild(row);
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
      } catch (e) {
        console.error("[better-stash] error:", e);
      }
      if (++runs === 1) console.info("[better-stash] first pass done");
    }, 150);
  }

  const observer = new MutationObserver((mutations) => {
    const external = mutations.some((m) => {
      if (m.target.closest && m.target.closest(".wip-sorter-section")) return false;
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
