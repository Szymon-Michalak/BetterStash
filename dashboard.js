BetterStash.createDashboard = function (settings, layout) {
  "use strict";
  const { text, norm, isDashboardPage, save } = BetterStash;
  const { prepareStateLabel, markNewCommitsIndicator,
    applyStateLabelPlacement, applyZenColumnCollapse } = layout;
  const WIP_PATTERN = /(^|[\s\[\(])(wip|draft|do not merge)([\s\]\):\-]|$)/i;
  let configuredIdentity = [];
  let teamNames = [];
  let identity = null;

  const SHOW_MORE_PATTERN = /^\s*show more pull requests\s*$/i;
  const MAX_EXPAND_CLICKS = 20;
  const SKIP_SECTION_PATTERN = /^(your pull requests|recently closed)/i;
  const CLOSED_STATE_PATTERN = /^\s*(merged|declined)\s*$/i;
  const REVIEWER_AVATAR_SELECTOR =
    "[data-testid='reviewer-avatar--image'], [data-testid*='reviewer'][aria-label], [data-testid*='avatar'][aria-label]";

  const PR_LINK_SELECTOR = 'a[href*="/pull-requests/"]';
  const MARK = "data-wip-tier";
  const TIERS = [
    { id: "blocked",  label: "Blocked" },
    { id: "wip",      label: "Work in progress" },
    { id: "approved", label: "Approved by me" },
  ];

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

  function detectIdentity() {
    if (identity && identity.length) return identity;
    const ids = new Set(configuredIdentity.map(norm));
    document.querySelectorAll(PR_LINK_SELECTOR).forEach((link) => {
      const row = findRow(link);
      if (!row || !/^your pull requests/i.test(sectionTitleFor(row))) return;
      const a = authorOf(row, link);
      if (a) ids.add(norm(a));
    });
    ["current-user", "bb-current-user", "ajs-remote-user-fullname", "ajs-remote-user"].forEach((n) => {
      const meta = document.querySelector(`meta[name="${n}"]`);
      if (meta && meta.content) ids.add(meta.content.trim().toLowerCase());
    });

    ["", "user", "profile", "avatar", "menu"].forEach((x) => ids.delete(x));
    identity = [...ids];
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

  const AUTHOR_LINE = /^\s*(.+?)\s*[-\u2013\u2014]\s*#\d+/;

  function authorOf(row, link) {
    const userName = row.querySelector(".user-name, [class*='user-name'], [class*='author']");
    if (userName && text(userName)) return text(userName);
    const userLink = [...row.querySelectorAll("a[href*='/users/']")].find((a) => text(a));
    if (userLink) return text(userLink);
    const rest = text(row).replace(titleOf(link), "");
    const m = rest.match(AUTHOR_LINE);
    return m ? m[1].trim() : "";
  }

  function teamMemberIn(row, author) {
    if (!teamNames.length) return "";
    const a = norm(author);
    if (a && teamNames.includes(a)) return author;
    const t = norm(text(row));
    return teamNames.find((name) => t.includes(name)) || "";
  }

  function makeIcon() {
    const badge = document.createElement("span");
    badge.className = "wip-sorter-team-badge wip-sorter-team-dot wip-sorter-name-badge";
    badge.title = "Team member";
    return badge;
  }

  function addTeamBadge(row, link, name) {
    if (row.querySelector(".wip-sorter-team-badge")) return;

    const lname = norm(name);
    const leaf =
      row.querySelector(".user-name") ||
      [...row.querySelectorAll("span, a, div, small, strong, b")].find(
        (el) => el.children.length === 0 && norm(text(el)).includes(lname)
      );
    (leaf || link).insertAdjacentElement("afterend", makeIcon());
  }

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
    return mine.some((avatar) => {
      const wrapper = avatar.parentElement;
      return isApproved(wrapper) || isApproved(wrapper && wrapper.parentElement);
    });
  }

  function classify(row, title) {
    if (settings.tierWip && WIP_PATTERN.test(title)) return "wip";
    if (settings.tierBlocked && (hasConflict(row) || hasFailedBuild(row))) return "blocked";
    if (settings.tierApproved && approvedByMe(row)) return "approved";
    return null;
  }

  const expandClicks = new Map();

  function wantsExpand(sectionTitle) {
    if (/^your pull requests/i.test(sectionTitle)) return settings.expandYours;
    if (/^recently closed/i.test(sectionTitle)) return settings.expandClosed;
    if (/to review/i.test(sectionTitle)) return settings.expandReview;
    return false;
  }

  function autoExpand() {
    document.querySelectorAll("button, a, [role='button']").forEach((btn) => {
      if (!SHOW_MORE_PATTERN.test(text(btn))) return;
      if (btn.disabled || btn.getAttribute("aria-busy") === "true" || btn.dataset.wipClicked === "1") return;
      const href = btn.getAttribute("href");
      if (btn.tagName === "A" && href && href !== "#" && !/^javascript:/i.test(href)) return;
      const section = sectionTitleFor(btn);
      if (!wantsExpand(section)) return;
      const n = expandClicks.get(section) || 0;
      if (n >= MAX_EXPAND_CLICKS) return;
      expandClicks.set(section, n + 1);
      btn.dataset.wipClicked = "1";
      btn.click();
    });
  }

  function isTierCollapsed(tierId) {
    return !!(settings.collapsedTiers && settings.collapsedTiers[tierId]);
  }

  function setTierCollapsed(tierId, collapsed) {
    settings.collapsedTiers = { ...(settings.collapsedTiers || {}), [tierId]: collapsed };
    save({ collapsedTiers: settings.collapsedTiers });
    applyTierCollapsed();
  }

  function applyTierCollapsed() {
    document.querySelectorAll(".wip-sorter-section-heading").forEach((heading) => {
      const collapsed = isTierCollapsed(heading.dataset.wipHeading);
      const toggle = heading.matches("[role='button']") ? heading : heading.querySelector("[role='button']");
      toggle.setAttribute("aria-expanded", String(!collapsed));
      toggle.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} section`);
    });
    document.querySelectorAll(`[${MARK}]`).forEach((row) => {
      const tier = row.getAttribute(MARK);
      if (!TIERS.some((t) => t.id === tier)) return;
      row.classList.toggle("wip-sorter-row-hidden", isTierCollapsed(tier));
    });
  }

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
  const EMPTY_MESSAGES = [
    "🎉 All caught up! Nothing left to review.",
    "✨ Nothing waiting on you — nice work!",
    "🙌 Inbox zero. Go enjoy the quiet.",
  ];

  function nativeRowPadding(list) {
    const sampleRow = [...list.children].find(
      (child) => child.hasAttribute(MARK) && child.getAttribute(MARK) !== "skip"
    );
    const cell = sampleRow && (sampleRow.querySelector(".summary-column") || sampleRow.querySelector("td") || sampleRow.firstElementChild);
    if (!cell || typeof getComputedStyle !== "function") return null;
    const style = getComputedStyle(cell);
    return style && style.paddingTop && style.paddingBottom ? { top: style.paddingTop, bottom: style.paddingBottom } : null;
  }

  // Extra breathing room (beyond a normal row's padding) so the banner reads as a
  // deliberate, calm pause rather than just another row in the list.
  const EXTRA_PADDING_PX = 20;

  function addPadding(value, extra) {
    const num = parseFloat(value);
    return Number.isFinite(num) ? `${num + extra}px` : value;
  }

  function getOrCreateEmptyState(list) {
    const existing = list.querySelector(":scope > [data-wip-empty]");
    if (existing) return existing;
    const isTable = list.tagName === "TBODY";
    const el = document.createElement(isTable ? "tr" : /^(UL|OL)$/.test(list.tagName) ? "li" : "div");
    el.dataset.wipEmpty = "1";
    el.classList.add("wip-sorter-empty-state");
    const message = document.createElement(isTable ? "td" : "div");
    message.className = "wip-sorter-empty-state-message";
    message.textContent = EMPTY_MESSAGES[Math.floor(Math.random() * EMPTY_MESSAGES.length)];
    if (isTable) message.colSpan = 1000;
    // Mirror a real row's vertical padding (plus a bit extra for prominence) instead
    // of a guessed value, so the banner scales with the page's theme but still
    // stands out more than an ordinary row.
    const padding = nativeRowPadding(list);
    if (padding) {
      message.style.paddingTop = addPadding(padding.top, EXTRA_PADDING_PX);
      message.style.paddingBottom = addPadding(padding.bottom, EXTRA_PADDING_PX);
    }
    el.append(message);
    list.insertBefore(el, list.firstChild);
    return el;
  }

  function updateEmptyStates() {
    const lists = new Map();
    document.querySelectorAll(`[${MARK}]`).forEach((row) => {
      const mark = row.getAttribute(MARK);
      if (mark === "skip") return;
      const list = row.parentElement;
      if (!list) return;
      const stat = lists.get(list) || { total: 0, unsorted: 0 };
      stat.total += 1;
      if (mark === "main") stat.unsorted += 1;
      lists.set(list, stat);
    });
    document.querySelectorAll("[data-wip-empty]").forEach((el) => {
      const list = el.parentElement;
      const stat = list && lists.get(list);
      if (!stat || stat.unsorted > 0) el.remove();
    });
    lists.forEach((stat, list) => {
      if (stat.total > 0 && stat.unsorted === 0) getOrCreateEmptyState(list);
    });
  }

  // Keep rows in Bitbucket's original parent so React can still reconcile them.
  function getOrCreateHeading(list, tierId) {
    const existing = list.querySelector(`:scope > [data-wip-heading="${tierId}"]`);
    if (existing) return existing;
    const isTable = list.tagName === "TBODY";
    const heading = document.createElement(isTable ? "tr" : /^(UL|OL)$/.test(list.tagName) ? "li" : "div");
    const toggle = isTable ? document.createElement("span") : heading;
    toggle.className = `wip-sorter-heading wip-sorter-heading-${tierId}`;
    heading.classList.add("wip-sorter-section-heading", isTable ? "wip-sorter-header-row" : "wip-sorter-block-heading");
    heading.dataset.wipHeading = tierId;
    const count = document.createElement("span");
    count.className = "wip-sorter-count";
    toggle.append(`${TIERS.find((tier) => tier.id === tierId).label} `, count, makeToggleable(toggle, tierId));
    if (isTable) {
      const cell = document.createElement("td");
      cell.colSpan = 1000;
      cell.append(toggle);
      heading.append(cell);
    }
    const tierIndex = TIERS.findIndex((tier) => tier.id === tierId);
    const next = [...list.children].find((child) =>
      TIERS.findIndex((tier) => tier.id === child.dataset.wipHeading) > tierIndex);
    list.insertBefore(heading, next || null);
    return heading;
  }

  const REDUCE_MOTION = matchMedia("(prefers-reduced-motion: reduce)");
  function moveRowSmoothly(row, move) {
    if (REDUCE_MOTION.matches) {
      move();
      return;
    }
    row.style.transition = "none";
    row.style.opacity = "0";
    move();
    row.getBoundingClientRect();
    requestAnimationFrame(() => {
      row.style.transition = "";
      row.style.opacity = "";
    });
  }

  function pinTeamRow(list, row) {
    let anchor = null;
    for (const child of list.children) {
      if (child.getAttribute(MARK) !== "main" || !child.classList.contains("wip-sorter-team-row")) break;
      if (child === row) return;
      anchor = child;
    }
    moveRowSmoothly(row, () => list.insertBefore(row, anchor ? anchor.nextSibling : list.firstChild));
  }

  function keepUnsortedAboveTiers(list, row) {
    const heading = list.querySelector(":scope > [data-wip-heading]");
    if (!heading || row.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING) return;
    moveRowSmoothly(row, () => list.insertBefore(row, heading));
  }

  function insertTierRow(list, tierId, row) {
    let anchor = getOrCreateHeading(list, tierId);
    while (anchor.nextElementSibling?.getAttribute(MARK) === tierId) {
      anchor = anchor.nextElementSibling;
      if (anchor === row) return;
    }
    moveRowSmoothly(row, () => anchor.insertAdjacentElement("afterend", row));
  }

  function refreshCounts() {
    const lists = new Set();
    document.querySelectorAll("[data-wip-heading]").forEach((heading) => {
      const count = [...heading.parentElement.children].filter((row) =>
        row.getAttribute(MARK) === heading.dataset.wipHeading).length;
      if (!count) heading.remove();
      else {
        lists.add(heading.parentElement);
        const label = heading.querySelector(".wip-sorter-count");
        if (label.textContent !== `(${count})`) label.textContent = `(${count})`;
      }
    });
    // When every row lands in a tier, the topmost heading has no unsorted row above it
    // to separate from; drop its separator styling so it doesn't sit awkwardly under
    // the table/list header. Insert the empty-state banner first so it counts as the
    // preceding row once there truly is nothing left unsorted.
    updateEmptyStates();
    lists.forEach((list) => {
      list.querySelectorAll(":scope > [data-wip-heading]").forEach((heading) => {
        heading.classList.toggle("wip-sorter-heading-first", heading === list.firstElementChild);
      });
    });
    applyTierCollapsed();
  }

  function resetAll() {
    document.querySelectorAll(".wip-sorter-section-heading").forEach((heading) => heading.remove());
    document.querySelectorAll("[data-wip-empty]").forEach((el) => el.remove());
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
  document.addEventListener("auxclick", (e) => {
    if (e.button !== 1) return;
    const href = cardNavHref(e);
    if (!href) return;
    e.preventDefault();
    window.open(href, "_blank");
  });

  function sortOnce() {
    if (!isDashboardPage()) return;

    const seen = new Set();

    document.querySelectorAll(PR_LINK_SELECTOR).forEach((link) => {
      const row = findRow(link);
      if (!row || seen.has(row)) return;
      seen.add(row);
      if (row.hasAttribute(MARK)) {
        const mark = row.getAttribute(MARK);
        if (mark !== "main") {
          if (row.parentElement && TIERS.some((t) => t.id === mark)) {
            insertTierRow(row.parentElement, mark, row);
          }
          return;
        }
      }

      const title = titleOf(link);
      if (!title) return;
      row.classList.add("wip-sorter-card-clickable");
      row.dataset.wipCardHref = link.href;
      prepareStateLabel(row);
      markNewCommitsIndicator(row);
      if (SKIP_SECTION_PATTERN.test(sectionTitleFor(row)) || isClosedRow(row)) {
        row.setAttribute(MARK, "skip");
        return;
      }

      const author = authorOf(row, link);
      const teamName = teamMemberIn(row, author);
      const team = !!teamName;
      if (team && settings.teamIcon) addTeamBadge(row, link, teamName);

      const tier = classify(row, title);
      row.setAttribute(MARK, tier || "main");
      row.classList.toggle("wip-sorter-team-row", team);

      if (!tier) {
        if (team && settings.pinTeam && row.parentElement) {
          pinTeamRow(row.parentElement, row);
        } else if (row.parentElement) {
          keepUnsortedAboveTiers(row.parentElement, row);
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
    applyStateLabelPlacement();
    applyZenColumnCollapse();
  }

  function configure() {
    configuredIdentity = String(settings.identity || "").split(",").map(norm).filter(Boolean);
    teamNames = String(settings.team || "").split(",").map(norm).filter(Boolean);
    identity = null;
    document.documentElement.classList.toggle("wip-sorter-no-dim", !settings.dimRows);
    document.documentElement.classList.toggle("wip-sorter-team-tint", !!settings.teamTint);
  }

  return { refresh: sortOnce, reset: resetAll, configure, applyTierCollapsed };
};
