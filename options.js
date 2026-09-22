const DEFAULTS = {
  sitePattern: "",
  identity: "",
  team: "",
  teamTint: true,
  teamIcon: false,
  pinTeam: false,
  expandReview: true,
  expandYours: false,
  expandClosed: false,
  tierBlocked: true,
  tierApproved: true,
  tierWip: true,
  dimRows: true,
  fileNav: true,
};

const FORM_KEYS = Object.keys(DEFAULTS).filter((key) => key !== "sitePattern");
const $ = (id) => document.getElementById(id);
const store = chrome?.storage?.local || null;
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

function storageGet(defaults) {
  return new Promise((resolve, reject) => {
    store.get(defaults, (value) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(value);
    });
  });
}

function storageSet(value) {
  return new Promise((resolve, reject) => {
    store.set(value, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function permissionContains(pattern) {
  return new Promise((resolve) => {
    chrome.permissions.contains({ origins: [pattern] }, resolve);
  });
}

function requestPermission(pattern) {
  return new Promise((resolve, reject) => {
    chrome.permissions.request({ origins: [pattern] }, (granted) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(granted);
    });
  });
}

function removePermission(pattern) {
  return new Promise((resolve) => {
    if (!pattern) return resolve(false);
    chrome.permissions.remove({ origins: [pattern] }, resolve);
  });
}

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

async function load() {
  if (!store) return status("Chrome storage is unavailable. Reload the extension.", true);
  try {
    const settings = await storageGet(DEFAULTS);
    FORM_KEYS.forEach((key) => {
      const element = $(key);
      if (element.type === "checkbox") element.checked = Boolean(settings[key]);
      else element.value = settings[key] || "";
    });
    $("siteUrl").value = StashSiteConfig.displayOrigin(settings.sitePattern);
    await updateConnectionState(settings.sitePattern);
  } catch (error) {
    status(error.message, true);
  }
}

async function saveSettings() {
  if (!store) return status("Chrome storage is unavailable. Reload the extension.", true);
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
    // Keep the permission prompt directly tied to the button click. Chrome can
    // reject optional-permission requests after an unrelated async operation.
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
$("connectSite").addEventListener("click", connectSite);
$("disconnectSite").addEventListener("click", disconnectSite);
load();
