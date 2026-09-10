(function (root) {
  "use strict";

  function originPattern(input) {
    const value = String(input || "").trim();
    if (!value) throw new Error("Enter your Bitbucket Server URL.");

    const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
    let url;
    try {
      url = new URL(withScheme);
    } catch {
      throw new Error("Enter a valid URL, for example https://stash.example.com.");
    }

    if (!/^https?:$/.test(url.protocol)) {
      throw new Error("Only http:// and https:// URLs are supported.");
    }
    if (!url.hostname || url.hostname.includes("*") || url.username || url.password) {
      throw new Error("Enter a URL containing only the Bitbucket Server address.");
    }
    return `${url.protocol}//${url.host}/*`;
  }

  function displayOrigin(pattern) {
    if (!pattern) return "";
    try {
      return new URL(pattern.replace(/\*$/, "")).origin;
    } catch {
      return "";
    }
  }

  root.StashSiteConfig = Object.freeze({ originPattern, displayOrigin });
})(globalThis);
