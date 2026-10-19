"use strict";

const DEFAULTS = BetterStash.defaults;
const FORM_KEYS = Object.keys(DEFAULTS).filter((key) => key !== "sitePattern" && key !== "collapsedTiers");
const $ = (id) => document.getElementById(id);
const store = globalThis.chrome?.storage?.local;
let statusTimer;

function status(message, isError = false) {
  const element = $("status");
  element.textContent = message;
  element.classList.toggle("error", isError);
  clearTimeout(statusTimer);
  if (message && !isError) {
    statusTimer = setTimeout(() => status(""), 2500);
  }
}

function chromeCall(api, method, value) {
  return new Promise((resolve, reject) => {
    api[method](value, (result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });
}

const storageGet = (value) => chromeCall(store, "get", value);
const storageSet = (value) => chromeCall(store, "set", value);
const permissionContains = (pattern) => chromeCall(chrome.permissions, "contains", { origins: [pattern] });
const requestPermission = (pattern) => chromeCall(chrome.permissions, "request", { origins: [pattern] });
const removePermission = (pattern) => pattern && chromeCall(chrome.permissions, "remove", { origins: [pattern] });

function syncRegistration() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "sync-site-registration" }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

async function updateConnectionState(pattern) {
  const connected = pattern && (await permissionContains(pattern));
  $("connectionStatus").textContent = connected
    ? `Connected to ${StashSiteConfig.displayOrigin(pattern)}`
    : "No Bitbucket Server site connected.";
  $("disconnectSite").hidden = !connected;
}

const CATEGORY_KEY = "bsCategory";
const isWide = () => Boolean(globalThis.matchMedia?.("(min-width: 760px)").matches);

function openCategory(name, toggle = false) {
  const panels = document.querySelectorAll(".panel");
  const target = [...panels].find((panel) => panel.dataset.cat === name);
  if (!target) return;
  const shouldClose = toggle && !isWide() && target.classList.contains("open");
  panels.forEach((panel) => {
    const open = panel === target && !shouldClose;
    panel.classList.toggle("open", open);
    panel.querySelector(".panel-head").setAttribute("aria-expanded", String(open));
  });
  document.querySelectorAll(".cats button").forEach((button) => {
    button.classList.toggle("active", button.dataset.cat === target.dataset.cat);
  });
  if (!shouldClose) {
    try { localStorage.setItem(CATEGORY_KEY, name); } catch { /* storage may be unavailable */ }
  }
}

document.querySelectorAll(".cats button").forEach((button) => {
  button.addEventListener("click", () => openCategory(button.dataset.cat));
});
document.querySelectorAll(".panel-head").forEach((head) => {
  head.addEventListener("click", () => openCategory(head.parentElement.dataset.cat, true));
});

function initCategory(connected) {
  let saved = "";
  try { saved = localStorage.getItem(CATEGORY_KEY) || ""; } catch { /* ignore */ }
  openCategory(saved || (connected ? "you" : "connection"));
}

async function load() {
  if (!store) {
    initCategory(true);
    return status("Extension storage is unavailable. Reload the extension.", true);
  }
  try {
    const settings = await storageGet(DEFAULTS);
    FORM_KEYS.forEach((key) => {
      const element = $(key);
      if (element.type === "checkbox") element.checked = Boolean(settings[key]);
      else element.value = settings[key] || "";
    });
    $("siteUrl").value = StashSiteConfig.displayOrigin(settings.sitePattern);
    await updateConnectionState(settings.sitePattern);
    initCategory(Boolean(settings.sitePattern));
  } catch (error) {
    status(error.message, true);
    initCategory(true);
  }
}

async function saveSettings() {
  if (!store) return status("Extension storage is unavailable. Reload the extension.", true);
  const settings = {};
  FORM_KEYS.forEach((key) => {
    const element = $(key);
    settings[key] = element.type === "checkbox" ? element.checked : element.value.trim();
  });
  try {
    await storageSet(settings);
    status("Saved and applied.");
  } catch (error) {
    status(error.message, true);
  }
}

async function connectSite() {
  let pattern;
  try {
    pattern = StashSiteConfig.originPattern($("siteUrl").value);
  } catch (error) {
    status(error.message, true);
    return;
  }

  try {
    // Chrome requires the permission request before any unrelated await.
    const granted = await requestPermission(pattern);
    if (!granted) return status("Site access was not granted.", true);

    const { sitePattern: previousPattern } = await storageGet({ sitePattern: "" });
    await storageSet({ sitePattern: pattern });
    if (previousPattern && previousPattern !== pattern) await removePermission(previousPattern);
    await syncRegistration();
    $("siteUrl").value = StashSiteConfig.displayOrigin(pattern);
    await updateConnectionState(pattern);
    status("Connected. Reload your Bitbucket dashboard.");
  } catch (error) {
    status(error.message, true);
  }
}

async function disconnectSite() {
  try {
    const { sitePattern } = await storageGet({ sitePattern: "" });
    await storageSet({ sitePattern: "" });
    await removePermission(sitePattern);
    await syncRegistration();
    await updateConnectionState("");
    status("Site access removed. Reload any open Bitbucket pages.");
  } catch (error) {
    status(error.message, true);
  }
}

FORM_KEYS.forEach((key) => $(key).addEventListener("change", saveSettings));
$("identity").addEventListener("input", saveSettings);
$("team").addEventListener("input", saveSettings);
$("copyPrTemplate").addEventListener("input", saveSettings);
$("connectSite").addEventListener("click", connectSite);
$("disconnectSite").addEventListener("click", disconnectSite);
load();
