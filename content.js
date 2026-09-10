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

  function sectionFor(list, tierId) {
    list.__sections = list.__sections || {};
    let sec = list.__sections[tierId];
    if (sec && sec.isConnected) return sec;

    const tier = TIERS.find((t) => t.id === tierId);
    const isTable = list.tagName.toLowerCase() === "tbody";

    let heading = null;
    if (isTable) {
      const table = list.closest("table");
      const cols =
        (table && table.querySelectorAll("thead th").length) ||
        (list.rows[0] && list.rows[0].cells.length) || 1;
      sec = document.createElement("tbody");
      const hr = document.createElement("tr");
      hr.className = "wip-sorter-header-row";
      const td = document.createElement("td");
      td.colSpan = cols;
      td.innerHTML = `<span class="wip-sorter-heading">${tier.label} <span class="wip-sorter-count"></span></span>`;
      hr.appendChild(td);
      sec.appendChild(hr);
    } else {
      heading = document.createElement("div");
      heading.className = `wip-sorter-heading wip-sorter-block-heading wip-sorter-heading-${tierId}`;
      heading.innerHTML = `${tier.label} <span class="wip-sorter-count"></span>`;
      sec = document.createElement(list.tagName);
      sec.className = list.className;
    }
    sec.classList.add("wip-sorter-section", `wip-sorter-${tierId}`);
    sec.__heading = heading;
    sec.__list = list;

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

  // ---- Core ---------------------------------------------------------------

  function sortOnce() {
    const seen = new Set();

    document.querySelectorAll(PR_LINK_SELECTOR).forEach((link) => {
      const row = findRow(link);
      if (!row || seen.has(row)) return;
      seen.add(row);
      if (row.closest(".wip-sorter-section") || row.hasAttribute(MARK)) return;

      const title = titleOf(link);
      if (!title) return;

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
      const next = {};
      Object.keys(changes).forEach((k) => (next[k] = changes[k].newValue));
      applySettings(next);
      resetAll();   // undo current tiering so every row is re-classified
      schedule();
    });
  } else {
    console.warn("[better-stash] chrome.storage unavailable — running with defaults");
    bootOnce({});
  }
})();
