/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AMAZON_REPORT_CATALOG } from "./catalog.js";
import { OPERATIONS, operationToolName } from "./native-management.js";
import { RENAME_MATRIX } from "./rename.js";
import { reportType } from "./reports.js";

const GUIDE = `Amazon Ads MCP server guide

Scope
- Only the advertising profiles listed in AMAZON_ADS_PROFILE_IDS are reachable, in the single region set by AMAZON_ADS_REGION (NA, EU or FE). Every tool checks the profile before any request.
- amazon_ads_list_profiles shows the configured profiles that these credentials can reach. Profiles outside the allowlist are never returned.

Reads
- Configuration lists return one page. Follow nextToken (Sponsored Products and Brands v4) or nextStartIndex (Sponsored Display and Brands keywords). One page is not an account total.
- Configuration records are not performance. Use amazon_ads_create_report, then amazon_ads_get_report after about 30 seconds. Reports cover at most 31 days and are asynchronous. A pending report is not an empty account.
- Money is in the profile currency, not micros. Sponsored Products purchases and sales use the attribution window you choose (1, 7, 14 or 30 days). Brands and Display use their native 14-day attribution. Never add up different windows.
- Large integer IDs are returned as strings so no digit is lost.

Writes
- Writes are registered only when AMAZON_ADS_ENABLE_WRITES is exactly true.
- Every write previews first. Most writes return a previewToken bound to the exact change and to the entity as read from Amazon. Confirm with confirm:true and that previewToken within ten minutes. A changed entity or request is refused.
- New Sponsored Products campaigns, ad groups, product ads, keywords and targets are created PAUSED. Sponsored Brands and Display creates with a state field must be paused; state-less creates require a paused parent. Negative keywords and targets start enabled because they suppress traffic.
- Enabling a campaign, ad group, ad, keyword or target can spend money; previews mark this with activationMaySpend. Archiving is irreversible.
- HTTP 207 with any item error is a failure. An interrupted change has an unknown outcome: read the entity before any retry. This server never retries a change automatically.

Renaming
${RENAME_MATRIX.map(r => `- ${r.level}: ${r.tool ?? "not available"}. ${"reason" in r ? r.reason : ""}${"limits" in r ? r.limits : ""}`.trimEnd()).join("\n")}

Media
- Uploads use a signed Amazon S3 URL. Amazon credentials are never sent to it. Registration does not approve an ad. Asset and product image URLs are returned as data from Amazon's own media hosts.

Not included
- DSP, Amazon Marketing Cloud, billing, account management, portfolios and the hosted getmcpads features (creative galleries, alerts, exports, campaign launcher).`;

export function registerAmazonResources(server: McpServer): void {
  server.registerResource("Amazon Ads guide", "amazon-ads://guide", { mimeType: "text/plain", description: "Scope, pagination, attribution, preview and confirmation rules for this server." },
    async uri => ({ contents: [{ uri: uri.href, mimeType: "text/plain", text: GUIDE }] }));
  server.registerResource("Amazon Ads report catalog", "amazon-ads://report-catalog", { mimeType: "application/json", description: "Report types, metric columns and grouping fields used by amazon_ads_create_report." },
    async uri => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ reportTypes: reportType.options, ...AMAZON_REPORT_CATALOG }, null, 2) }] }));
  server.registerResource("Amazon Ads write contracts", "amazon-ads://write-contracts", { mimeType: "application/json", description: "The pinned Amazon request contracts behind the Sponsored Brands and Display write tools." },
    async uri => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({
      source: "Amazon public OpenAPI specifications, extracted on 2026-09-16. See src/amazon/contracts/README.md.",
      operations: OPERATIONS.map(op => ({ tool: operationToolName(op), method: op.method, path: op.path, requestMediaType: op.media, responseMediaType: op.accept, envelope: op.wrap,
        fields: Object.keys(op.schema.properties ?? {}), required: op.schema.required ?? [] })),
    }, null, 2) }] }));
}
