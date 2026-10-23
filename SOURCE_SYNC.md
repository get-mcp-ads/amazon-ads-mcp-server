# Source synchronization

Reviewed on 2026-10-23 against getmcpads source revision `3e1c2c8`.

## Synchronized

- All 107 native Amazon Ads tools of the gateway, with the same names, parameters and native request bodies: Sponsored Products, Sponsored Brands and Sponsored Display reads and writes, Reporting v3, the creative asset library, asset uploads, product metadata and renames.
- The pinned write contracts `contracts/operations.json` and `contracts/sp-expression.json`, copied unchanged, with the same runtime rules: required parent IDs, single entity, paused creation, ownership checks, lossless 64-bit IDs and HTTP 207 handling.
- The endpoint allowlist, media type headers, report configurations, attribution rules, download bounds and media host rules of the Amazon client.

## Adapted for a self-hosted server

- Credentials come from `AMAZON_ADS_*` variables. The gateway's database lease for token renewal is replaced by an in-memory refresh shared by concurrent calls.
- The token URL follows Amazon's regional documentation (`api.amazon.com`, `api.amazon.co.uk`, `api.amazon.co.jp`) for the configured region. The gateway uses `api.amazon.com` for every region.
- One region is fixed at startup. Account IDs are plain profile IDs; the gateway's region-qualified form such as `EU:123` is accepted when the region matches.
- Preview, report and upload tokens are sealed with a key derived from the client secret and bound to the client ID and region, instead of the gateway's workspace key and organization.
- `amazon_ads_list_profiles` replaces the hosted account discovery and returns only allowlisted profiles.
- Report currency and timezone come from a cached profile read instead of stored connection metadata.
- Every fetch uses `redirect: "error"`. Provider error codes and details are returned with credentials redacted. A read that receives HTTP 401 renews the token once and repeats; a change is never repeated.
- Descriptions no longer mention plans or workspaces.

## Hosted only

Billing, plans and quotas, workspaces and stored account selection, token encryption at rest, the creative performance and creative trend views (`performance.ts`, `workspace-reports.ts`), creative galleries and reviews, MCP Apps UI, the campaign launcher, alerts, Google Sheets exports, client memory, telemetry and the discovery meta-tools are outside this repository. No native report tool depends on them.

Validation uses synthetic data. No live advertising write is required by the test suite. The generated server-card.json is the source of truth for this revision's tool schemas.

Maintainer: Emmanuel, getmcpads. Contact: hello@getmcpads.com.
