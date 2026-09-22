const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, mkdtempSync, readdirSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");
const vm = require("node:vm");

for (const browser of ["chrome", "safari"]) {
  test(`${browser} stages only runtime files with browser-specific background loading`, async (t) => {
    const { extensionFiles, browserManifest } = await import("../scripts/extension.mjs");
    const original = JSON.parse(readFileSync("manifest.json", "utf8"));
    const directory = mkdtempSync(join(tmpdir(), "better-stash-package-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    execFileSync(process.execPath, ["scripts/stage.mjs", browser, directory]);
    assert.deepEqual(readdirSync(directory).sort(), [...extensionFiles].sort());
    const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
    assert.deepEqual(manifest, browserManifest(original, browser));
    assert.deepEqual(manifest.optional_host_permissions, original.optional_host_permissions);
    assert.equal(manifest.host_permissions, undefined);
    assert.equal(manifest.content_scripts, undefined);
    assert.equal(manifest.version, original.version);
    for (const file of extensionFiles.filter((file) => file !== "manifest.json")) {
      assert.equal(readFileSync(join(directory, file), "utf8"), readFileSync(file, "utf8"));
    }
    if (browser === "chrome") assert.deepEqual(manifest, original);
    else {
      assert.equal(manifest.minimum_chrome_version, undefined);
      assert.equal(manifest.options_ui.open_in_tab, undefined);
      assert.deepEqual(manifest.background.scripts, ["site-config.js", "background.js"]);
    }

    let startup;
    let storageChanged;
    let registered = [];
    let permitted = true;
    const listen = { addListener() {} };
    const chrome = {
      runtime: { onStartup: { addListener: (callback) => { startup = callback; } }, onInstalled: listen, onMessage: listen },
      permissions: { contains: async () => permitted, onAdded: listen, onRemoved: listen },
      storage: { local: { get: async () => ({ sitePattern: "https://stash.example.com/*" }) }, onChanged: {
        addListener: (callback) => { storageChanged = callback; },
      } },
      scripting: {
        getRegisteredContentScripts: async () => registered,
        unregisterContentScripts: async () => { registered = []; },
        registerContentScripts: async (scripts) => { registered = scripts; },
      },
    };
    const context = vm.createContext({ chrome, URL, console });
    const load = (file) => vm.runInContext(readFileSync(join(directory, file), "utf8"), context);
    if (manifest.background.service_worker) {
      context.importScripts = load;
      load(manifest.background.service_worker);
    } else manifest.background.scripts.forEach(load);
    await startup();
    assert.equal(registered.length, 1);
    assert.equal(registered[0].matches[0], "https://stash.example.com/*");
    for (const file of [...registered[0].js, ...registered[0].css]) assert.ok(extensionFiles.includes(file));
    permitted = false;
    storageChanged({ sitePattern: {} }, "local");
    await new Promise(setImmediate);
    assert.equal(registered.length, 0);
  });
}

test("manifest conversion rejects unsupported browser names", async () => {
  const { browserManifest } = await import("../scripts/extension.mjs");
  assert.throws(() => browserManifest({}, "unknown"), /Unknown browser/);
});
