export const extensionFiles = [
  "manifest.json", "background.js", "shared.js", "layout.js", "dashboard.js",
  "diff.js", "content.js", "options.html", "options.js", "site-config.js", "styles.css",
];

export function browserManifest(manifest, browser) {
  if (browser === "chrome") return structuredClone(manifest);
  if (browser !== "safari") throw new Error(`Unknown browser: ${browser}`);
  const safari = structuredClone(manifest);
  delete safari.minimum_chrome_version;
  delete safari.options_ui.open_in_tab;
  safari.background = { scripts: ["site-config.js", "background.js"] };
  return safari;
}
