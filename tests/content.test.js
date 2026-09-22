const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { JSDOM } = require("jsdom");

const files = ["shared.js", "layout.js", "dashboard.js", "diff.js", "content.js"];
const sources = Object.fromEntries(files.map((file) => [file, readFileSync(file, "utf8")]));
const approval = '<div class="approved"><span data-testid="reviewer-avatar--image" aria-label="Alex"></span></div>';
const conflict = '<span class="conflict">Conflict</span>';
const row = (id, title, extra = "", author = "Taylor") =>
  `<tr id="${id}"><td><a href="/projects/APP/repos/demo/pull-requests/${id.replace(/\D/g, "") || 1}">${title}</a>
  <span class="user-name">${author}</span><div class="details"></div>${extra}</td></tr>`;
const section = (rows, title = "Pull requests to review") => `<section><h2>${title}</h2><table><tbody>${rows}</tbody></table></section>`;

function page(t, html, saved = {}, path = "/dashboard", boot = false) {
  const dom = new JSDOM(html, { url: `https://stash.example.com${path}`, runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const window = dom.window;
  const document = window.document;
  const timers = new Map();
  const writes = [];
  let changed;
  let timerId = 0;
  window.setTimeout = (callback, delay) => {
    timers.set(++timerId, { callback, delay });
    return timerId;
  };
  window.clearTimeout = (id) => timers.delete(id);
  window.matchMedia = () => ({ matches: true });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.IntersectionObserver = class {
    observe() {}
    disconnect() {}
  };
  window.chrome = {
    runtime: {},
    storage: {
      local: { get: (defaults, callback) => callback({ ...defaults, ...saved }), set: (value) => writes.push(value) },
      onChanged: { addListener: (callback) => { changed = callback; } },
    },
  };
  for (const file of files.slice(0, -1)) window.eval(sources[file]);
  const settings = { ...window.BetterStash.defaults, ...saved };
  const layout = boot ? null : window.BetterStash.createLayout(settings);
  const dashboard = boot ? null : window.BetterStash.createDashboard(settings, layout);
  const diff = boot ? null : window.BetterStash.createDiff(settings);
  dashboard?.configure();
  if (boot) window.eval(sources["content.js"]);
  return {
    window, document, settings, layout, dashboard, diff, writes,
    change(values) {
      changed(Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }])), "local");
    },
    async settle(delay = 150) {
      for (let pass = 0; pass < 10; pass++) {
        await new Promise(setImmediate);
        const pending = [...timers].filter(([, timer]) => timer.delay === delay);
        if (!pending.length) return;
        for (const [id, timer] of pending) {
          timers.delete(id);
          timer.callback();
        }
      }
      assert.fail("Page refresh did not settle");
    },
  };
}

const order = (document) => [...document.querySelector("tbody").children].map((el) => el.id || el.dataset.wipHeading);

test("groups in display order while preserving classification priority and original parents", (t) => {
  const { document, dashboard } = page(t, section(
    row("a1", "Ready", approval) + row("w2", "[WIP] Work", conflict) + row("b3", "Blocked", conflict + approval) + row("m4", "Review")), { identity: "Alex" });
  const parent = document.querySelector("tbody");
  dashboard.refresh();
  assert.deepEqual(order(document), ["m4", "blocked", "b3", "wip", "w2", "approved", "a1"]);
  assert.equal(document.getElementById("w2").parentElement, parent);
  dashboard.refresh();
  assert.deepEqual(order(document), ["m4", "blocked", "b3", "wip", "w2", "approved", "a1"]);
});

test("leaves personal, closed and single-PR rows untiered", (t) => {
  const { document, dashboard } = page(t, section(row("p1", "WIP mine"), "Your pull requests") +
    section(row("c2", "WIP closed"), "Recently closed") + section(row("c3", "WIP merged", "<span>Merged</span>")));
  dashboard.refresh();
  assert.equal(document.querySelectorAll('[data-wip-tier="skip"]').length, 3);
  assert.equal(document.querySelectorAll("[data-wip-heading]").length, 0);
  const pr = page(t, section(row("p1", "WIP title")), {}, "/projects/APP/repos/demo/pull-requests/1/diff");
  pr.dashboard.refresh();
  assert.equal(pr.document.querySelectorAll("[data-wip-tier]").length, 0);
});

test("promotes late build results and repairs displaced rows and deleted headings", (t) => {
  const { document, dashboard } = page(t, section(row("m1", "Pending") + row("w2", "WIP task") + row("b3", "Blocked", conflict)));
  dashboard.refresh();
  const pending = document.getElementById("m1");
  pending.firstElementChild.insertAdjacentHTML("beforeend", '<span data-build-status="FAILED"></span>');
  document.querySelector("tbody").prepend(document.getElementById("w2"));
  document.querySelector('[data-wip-heading="blocked"]').remove();
  dashboard.refresh();
  assert.deepEqual(order(document), ["blocked", "m1", "b3", "wip", "w2"]);
  assert.equal(document.querySelector('[data-wip-heading="blocked"] .wip-sorter-count').textContent, "(2)");
  pending.remove();
  dashboard.refresh();
  assert.equal(document.querySelector('[data-wip-heading="blocked"] .wip-sorter-count').textContent, "(1)");
});

test("collapse works by keyboard, persists and survives refresh", (t) => {
  const { document, window, dashboard, writes } = page(t, section(row("w1", "WIP task")));
  dashboard.refresh();
  const toggle = document.querySelector('[role="button"]');
  toggle.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  dashboard.refresh();
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(document.getElementById("w1").classList.contains("wip-sorter-row-hidden"), true);
  assert.equal(writes.at(-1).collapsedTiers.wip, true);
  toggle.click();
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
});

test("team pinning stays stable and settings reset removes badges and tiers", (t) => {
  const { document, dashboard, settings } = page(t, section(
    row("m1", "Other") + row("t2", "Team one", "", "Alex") + row("t3", "Team two", "", "Alex") + row("w4", "WIP task")),
  { team: "Alex", pinTeam: true, teamIcon: true });
  dashboard.refresh();
  assert.deepEqual(order(document), ["t2", "t3", "m1", "wip", "w4"]);
  dashboard.refresh();
  assert.deepEqual(order(document), ["t2", "t3", "m1", "wip", "w4"]);
  assert.equal(document.querySelectorAll(".wip-sorter-team-badge").length, 2);
  Object.assign(settings, { tierWip: false, team: "" });
  dashboard.configure();
  dashboard.reset();
  dashboard.refresh();
  assert.equal(document.querySelectorAll("[data-wip-heading], .wip-sorter-team-badge").length, 0);
});

test("auto-expansion respects section preferences, navigation links and repeat clicks", (t) => {
  const { document, dashboard } = page(t, `<section><h2>Pull requests to review</h2><button id="review">Show more pull requests</button>
    <a href="/next" id="link">Show more pull requests</a></section>
    <section><h2>Your pull requests</h2><button id="own">Show more pull requests</button></section>`);
  const clicks = [];
  document.addEventListener("click", (event) => { event.preventDefault(); clicks.push(event.target.id); });
  dashboard.refresh();
  dashboard.refresh();
  assert.deepEqual(clicks, ["review"]);
});

test("zen mode moves the same status node and restores its exact position and colspan", (t) => {
  const { document, dashboard, layout, settings } = page(t, `<div class="side-panel"></div><h2>Pull requests to review</h2>
    <table><thead><tr><th class="summary-column" colspan="6"></th></tr></thead><tbody><tr>
    <td><a href="/pull-requests/1">Review</a><div class="details"></div></td>
    <td class="state-column"><div id="status"><span>Conflict</span></div><i id="after"></i></td>
    <td class="new-commits-column"><span class="new-commits-icon"></span></td>
    <td class="avatar-column"><span class="user-avatar"></span></td></tr></tbody></table>`);
  const status = document.getElementById("status");
  dashboard.refresh();
  settings.zenMode = true;
  layout.applyZenMode();
  assert.equal(status.parentElement.className, "details");
  assert.equal(document.querySelector("th").colSpan, 4);
  settings.zenMode = false;
  layout.applyZenMode();
  assert.equal(status.parentElement.className, "state-column");
  assert.equal(status.nextElementSibling.id, "after");
  assert.equal(document.querySelector("th").colSpan, 6);
});

const diffHTML = `<ol class="files"><li class="file"><a href="#one"><span class="file-label">one.js</span></a></li>
  <li class="file"><a href="#two"><span class="file-label">two.js</span></a></li></ol><div id="one"></div><div id="two"></div>`;
const diffPath = "/projects/APP/repos/demo/pull-requests/1/diff";

test("file navigation wraps, tears down safely, and can be enabled again", (t) => {
  const { document, diff, settings } = page(t, diffHTML, {}, diffPath);
  diff.refresh();
  document.querySelector('[aria-label="Previous file (k)"]').click();
  assert.equal(document.querySelector(".wip-sorter-filenav-label").textContent, "2 / 2 — two.js");
  document.querySelector('[aria-label="Next file (j)"]').click();
  assert.equal(document.querySelector(".wip-sorter-filenav-label").textContent, "1 / 2 — one.js");
  settings.fileNav = false;
  diff.refresh();
  assert.equal(document.querySelector(".wip-sorter-filenav"), null);
  document.querySelector('a[href="#two"]').click();
  settings.fileNav = true;
  diff.refresh();
  assert.equal(document.querySelectorAll(".wip-sorter-filenav").length, 1);
});

test("startup and live settings settle without a refresh loop", async (t) => {
  const app = page(t, section(row("w1", "WIP task")), {}, "/dashboard", true);
  await app.settle();
  assert.equal(app.document.querySelectorAll("[data-wip-heading]").length, 1);
  app.change({ tierWip: false });
  await app.settle();
  assert.equal(app.document.querySelectorAll("[data-wip-heading]").length, 0);
  app.change({ tierWip: undefined });
  await app.settle();
  assert.equal(app.document.querySelectorAll("[data-wip-heading]").length, 1);
  const diff = page(t, diffHTML, {}, diffPath, true);
  await diff.settle();
  assert.equal(diff.document.querySelectorAll(".wip-sorter-filenav").length, 1);
});

test("list headings stay ordered when tiers appear later", (t) => {
  const item = (id, title, extra = "") => `<li id="${id}"><a href="/pull-requests/1">${title}</a>${extra}</li>`;
  const { document, dashboard } = page(t, `<h2>Pull requests to review</h2><ul>${item("a", "Ready", approval)}</ul>`, { identity: "Alex" });
  const list = document.querySelector("ul");
  dashboard.refresh();
  list.insertAdjacentHTML("beforeend", item("w", "WIP new") + item("b", "Blocked", conflict) + item("m", "Review"));
  dashboard.refresh();
  assert.deepEqual([...list.children].map((el) => el.id || el.dataset.wipHeading), ["m", "blocked", "b", "wip", "w", "approved", "a"]);
  assert.equal(document.querySelectorAll("li[role='button']").length, 3);
});

test("folder collapse closes children first, and pending navigation tolerates disabling", async (t) => {
  const app = page(t, `<ol class="files"><li class="directory"><button class="directory-label" id="outer"><span class="icon-folder-opened"></span></button>
    <ol class="files"><li class="directory"><button class="directory-label" id="inner"><span class="icon-folder-opened"></span></button></li></ol>
    </li>${diffHTML}</ol>`, {}, diffPath);
  const clicks = [];
  app.document.querySelectorAll("button.directory-label").forEach((button) => button.addEventListener("click", () => {
    clicks.push(button.id);
    button.firstElementChild.classList.toggle("icon-folder-opened");
  }));
  app.diff.refresh();
  app.document.querySelector('[aria-label="Collapse all folders"]').click();
  assert.deepEqual(clicks, ["inner", "outer"]);
  app.document.querySelector('[aria-label="Next file (j)"]').click();
  app.settings.fileNav = false;
  app.diff.refresh();
  await app.settle(30);
  assert.equal(app.document.querySelector(".wip-sorter-filenav"), null);
});
