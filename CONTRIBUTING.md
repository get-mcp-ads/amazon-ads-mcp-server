# Contributing

Thanks for considering a contribution. This project is maintained by [GetMCPAds](https://www.getmcpads.com) and is open to outside patches.

## Getting set up

```bash
git clone https://github.com/get-mcp-ads/amazon-ads-mcp-server.git
cd amazon-ads-mcp-server
npm ci
cp .env.example .env
```

Then run the checks:

```bash
npm run typecheck && npm run lint && npm run build && npm test
```

All four must pass. CI runs them on Node 22, 24 and 26.

## Ground rules

**Never commit a credential.** `.env` is gitignored. Before opening a PR, read your diff for anything starting with `Atza|` or `Atzr|`, the prefixes of Login with Amazon tokens, and for client secrets.

**Tests use synthetic data and a mocked `fetch`.** Do not add a test that needs live credentials; CI has none, and no test may change a live account.

**Write contracts are pinned.** Sponsored Brands and Display writes are validated against `src/amazon/contracts/operations.json`. When you change it, say in the PR which Amazon specification and date it comes from, as described in `src/amazon/contracts/README.md`.

**Write tools must preview first.** A new write accepts `confirm`, returns a preview when it is absent, binds the preview to the current entity and creates new entities paused. A tool that changes an account on its first call will not be merged.

**Keep the profile allowlist.** Every tool resolves its `accountId` through `scoped()` before any request, and discovery returns allowlisted profiles only.

**Keep signed URLs guarded.** `assertSafeProviderUrl` refuses anything that is not an HTTPS Amazon S3 host. Removing that check reopens a request-forgery path.

**Keep it self-contained.** Runtime dependencies are `@modelcontextprotocol/sdk` and `zod`. Adding a third needs a good reason.

**Write documentation in English without em dashes.** A test checks the published prose.

## Credentials never reach the logs or another host

Tests enforce this: one fails if any `fetch` omits `redirect: "error"` or a timeout, one fails if a host outside `src/core/hosts.ts` appears in the source, and one fails if a source file writes files.

## Commit and PR style

- One logical change per PR.
- Explain why, not only what. The diff already says what.
- If you fix a bug, add the test that would have caught it.

## Reporting bugs

Open an issue with what you called, what you expected and what you got. Redact profile IDs and tokens.

For anything security-related, do not open an issue. See [SECURITY.md](SECURITY.md).

## Licence

By contributing, you agree that your contributions are licensed under the Apache License 2.0, as stated in [LICENSE](LICENSE).
