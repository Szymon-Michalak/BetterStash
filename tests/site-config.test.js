const test = require("node:test");
const assert = require("node:assert/strict");

require("../site-config.js");

const { originPattern, displayOrigin } = globalThis.StashSiteConfig;

test("normalizes a hostname to an HTTPS origin pattern", () => {
  assert.equal(originPattern("stash.example.com"), "https://stash.example.com/*");
});

test("discards paths, queries, and fragments", () => {
  assert.equal(
    originPattern("https://stash.example.com/projects/APP?tab=open#top"),
    "https://stash.example.com/*",
  );
});

test("supports HTTP for local development servers", () => {
  assert.equal(originPattern("http://localhost:7990/dashboard"), "http://localhost:7990/*");
});

test("rejects unsupported schemes and credentials", () => {
  assert.throws(() => originPattern("file:///tmp/stash"), /Only http/);
  assert.throws(() => originPattern("https://user:secret@stash.example.com"), /only the/);
  assert.throws(() => originPattern("https://*.example.com"), /only the/);
});

test("converts a saved pattern back to a display origin", () => {
  assert.equal(displayOrigin("https://stash.example.com/*"), "https://stash.example.com");
  assert.equal(displayOrigin("not a pattern"), "");
});
