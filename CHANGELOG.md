# Changelog

All notable changes are documented here. This project follows [Semantic Versioning](https://semver.org/).

## 1.3.0 - 2026-09-22

- Fixed: tiering/sorting no longer runs on a single pull request's own page, so it can't
  interfere with the diff/file view.
- Added: floating prev/next file navigation (with `[` / `]` shortcuts) on the PR Diff tab.
- Added: expand-all/collapse-all buttons for the diff tab's file-tree folders.
- Added: collapsible dashboard tier sections (Blocked / Approved by me / WIP), with the
  collapsed state remembered between page loads.
- Added: whole PR row/card is now clickable through to the PR — links, buttons, and
  reviewer-avatar popovers inside it keep their normal behavior.

## 1.2.0 - 2026-09-10

- Prepared the extension for public distribution.
- Added user-configurable Bitbucket Server origins with optional host permissions.
- Added local validation, tests, reproducible ZIP packaging, and GitHub release automation.
- Removed organization-specific URLs, identity defaults, and bundled team branding.

## 1.1.0

- Added Blocked, Approved by me, and Work in progress pull-request tiers.
- Added team highlighting, pinning, auto-expansion, and local settings.
