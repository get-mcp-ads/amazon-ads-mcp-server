# Publishing releases

One tag publishes one version. The workflow in `.github/workflows/release.yml` runs the steps in the order the MCP Registry requires.

1. Bump the version in `package.json`, `server.json` and `PACKAGE_VERSION` in `src/server.ts`, add a `## X.Y.Z - YYYY-MM-DD` section to `CHANGELOG.md`, run `npm run catalog` and update the README. The test suite fails when these disagree.
2. Merge the reviewed change after CI succeeds.
3. Tag the merge commit `vX.Y.Z` and push the tag. The workflow then checks that the tag matches `package.json`, runs the audit, typecheck, build and tests, and:
   - publishes the npm package with provenance through trusted publishing, so no npm token is stored in the repository;
   - creates the GitHub release from the matching `CHANGELOG.md` section and marks it Latest;
   - publishes `server.json` to the MCP Registry under `com.getmcpads/amazon-ads`, authenticated by the DNS key of getmcpads.com.
4. Each step skips when its target already holds the version, so a partial release can be resumed with **Run workflow** and the existing tag.

Before the first release, configure a trusted publisher on npmjs.com for `@getmcpads/amazon-ads-mcp-server` that points at this repository and `release.yml`, and add the `MCP_DNS_PRIVATE_KEY` secret.

A GitHub source release does not by itself mean the npm package or the registry entry is available. The README distinguishes source installation from package installation.

Before tagging, add the release to CHANGELOG.md as `## X.Y.Z - YYYY-MM-DD - Title`, then run `npm run release-history`. The README shows every release from the changelog, and the test suite fails when it falls behind.
