const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { JSDOM } = require("jsdom");

function options(t, saved = {}) {
  const dom = new JSDOM(readFileSync("options.html", "utf8"), { runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const { window } = dom;
  const calls = [];
  window.chrome = {
    runtime: { sendMessage: (_, callback) => callback() },
    storage: { local: {
      get: (defaults, callback) => { calls.push("get"); callback({ ...defaults, ...saved }); },
      set: (values, callback) => { calls.push(values); Object.assign(saved, values); callback(); },
    } },
    permissions: {
      contains: (_, callback) => callback(true),
      request: (_, callback) => { calls.push("request"); callback(true); },
      remove: (_, callback) => { calls.push("remove"); callback(true); },
    },
  };
  for (const file of ["shared.js", "site-config.js", "options.js"]) window.eval(readFileSync(file, "utf8"));
  return { window, document: window.document, calls, saved };
}

test("settings form uses shared defaults and saves editable fields only", async (t) => {
  const { window, document, saved } = options(t, { collapsedTiers: { wip: true } });
  await new Promise(setImmediate);
  assert.equal(document.getElementById("tierWip").checked, window.BetterStash.defaults.tierWip);
  document.getElementById("identity").value = " Alex ";
  document.getElementById("identity").dispatchEvent(new window.Event("input"));
  await new Promise(setImmediate);
  assert.equal(saved.identity, "Alex");
  assert.deepEqual(saved.collapsedTiers, { wip: true });
  assert.equal(document.getElementById("status").textContent, "Saved and applied.");
});

test("connecting requests permission before reading storage and releases the old site", async (t) => {
  const { document, calls, saved } = options(t, { sitePattern: "https://old.example.com/*" });
  await new Promise(setImmediate);
  calls.length = 0;
  document.getElementById("siteUrl").value = "new.example.com/dashboard";
  document.getElementById("connectSite").click();
  assert.equal(calls[0], "request");
  await new Promise(setImmediate);
  assert.equal(saved.sitePattern, "https://new.example.com/*");
  assert.ok(calls.includes("remove"));
  assert.equal(document.getElementById("connectionStatus").textContent, "Connected to https://new.example.com");
});
