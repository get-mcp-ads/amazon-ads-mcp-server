# Changelog

## 1.0.0 - 2026-10-23 - First standalone release
- Port the native Amazon Ads tools of the getmcpads gateway at revision `3e1c2c8`: 30 read tools for Sponsored Products, Sponsored Brands and Sponsored Display configuration, Reporting v3, the creative asset library and product metadata, 77 write tools and 3 resources.
- Add `amazon_ads_list_profiles`, which returns only the profiles in `AMAZON_ADS_PROFILE_IDS` and names configured profiles that Amazon did not return.
- Validate every Sponsored Brands and Display write against 39 pinned Amazon request contracts. Bind each preview token to the change and to the entity as read from Amazon, and refuse stale or changed confirmations.
- Create new campaigns, ad groups and ads paused. Mark a change that starts delivery with `activationMaySpend`.
- Read credentials from `AMAZON_ADS_*` variables. Renew access tokens in memory from the refresh token at the regional token URL, and never write a token to disk.
- Declare Amazon's regional API and token hosts in `src/core/hosts.ts`. Tests fail on a fetch without `redirect: "error"` or a timeout, and on any other host in the source.
- Require a Node.js release with the October 2026 security fixes, and warn on stderr when an older one runs the server.
- Publish each version from its tag: npm with provenance, the GitHub release, then the MCP Registry.
