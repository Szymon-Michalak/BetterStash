# Changelog

All notable changes are documented here. This project follows [Semantic Versioning](https://semver.org/).

## 1.3.0 - 2026-09-22

- Fixed: tiering no longer relocates PR rows into newly-created containers. Bitbucket's
  dashboard is React-rendered, and physically moving a row out of the `<tbody>`/list React
  manages could make React's next re-render throw `insertBefore: not a child of this node`,
  crashing the whole page ("this page couldn't be displayed") until reload. Tier headings and
  rows now stay as children of the original list and are only reordered in place.
- Fixed: a newly-added PR that appears on the dashboard (e.g. someone just opened one) could
  get stuck at the bottom of the untiered list instead of its Blocked/Approved/WIP section,
  because its build-status/approval info hadn't rendered yet at the moment it was first scanned.
  Untiered rows are now re-checked on every pass until they're either tiered or settle for good.
- Fixed: pinning team members' rows to the top of a list broke after the crash fix above —
  it scanned all rows for the "team" class to find where to insert, but tiered team rows
  further down the list (e.g. in Approved) now carry that class too, since everything stays in
  one list. It now tracks its own top-of-list position instead of scanning for that class.
- Changed: refreshed styling to match Bitbucket's blue (`#0747a6`) — the zen mode toggle's
  active state now uses it, and the Settings page got a full visual refresh (grouped cards,
  accent-colored section labels/checkboxes, refined inputs and buttons).
- Fixed: tiering/sorting no longer runs on a single pull request's own page, so it can't
  interfere with the diff/file view.
- Added: floating prev/next file navigation (matching Bitbucket's native `j`/`k` file
  shortcuts, which already work on their own) on the PR Diff tab; auto-expands any
  collapsed folder standing in the way of the next/previous file, and tracks the
  currently-visible file (however you navigate to it) to stay in sync.
- Added: expand-all/collapse-all buttons for the diff tab's file-tree folders.
- Added: collapsible dashboard tier sections (Blocked / Approved by me / WIP), with the
  collapsed state remembered between page loads.
- Added: whole PR row/card is now clickable through to the PR — links, buttons, and
  reviewer-avatar popovers inside it keep their normal behavior.
- Added: dashboard Zen mode — hides the sidebar and centers the main panel in a narrower column
  with generous side padding. Toggle it from Settings or the small floating button on the
  dashboard; the state is remembered between page loads.
- Added: `Z` keyboard shortcut to toggle Zen mode on the dashboard (also noted in the zen
  toggle button's tooltip).
- Added: an inline "1️⃣ 2️⃣ 3️⃣ 4️⃣" keycap hint on the PR page's Overview/Diff/Commits/Builds
  tabs, pointing out Bitbucket's own `1`–`4` tab-switch shortcut.

## 1.2.0 - 2026-09-10

- Prepared the extension for public distribution.
- Added user-configurable Bitbucket Server origins with optional host permissions.
- Added local validation, tests, reproducible ZIP packaging, and GitHub release automation.
- Removed organization-specific URLs, identity defaults, and bundled team branding.

## 1.1.0

- Added Blocked, Approved by me, and Work in progress pull-request tiers.
- Added team highlighting, pinning, auto-expansion, and local settings.
