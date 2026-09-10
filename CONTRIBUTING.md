# Contributing

Contributions and sanitized bug reports are welcome.

## Development workflow

1. Fork the repository and create a focused branch.
2. Make the change without adding private Bitbucket URLs, names, repository data, or screenshots.
3. Run:

   ```bash
   npm test
   npm run check
   ./scripts/package.sh
   ```

4. Load the repository as an unpacked extension and verify the affected dashboard behavior.
5. Open a pull request describing the behavior and the Bitbucket Server/Data Center version used.

The codebase deliberately has no runtime dependencies or build step. Keep new permissions to the
minimum required and explain any manifest permission change in the pull request.

## Reporting DOM compatibility issues

Bitbucket markup differs between versions. Include the extension version, Bitbucket version, and
the smallest sanitized DOM excerpt that reproduces the issue. Remove company names, URLs, user
names, project keys, and repository data before posting.
