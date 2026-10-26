# Changelog

## 1.0.1 - 2026-10-26 - Zod 4 security update
- Update `zod` to 4.6.7. Every Zod release before 4.6.6 is covered by the high-severity advisory GHSA-mrhx-c7xc-m3w5: validating an oversized constrained collection can exhaust memory, and no Zod 3 release carries the fix. `npm audit --omit=dev` reports no vulnerability again.
- Keep the Zod 3 validation behaviour. A parameter default is still validated and completed before use, so an omitted object must still supply its required fields.
- Keep each parameter's own description when the parameter is optional or has a default. Zod 4 stores a description on the wrapped schema only, so the shared fallback description could otherwise replace it.
- Tool names, parameters and descriptions published over MCP are unchanged. `server-card.json` is regenerated with Zod 4's JSON Schema output, which spells some constraints differently.

## 1.0.0 - 2026-10-23 - First standalone release
- Port the native Amazon Ads tools of the getmcpads gateway at revision `3e1c2c8`: 30 read tools for Sponsored Products, Sponsored Brands and Sponsored Display configuration, Reporting v3, the creative asset library and product metadata, 77 write tools and 3 resources.
- Add `amazon_ads_list_profiles`, which returns only the profiles in `AMAZON_ADS_PROFILE_IDS` and names configured profiles that Amazon did not return.
- Validate every Sponsored Brands and Display write against 39 pinned Amazon request contracts. Bind each preview token to the change and to the entity as read from Amazon, and refuse stale or changed confirmations.
- Create new campaigns, ad groups and ads paused. Mark a change that starts delivery with `activationMaySpend`.
- Read credentials from `AMAZON_ADS_*` variables. Renew access tokens in memory from the refresh token at the regional token URL, and never write a token to disk.
- Declare Amazon's regional API and token hosts in `src/core/hosts.ts`. Tests fail on a fetch without `redirect: "error"` or a timeout, and on any other host in the source.
- Require a Node.js release with the October 2026 security fixes, and warn on stderr when an older one runs the server.
- Publish each version from its tag: npm with provenance, the GitHub release, then the MCP Registry.
