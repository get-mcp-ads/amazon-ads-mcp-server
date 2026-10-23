<div align="center">

# Amazon Ads MCP server

### Bring your Amazon Ads profiles into your MCP client.

Read Sponsored Products, Brands and Display configuration, request performance reports and prepare changes for explicitly selected advertising profiles.

[![Release](https://img.shields.io/github/v/release/get-mcp-ads/amazon-ads-mcp-server?color=2448e5)](https://github.com/get-mcp-ads/amazon-ads-mcp-server/releases/latest)
[![CI](https://github.com/get-mcp-ads/amazon-ads-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/get-mcp-ads/amazon-ads-mcp-server/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-22.23.4%2B%20%7C%2024.22.1%2B%20%7C%2026.12.1%2B-brightgreen.svg)](package.json)

[Watch the film](https://www.getmcpads.com/home/film/get-mcp-ads-brand-film-1080p.mp4) · [What's new](#whats-new) · [Install](#install-this-release) · [Tool reference](#tools) · [Try hosted getmcpads](https://www.getmcpads.com/tools/amazon-ads?utm_source=github&utm_medium=readme&utm_campaign=amazon-ads)

[![Watch the getmcpads film: every ad account in one conversation with your AI assistant](https://www.getmcpads.com/home/film/brand-film-poster-promise.webp)](https://www.getmcpads.com/home/film/get-mcp-ads-brand-film-1080p.mp4)

**[Play the 45-second film](https://www.getmcpads.com/home/film/get-mcp-ads-brand-film-1080p.mp4)**

</div>

The film shows hosted getmcpads with sample data. Its MCP Apps, from creative galleries and alerts to Google Sheets exports and bulk launches, belong to the hosted product. This repository provides the standalone native API tools.

**31 read tools** · **77 write tools**, disabled by default.

Run locally with your own Login with Amazon application and a client that supports stdio MCP, such as Claude Desktop, Claude Code or Cursor. Your requests go directly to the Amazon Ads API. For managed connections, including supported ChatGPT setups, use the hosted option.

## What's new

<!-- release-history:start -->
**[v1.0.0: First standalone release](https://github.com/get-mcp-ads/amazon-ads-mcp-server/releases/tag/v1.0.0) · October 23, 2026**

- Port the native Amazon Ads tools of the getmcpads gateway at revision `3e1c2c8`: 30 read tools for Sponsored Products, Sponsored Brands and Sponsored Display configuration, Reporting v3, the creative asset library and product metadata, 77 write tools and 3 resources.
- Add `amazon_ads_list_profiles`, which returns only the profiles in `AMAZON_ADS_PROFILE_IDS` and names configured profiles that Amazon did not return.
- Validate every Sponsored Brands and Display write against 39 pinned Amazon request contracts. Bind each preview token to the change and to the entity as read from Amazon, and refuse stale or changed confirmations.
- Create new campaigns, ad groups and ads paused. Mark a change that starts delivery with `activationMaySpend`.
- Read credentials from `AMAZON_ADS_*` variables. Renew access tokens in memory from the refresh token at the regional token URL, and never write a token to disk.
- Declare Amazon's regional API and token hosts in `src/core/hosts.ts`. Tests fail on a fetch without `redirect: "error"` or a timeout, and on any other host in the source.
- Require a Node.js release with the October 2026 security fixes, and warn on stderr when an older one runs the server.
- Publish each version from its tag: npm with provenance, the GitHub release, then the MCP Registry.

[Full changelog](CHANGELOG.md) · [All releases](https://github.com/get-mcp-ads/amazon-ads-mcp-server/releases)
<!-- release-history:end -->

Source synchronization: [SOURCE_SYNC.md](SOURCE_SYNC.md).

### Upgrade notes

Requires **Node.js 22.23.4, 24.22.1, 26.12.1 or a newer release**. These carry the October 2026 security fixes, and the server prints a warning on stderr when it runs on an older one. CI covers Node 22, 24 and 26.

This is the first release. Arguments saved from hosted getmcpads use region-qualified account IDs such as `EU:1234567890`; they are accepted when the region matches `AMAZON_ADS_REGION`.

## Install this release

This is a GitHub source release. npm and MCP Registry versions are published separately. The commands below select this exact version; unpinned `npx` examples later in this document select the version currently available on npm.

```bash
git clone --branch v1.0.0 --depth 1 https://github.com/get-mcp-ads/amazon-ads-mcp-server.git
cd amazon-ads-mcp-server
npm ci
npm run build
```

Configure your MCP client to run `node` with the absolute path to `dist/cli.js` and the credentials documented below.

> **Prefer a managed connection?** [Use Amazon Ads with hosted getmcpads](https://www.getmcpads.com/tools/amazon-ads?utm_source=github&utm_medium=readme&utm_campaign=amazon-ads). Connect your account, select the data your assistant may access and use the hosted MCP connection. See the site for current features and plans.

## Configuration

Provide these environment variables through the client's secret configuration:

| Variable | Purpose |
|---|---|
| `AMAZON_ADS_CLIENT_ID` | Client ID of a Login with Amazon security profile that has Amazon Ads API access. |
| `AMAZON_ADS_CLIENT_SECRET` | Client secret of that security profile. |
| `AMAZON_ADS_REFRESH_TOKEN` | Refresh token from the authorization grant. It starts with `Atzr\|`. An access token (`Atza\|`) is refused, because it expires after an hour. |
| `AMAZON_ADS_REGION` | `NA`, `EU` or `FE`. Selects the API host and the token URL. Use the region of the profiles below. |
| `AMAZON_ADS_PROFILE_IDS` | Required comma-separated advertising profile IDs. Every other profile is refused before any request, reads included. |
| `AMAZON_ADS_ENABLE_WRITES` | Defaults to `false`. Only the exact value `true` exposes the write tools. |

To obtain these values, follow Amazon's own guides:

1. [Onboard to the Amazon Ads API](https://advertising.amazon.com/API/docs/en-us/guides/onboarding/overview) and note the client ID and secret of your Login with Amazon security profile.
2. [Create an authorization grant](https://advertising.amazon.com/API/docs/en-us/guides/get-started/create-authorization-grant) with the scope `advertising::campaign_management`, then [generate access and refresh tokens](https://advertising.amazon.com/API/docs/en-us/guides/get-started/retrieve-access-token). Amazon documents that refresh tokens issued on or after July 30, 2026 expire 365 days after advertiser consent.
3. [Retrieve your profile IDs](https://advertising.amazon.com/API/docs/en-us/guides/get-started/retrieve-profiles) and list the ones this server may use in `AMAZON_ADS_PROFILE_IDS`.

This package does not run an OAuth browser flow. It exchanges the refresh token for access tokens in memory, renews them a minute before they expire and keeps any refresh token Amazon returns in memory only. When the refresh token is revoked or expires, authorize again, update the variable and restart the server.

A Claude Desktop entry looks like this:

```json
{
  "mcpServers": {
    "amazon-ads": {
      "command": "npx",
      "args": ["-y", "@getmcpads/amazon-ads-mcp-server"],
      "env": {
        "AMAZON_ADS_CLIENT_ID": "amzn1.application-oa2-client.your-client-id",
        "AMAZON_ADS_CLIENT_SECRET": "your-client-secret",
        "AMAZON_ADS_REFRESH_TOKEN": "Atzr|your-refresh-token",
        "AMAZON_ADS_REGION": "EU",
        "AMAZON_ADS_PROFILE_IDS": "1234567890"
      }
    }
  }
}
```

With a source install, replace `npx` and its arguments with `node` and the absolute path to `dist/cli.js`. Run `npm run doctor` to check the configuration without contacting Amazon; it never prints a value.

## Safety and coverage

Writes preview by default. Most writes return a `previewToken` bound to the exact change and to the entity as read from Amazon at preview time. Repeat the call with `confirm: true` and that token within ten minutes. A changed request, a changed entity or an expired token is refused before anything is sent. `amazon_ads_update_campaign_status` uses `expectedStatus` from its preview instead, and the rename tools need only `confirm: true`.

New Sponsored Products campaigns, ad groups, product ads, keywords and targets are created paused. Sponsored Brands and Display creates that carry a state must be paused, and creates without a state field require a paused parent. Negative keywords and targets start enabled because they suppress traffic. Previews mark a change that starts delivery with `activationMaySpend`. Archiving is irreversible.

An HTTP 207 response with any item error is reported as a failure. A change whose outcome is uncertain is never retried automatically; read the entity and reconcile it first. A read that receives HTTP 401 renews the access token once and repeats; a change does not. HTTP 429 responses report Amazon's `Retry-After` value and are not retried.

The profile allowlist is checked before every request, and `amazon_ads_list_profiles` returns only allowlisted profiles. Unknown arguments are refused. Amounts are in the profile currency, not micros. Large integer IDs are kept as strings so no digit is lost. Configuration lists return one page and say so with `partial`; follow `nextToken` or `nextStartIndex`.

Reports are asynchronous. `amazon_ads_create_report` returns a `jobToken`; call `amazon_ads_get_report` about 30 seconds later. A pending report is not an empty account. Sponsored Products purchases and sales use the click attribution window you choose. Brands and Display use their native 14-day attribution. Report files and asset uploads use signed Amazon S3 URLs, which must be HTTPS S3 hosts, are fetched without any Amazon credential and never follow a redirect.

This server covers Sponsored Products, Sponsored Brands, Sponsored Display, Reporting v3, the creative asset library and product metadata. It does not cover DSP, Amazon Marketing Cloud, billing, account management or portfolios. Hosted creative galleries, alerts, exports, the campaign launcher and MCP Apps UI are excluded. Use `tools/list`, [server-card.json](server-card.json) or the `amazon-ads://write-contracts` resource for exact schemas, and [Amazon's API reference](https://advertising.amazon.com/API/docs/en-us/reference/api-overview) for provider details.

## Amazon's own MCP server

Amazon [announced the Amazon Ads MCP Server in open beta on February 2, 2026](https://advertising.amazon.com/library/news/amazon-ads-mcp-server-open-beta), for Amazon Ads partners with active API credentials. The comparison below uses only Amazon's own pages: the announcement, the [overview](https://advertising.amazon.com/API/docs/en-us/mcp/mcp-overview), [Connecting to the Amazon Ads MCP Server](https://advertising.amazon.com/API/docs/en-us/mcp/get-started), [the Lite version](https://advertising.amazon.com/API/docs/en-us/mcp/get-started-lite), [Connecting using OAuth 2.1](https://advertising.amazon.com/API/docs/en-us/mcp/oauth) and the [MCP tool reference](https://advertising.amazon.com/API/docs/en-us/mcp/campaign-management), as read on October 23, 2026.

| | Amazon Ads MCP Server | This server |
|---|---|---|
| Where it runs | Hosted by Amazon at regional endpoints such as `https://advertising-ai.amazon.com/mcp`, built and updated by Amazon Ads. | Runs on your machine over stdio and calls the Amazon Ads API directly. |
| Credentials | A Login with Amazon access token and client ID in request headers, or OAuth 2.1 with a browser login. | Client ID, client secret and refresh token in environment variables. Access tokens are renewed in memory. |
| Account selection | Dynamic mode, where the assistant supplies account identifiers, or fixed mode, where headers pin one account. | A fixed allowlist of profile IDs in one region, checked before every request. |
| Coverage | Tool groups for account management, campaign management, reporting, billing, Amazon Marketing Cloud, eligibility, users and more, plus skills and a Lite version with three discovery tools. | Sponsored Products, Brands and Display entities, Reporting v3, the creative asset library and product metadata, as 108 individual tools. |
| Writes | Campaign management tools that create, update and delete. Amazon's guide shows how to disable individual tools, such as `delete_campaign`, in the Kiro CLI configuration. | Off unless `AMAZON_ADS_ENABLE_WRITES=true`. Every write previews first, and new campaigns, ad groups and ads are created paused. |

Use Amazon's server for DSP, Amazon Marketing Cloud, billing or account management, which this server does not cover.

## Hosted option

[getmcpads for Amazon Ads](https://www.getmcpads.com/tools/amazon-ads?utm_source=github&utm_medium=readme&utm_campaign=amazon-ads) manages the hosted connection and account selection.
Hosted and source releases can differ. Contact: hello@getmcpads.com.

## Development

```bash
npm run typecheck
npm run lint
npm run build
npm test
npm run catalog
```

All tests run offline with a mocked `fetch` and synthetic responses. No live account is read or changed.

## Tools

Every tool is listed below. See [server-card.json](server-card.json) for complete parameter and output schemas.

<details>
<summary><b>31 read tools</b></summary>

**Profiles**

| Tool | Purpose |
| --- | --- |
| `amazon_ads_list_profiles` | List the advertising profiles in AMAZON_ADS_PROFILE_IDS that these credentials can reach in AMAZON_ADS_REGION, with marketplace, account type, currency and timezone. |
| `amazon_ads_get_profile` | Read the selected Amazon Ads profile: marketplace, account type, currency and timezone. |

**Sponsored Products configuration**

| Tool | Purpose |
| --- | --- |
| `amazon_ads_get_campaigns` | Read one page of Amazon Sponsored Products campaigns, including paused and archived entities by default. |
| `amazon_ads_get_ad_groups` | Read one page of Amazon Sponsored Products ad groups, including paused and archived entities by default. |
| `amazon_ads_get_product_ads` | Read one page of Amazon Sponsored Products product ads, including paused and archived entities by default. |
| `amazon_ads_get_keywords` | Read one page of Amazon Sponsored Products keywords, including paused and archived entities by default. |
| `amazon_ads_get_targets` | Read one page of Amazon Sponsored Products targets, including paused and archived entities by default. |
| `amazon_ads_get_negative_keywords` | Read one page of Amazon Sponsored Products negative keywords, including paused and archived entities by default. |
| `amazon_ads_get_negative_targets` | Read one page of Amazon Sponsored Products negative targets, including paused and archived entities by default. |
| `amazon_ads_get_campaign_negative_keywords` | Read one page of Amazon Sponsored Products campaign negative keywords, including paused and archived entities by default. |
| `amazon_ads_get_campaign_negative_targets` | Read one page of Amazon Sponsored Products campaign negative targets, including paused and archived entities by default. |

**Sponsored Brands configuration**

| Tool | Purpose |
| --- | --- |
| `amazon_ads_get_brands` | List brands eligible for Sponsored Brands in this selected profile. |
| `amazon_ads_get_sb_campaigns` | Read one page of Sponsored Brands campaigns. |
| `amazon_ads_get_sb_ad_groups` | Read one page of Sponsored Brands ad groups. |
| `amazon_ads_get_sb_ads` | Read one page of Sponsored Brands ads. |
| `amazon_ads_get_sb_ad_creatives` | Read native Sponsored Brands creative versions for one ad: headline, ASINs, brand logo and image or video asset references. |
| `amazon_ads_get_sb_keywords` | List one page of Sponsored Brands keywords, including archived entities. |
| `amazon_ads_get_sb_negative_keywords` | List one page of Sponsored Brands negative keywords, including archived entities. |
| `amazon_ads_get_sb_targets` | List one page of Sponsored Brands targets, including archived entities. |
| `amazon_ads_get_sb_negative_targets` | List one page of Sponsored Brands negative targets, including archived entities. |

**Sponsored Display configuration**

| Tool | Purpose |
| --- | --- |
| `amazon_ads_get_sd_campaigns` | Read one page of Sponsored Display campaigns. |
| `amazon_ads_get_sd_ad_groups` | Read one page of Sponsored Display ad groups. |
| `amazon_ads_get_sd_product_ads` | Read one page of Sponsored Display product ads. |
| `amazon_ads_get_sd_targets` | Read one page of Sponsored Display targets. |
| `amazon_ads_get_sd_negative_targets` | Read one page of Sponsored Display negative targets. |
| `amazon_ads_get_sd_creatives` | Read one page of Sponsored Display creatives. |

**Reporting**

| Tool | Purpose |
| --- | --- |
| `amazon_ads_create_report` | Request an asynchronous Amazon performance report: Sponsored Products campaigns, ad groups, placements, search terms or advertised products; Brands campaigns, ads or search terms; Display campaigns or products. |
| `amazon_ads_get_report` | Check an Amazon report once and, when complete, read its native rows. |

**Creative assets and catalog**

| Tool | Purpose |
| --- | --- |
| `amazon_ads_list_creative_assets` | Search the Amazon creative asset library: images, logos and videos, native download or playback URLs, sizes and moderation metadata. |
| `amazon_ads_get_creative_asset` | Refresh one native Amazon image or video asset in the selected profile. |
| `amazon_ads_get_product_metadata` | Read advertised product titles, native image URLs, stock, price and eligibility from the advertiser's Amazon catalog. |

</details>

<details>
<summary><b>77 write tools</b></summary>

Registered only with `AMAZON_ADS_ENABLE_WRITES=true`. Every call previews unless `confirm: true` is passed, and most writes also need the `previewToken` from that preview.

**Sponsored Products**

| Tool | Purpose |
| --- | --- |
| `amazon_ads_create_campaign` | Create one Sponsored Products campaign in PAUSED state. |
| `amazon_ads_update_campaign` | Update Sponsored Products campaign name, state, dates or bidding strategy. |
| `amazon_ads_update_campaign_budget` | Change one Sponsored Products daily budget in profile currency. |
| `amazon_ads_update_campaign_status` | Pause or enable one Amazon Sponsored Products campaign. |
| `amazon_ads_create_ad_group` | Create a PAUSED Sponsored Products ad group with a default bid in profile currency. |
| `amazon_ads_update_ad_group` | Update one Sponsored Products ad group: state and bid. |
| `amazon_ads_create_product_ad` | Create one Sponsored Products product ad. |
| `amazon_ads_update_product_ad` | Update one Sponsored Products product ad: state. |
| `amazon_ads_create_keyword` | Create one Sponsored Products keyword. |
| `amazon_ads_update_keyword` | Update one Sponsored Products keyword: state and bid. |
| `amazon_ads_create_target` | Create one Sponsored Products target. |
| `amazon_ads_update_target` | Update one Sponsored Products target: state and bid. |
| `amazon_ads_create_negative_keyword` | Create one Sponsored Products negative keyword. |
| `amazon_ads_update_negative_keyword` | Change the state of a Sponsored Products negative keyword. |
| `amazon_ads_create_negative_target` | Create one Sponsored Products negative target. |
| `amazon_ads_update_negative_target` | Change the state of a Sponsored Products negative target. |
| `amazon_ads_create_campaign_negative_keyword` | Create one Sponsored Products campaign negative keyword. |
| `amazon_ads_update_campaign_negative_keyword` | Change the state of a Sponsored Products campaign negative keyword. |
| `amazon_ads_create_campaign_negative_target` | Create one Sponsored Products campaign negative target. |
| `amazon_ads_update_campaign_negative_target` | Change the state of a Sponsored Products campaign negative target. |

**Sponsored Brands**

| Tool | Purpose |
| --- | --- |
| `amazon_ads_create_sb_campaign` | Create one Sponsored Brands campaign. |
| `amazon_ads_update_sb_campaign` | Update one Sponsored Brands campaign. |
| `amazon_ads_create_sb_ad_group` | Create one Sponsored Brands ad group. |
| `amazon_ads_update_sb_ad_group` | Update one Sponsored Brands ad group. |
| `amazon_ads_update_sb_ad` | Update one Sponsored Brands ad. |
| `amazon_ads_create_sb_ad_product_collection` | Create one Sponsored Brands product collection ad. |
| `amazon_ads_create_sb_ad_product_collection_extended` | Create one Sponsored Brands product collection extended ad. |
| `amazon_ads_create_sb_ad_video` | Create one Sponsored Brands video ad. |
| `amazon_ads_create_sb_ad_brand_video` | Create one Sponsored Brands brand video ad. |
| `amazon_ads_create_sb_ad_store_spotlight` | Create one Sponsored Brands store spotlight ad. |
| `amazon_ads_create_sb_ad_auto_collection` | Create one Sponsored Brands auto collection ad. |
| `amazon_ads_create_sb_ad_manual_collection` | Create one Sponsored Brands manual collection ad. |
| `amazon_ads_update_sb_ad_creative_product_collection` | Replace the creative of one Sponsored Brands product collection ad. |
| `amazon_ads_update_sb_ad_creative_product_collection_extended` | Replace the creative of one Sponsored Brands product collection extended ad. |
| `amazon_ads_update_sb_ad_creative_video` | Replace the creative of one Sponsored Brands video ad. |
| `amazon_ads_update_sb_ad_creative_brand_video` | Replace the creative of one Sponsored Brands brand video ad. |
| `amazon_ads_update_sb_ad_creative_store_spotlight` | Replace the creative of one Sponsored Brands store spotlight ad. |
| `amazon_ads_update_sb_ad_creative_auto_collection` | Replace the creative of one Sponsored Brands auto collection ad. |
| `amazon_ads_update_sb_ad_creative_manual_collection` | Replace the creative of one Sponsored Brands manual collection ad. |
| `amazon_ads_create_sb_keyword` | Create one Sponsored Brands keyword. |
| `amazon_ads_update_sb_keyword` | Update one Sponsored Brands keyword. |
| `amazon_ads_create_sb_negative_keyword` | Create one Sponsored Brands negative keyword. |
| `amazon_ads_update_sb_negative_keyword` | Update one Sponsored Brands negative keyword. |
| `amazon_ads_create_sb_target` | Create one Sponsored Brands target. |
| `amazon_ads_update_sb_target` | Update one Sponsored Brands target. |
| `amazon_ads_create_sb_negative_target` | Create one Sponsored Brands negative target. |
| `amazon_ads_update_sb_negative_target` | Update one Sponsored Brands negative target. |

**Sponsored Display**

| Tool | Purpose |
| --- | --- |
| `amazon_ads_create_sd_campaign` | Create one Sponsored Display campaign. |
| `amazon_ads_update_sd_campaign` | Update one Sponsored Display campaign. |
| `amazon_ads_create_sd_ad_group` | Create one Sponsored Display ad group. |
| `amazon_ads_update_sd_ad_group` | Update one Sponsored Display ad group. |
| `amazon_ads_create_sd_product_ad` | Create one Sponsored Display product ad. |
| `amazon_ads_update_sd_product_ad` | Update one Sponsored Display product ad. |
| `amazon_ads_create_sd_target` | Create one Sponsored Display target. |
| `amazon_ads_update_sd_target` | Update one Sponsored Display target. |
| `amazon_ads_create_sd_negative_target` | Create one Sponsored Display negative target. |
| `amazon_ads_update_sd_negative_target` | Update one Sponsored Display negative target. |
| `amazon_ads_create_sd_creative` | Create one Sponsored Display creative. |
| `amazon_ads_update_sd_creative` | Update one Sponsored Display creative. |

**Archive (irreversible)**

| Tool | Purpose |
| --- | --- |
| `amazon_ads_archive_sb_campaign` | Permanently archive one Sponsored Brands campaign. |
| `amazon_ads_archive_sb_ad_group` | Permanently archive one Sponsored Brands ad group. |
| `amazon_ads_archive_sb_ad` | Permanently archive one Sponsored Brands ad. |
| `amazon_ads_archive_sb_keyword` | Permanently archive one Sponsored Brands keyword. |
| `amazon_ads_archive_sb_negative_keyword` | Permanently archive one Sponsored Brands negative keyword. |
| `amazon_ads_archive_sb_target` | Permanently archive one Sponsored Brands target. |
| `amazon_ads_archive_sb_negative_target` | Permanently archive one Sponsored Brands negative target. |
| `amazon_ads_archive_sd_campaign` | Permanently archive one Sponsored Display campaign. |
| `amazon_ads_archive_sd_ad_group` | Permanently archive one Sponsored Display ad group. |
| `amazon_ads_archive_sd_product_ad` | Permanently archive one Sponsored Display product ad. |
| `amazon_ads_archive_sd_target` | Permanently archive one Sponsored Display target. |
| `amazon_ads_archive_sd_negative_target` | Permanently archive one Sponsored Display negative target. |

**Creative asset uploads**

| Tool | Purpose |
| --- | --- |
| `amazon_ads_prepare_asset_upload` | Prepare an Amazon image or video upload for this profile. |
| `amazon_ads_upload_asset_bytes` | Upload supplied image or video bytes to the native S3 URL bound to the opaque uploadToken from amazon_ads_prepare_asset_upload. |
| `amazon_ads_register_uploaded_asset` | Register bytes already uploaded to the Amazon URL from amazon_ads_prepare_asset_upload. |

**Renames**

| Tool | Purpose |
| --- | --- |
| `amazon_ads_rename_campaign` | Rename one Amazon Sponsored Products, Brands or Display campaign. |
| `amazon_ads_rename_ad_group` | Rename one Amazon Sponsored Products, Brands or Display ad group. |
| `amazon_ads_rename_ad` | Rename one Amazon Sponsored Brands ad. |

</details>

### Resources

| Resource | Content |
| --- | --- |
| `amazon-ads://guide` | Scope, pagination, attribution, preview and confirmation rules, and the renaming matrix. |
| `amazon-ads://report-catalog` | Report types, metric columns and grouping fields used by `amazon_ads_create_report`. |
| `amazon-ads://write-contracts` | The 39 pinned Amazon request contracts behind the Sponsored Brands and Display write tools. |

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE).

## More from getmcpads

[Meta Ads](https://github.com/get-mcp-ads/meta-ads-mcp-server) · [Google Ads](https://github.com/get-mcp-ads/google-ads-mcp-server) · [Google Analytics 4](https://github.com/get-mcp-ads/google-analytics-mcp-server) · [Google Search Console](https://github.com/get-mcp-ads/google-search-console-mcp-server) · [TikTok Ads](https://github.com/get-mcp-ads/tiktok-ads-mcp-server) · [Pinterest Ads](https://github.com/get-mcp-ads/pinterest-ads-mcp-server) · [X Ads](https://github.com/get-mcp-ads/x-ads-mcp-server)

Maintained by **Emmanuel** at [getmcpads](https://www.getmcpads.com). Questions: [hello@getmcpads.com](mailto:hello@getmcpads.com).
