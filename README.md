# BetterStash

A privacy-friendly Chrome extension that organizes pull requests on Bitbucket Server and
Bitbucket Data Center dashboards. It works entirely from the rendered page and makes no REST or
other network requests of its own.

## What it does

Below the main review list, BetterStash creates these optional tiers:

1. **Blocked** — pull requests with a merge conflict or failed build.
2. **Approved by me** — pull requests carrying your approved reviewer badge.
3. **Work in progress** — titles containing `WIP`, `Draft`, or `DO NOT MERGE`.

It can also highlight or pin pull requests from configured teammates and automatically expand
dashboard sections. Your own and recently closed pull requests are left untouched.

## Install a release

1. Download `better-stash-vX.Y.Z.zip` from the repository's **Releases** page.
2. Extract the ZIP to a permanent folder.
3. Open `chrome://extensions` in Chrome.
4. Enable **Developer mode**.
5. Select **Load unpacked** and choose the extracted folder.
6. Open the extension, enter your Bitbucket Server URL, and select **Connect site**.
7. Configure your display name and optional team settings, then reload the Bitbucket dashboard.

Chrome does not keep unpacked extensions when their extracted files are moved or deleted. Keep
the release folder somewhere permanent.

## Install from source

```bash
git clone <repository-url>
cd BetterStash
npm test
```

Then load the repository folder through `chrome://extensions` as described above. There is no
compile step and no runtime dependency on Node.js.

## Permissions and privacy

- `storage` stores settings locally in Chrome.
- `scripting` registers the content script for the selected site.
- Site access is optional and requested only after you select **Connect site**. The entered URL is
  reduced to its origin, such as `https://stash.example.com/*`.
- The extension reads the visible Bitbucket page only. It does not call Bitbucket APIs, collect
  analytics, or transmit data elsewhere.

See [PRIVACY.md](PRIVACY.md) for the complete privacy statement.

## Settings

- **Bitbucket Server URL** — the one origin on which the extension may run.
- **Your display name** — exactly as shown on reviewer avatars; comma-separate alternatives.
- **Team members** — display names to highlight, badge, or pin in the review list.
- **Auto-expand** — independently controls the review, personal, and recently closed sections.
- **Sections** — enables or disables the Blocked, Approved, and WIP tiers and row dimming.
- **Diff view** — enables a floating prev/next file control (and `[` / `]` shortcuts) on a pull
  request's Diff tab, for stepping through files in large PRs without hunting through the file
  tree.
- **Dashboard: Zen mode** — hides the sidebar and centers the main pull request list in a narrower
  column with generous side padding. A small floating toggle on the dashboard flips it on/off
  without opening settings; the state is remembered.

If **Approved by me** does not detect an approval, verify your display name first. Bitbucket DOM
markup varies by release, so sanitized HTML or screenshots are useful in bug reports.

Tiering never runs on a single pull request's own page (Overview/Diff/Commits/…) — only on
dashboard and list pages — so it can't reorder or hide anything while you're reviewing a diff.

## Development

Requirements: Node.js 18 or newer for repository checks. The extension itself uses plain HTML,
CSS, and JavaScript.

```bash
npm test
npm run check
./scripts/package.sh
```

The packaging script creates a validated release archive under `dist/`. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow.

## Releasing

Releases use semantic versioning and are generated from Git tags:

1. Update `version` in both `manifest.json` and `package.json`.
2. Move the relevant entries in `CHANGELOG.md` under the new version and date.
3. Run `npm test`, `npm run check`, and `./scripts/package.sh`.
4. Commit the release and create a matching tag, for example `v1.2.0`.
5. Push the commit and tag. GitHub Actions verifies the version and publishes the ZIP to a GitHub
   Release with generated release notes.

## Compatibility

The extension targets Chrome 96+ and Manifest V3. It is designed for Bitbucket Server/Data Center
dashboard markup; Atlassian can change that markup between versions. Bitbucket Cloud is not
currently supported.

## License

BetterStash is available under the [MIT License](LICENSE).
