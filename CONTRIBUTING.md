# Contributing

Contributions and sanitized bug reports are welcome.

## Development workflow

1. Fork the repository and create a focused branch.
2. Make the change without adding private Bitbucket URLs, names, repository data, or screenshots.
3. Run:

   ```bash
   npm ci
   npm test
   npm run check
   ./scripts/package.sh
   ```

4. Load the repository as an unpacked extension and verify the affected dashboard behavior.
5. Open a pull request describing the behavior and the Bitbucket Server/Data Center version used.

The codebase deliberately has no runtime dependencies or build step. Keep new permissions to the
minimum required and explain any manifest permission change in the pull request.
Safari packaging requires macOS with full Xcode; run `./scripts/package-safari.sh`. CI builds
both browsers. See [SAFARI.md](SAFARI.md) for the developer installation steps.

## Reporting DOM compatibility issues

Bitbucket markup differs between versions. Include the extension version, Bitbucket version, and
the smallest sanitized DOM excerpt that reproduces the issue. Remove company names, URLs, user
names, project keys, and repository data before posting.

## Code layout

- `shared.js`: settings defaults and small DOM helpers.
- `dashboard.js`: identity, team matching, row classification, grouping, and expansion.
- `layout.js`: zen mode and reversible status-label placement.
- `diff.js`: file navigation, folder controls, and shortcut hints.
- `content.js`: startup, settings changes, and page observation.
- `background.js`: optional site registration; `options.js`: settings form.

Content scripts load in the order declared in `background.js`, sharing one `BetterStash`
namespace in the browser's isolated world. Feature factories receive the same settings object.
DOM regression tests use jsdom as a development dependency; release archives contain no dependencies.

Browser packaging shares the file list and manifest conversion in `scripts/extension.mjs`.
Chrome and Safari package scripts stage those files without copying tests or dependencies.
