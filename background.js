"use strict";

importScripts("site-config.js");

const CONTENT_SCRIPT_ID = "better-stash-content";
let syncQueue = Promise.resolve();

async function syncContentScript() {
  const existing = await chrome.scripting.getRegisteredContentScripts({
    ids: [CONTENT_SCRIPT_ID],
  });
  if (existing.length) {
    await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  }

  const { sitePattern = "" } = await chrome.storage.local.get({ sitePattern: "" });
  if (!sitePattern) return;

  let normalizedPattern;
  try {
    normalizedPattern = StashSiteConfig.originPattern(sitePattern);
  } catch (error) {
    console.warn("[better-stash] Invalid saved site:", error.message);
    return;
  }

  const permitted = await chrome.permissions.contains({ origins: [normalizedPattern] });
  if (!permitted) return;

  await chrome.scripting.registerContentScripts([
    {
      id: CONTENT_SCRIPT_ID,
      matches: [normalizedPattern],
      js: ["shared.js", "layout.js", "dashboard.js", "diff.js", "content.js"],
      css: ["styles.css"],
      runAt: "document_idle",
      persistAcrossSessions: true,
    },
  ]);
}

function scheduleSync() {
  syncQueue = syncQueue.then(syncContentScript, syncContentScript).catch((error) => {
    console.error("[better-stash] Could not update site registration:", error);
  });
  return syncQueue;
}

chrome.runtime.onInstalled.addListener((details) => {
  scheduleSync();
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(scheduleSync);
chrome.permissions.onAdded.addListener(scheduleSync);
chrome.permissions.onRemoved.addListener(scheduleSync);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.sitePattern) scheduleSync();
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "sync-site-registration") return false;
  scheduleSync().then(() => sendResponse({ ok: true }));
  return true;
});
