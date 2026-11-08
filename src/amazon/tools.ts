/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { assertSafeProviderUrl } from "../core/hosts.js";
import { readBounded, refuseRedirect, ResponseTooLargeError } from "../core/http.js";
import { parseAmazonJson } from "../core/json.js";
import type { AmazonProfile } from "./client.js";
import { account, campaignIds, date, failed, id, nextToken, ok, pageSize, register, scoped, stateFilter, states, type AmazonRuntime, type Collector } from "./shared.js";
import { registerAmazonAssets } from "./assets.js";
import { registerAmazonAssetUploads } from "./asset-upload.js";
import { registerAmazonNativeManagement } from "./native-management.js";
import { registerAmazonManagement } from "./management.js";
import { registerAmazonRenames } from "./rename.js";
import { registerAmazonSponsored, registerAmazonTargetingReads } from "./sponsored.js";
import { reportType, reportConfiguration, type ReportType } from "./reports.js";

const ENTITIES = [
  ["campaigns", "campaigns", "spCampaign"], ["ad_groups", "adGroups", "spAdGroup"],
  ["product_ads", "productAds", "spProductAd"], ["keywords", "keywords", "spKeyword"],
  ["targets", "targets", "spTargetingClause"],
  ["negative_keywords", "negativeKeywords", "spNegativeKeyword"],
  ["negative_targets", "negativeTargets", "spNegativeTargetingClause"],
  ["campaign_negative_keywords", "campaignNegativeKeywords", "spCampaignNegativeKeyword"],
  ["campaign_negative_targets", "campaignNegativeTargets", "spCampaignNegativeTargetingClause"],
] as const;
type Campaign = { campaignId: string; name: string; state: string };

async function campaign(rt: AmazonRuntime, accountId: string, campaignId: string) {
  const { api, profileId } = scoped(rt, accountId);
  const data = await api.request<{ campaigns: Campaign[] }>("/sp/campaigns/list", profileId, "POST", {
    campaignIdFilter: { include: [campaignId] }, stateFilter: { include: ["ENABLED", "PAUSED", "ARCHIVED"] }, maxResults: 1,
  }, "application/vnd.spCampaign.v3+json");
  const found = data.campaigns?.find(c => String(c.campaignId) === campaignId);
  if (!found) throw new Error("Campaign is not accessible in this Amazon profile.");
  return found;
}

function profileSummary(profile: AmazonProfile) {
  return {
    profileId: String(profile.profileId), countryCode: profile.countryCode ?? null, currencyCode: profile.currencyCode ?? null, timezone: profile.timezone ?? null,
    accountInfo: { name: profile.accountInfo?.name ?? null, type: profile.accountInfo?.type ?? null, marketplaceStringId: profile.accountInfo?.marketplaceStringId ?? null, id: profile.accountInfo?.id ?? null },
  };
}

export function registerAmazonReads(c: Collector, rt: AmazonRuntime): void {
  register(c, "amazon_ads_list_profiles", "List the advertising profiles in AMAZON_ADS_PROFILE_IDS that these credentials can reach in AMAZON_ADS_REGION, with marketplace, account type, currency and timezone. Profiles outside the allowlist are never returned or counted. Configured IDs that Amazon does not return are listed in missingProfileIds.", {}, async () => {
    const profiles = await rt.api.profiles();
    const selected = profiles.filter(p => rt.allowedProfileIds.includes(String(p.profileId)));
    const found = new Set(selected.map(p => String(p.profileId)));
    return ok({ region: rt.region, profiles: selected.map(profileSummary), missingProfileIds: rt.allowedProfileIds.filter(p => !found.has(p)), selectedProfilesOnly: true,
      ...(found.size < rt.allowedProfileIds.length ? { message: "Some configured profiles were not returned. They may belong to another region or may not have granted access to this application." } : {}) });
  });
  registerAmazonAssets(c, rt);
  registerAmazonSponsored(c, rt);
  registerAmazonTargetingReads(c, rt);
  register(c, "amazon_ads_get_profile", "Read the selected Amazon Ads profile: marketplace, account type, currency and timezone. API access does not establish eligibility for Sponsored Brands, Display or DSP.", account, async a => {
    const { profileId, region } = scoped(rt, a.accountId);
    const profile = await rt.profile(profileId);
    return ok({ accountId: profileId, region, profile });
  });
  for (const [name, entity, media] of ENTITIES) register(c, `amazon_ads_get_${name}`,
    `Read one page of Amazon Sponsored Products ${name.replaceAll("_", " ")}, including paused and archived entities by default. Continue with nextToken until absent; one page is not an account total. These are configuration records, not performance metrics.`, {
      ...account, maxResults: pageSize, nextToken, states: stateFilter, campaignIds,
    }, async a => {
      const { api, profileId } = scoped(rt, a.accountId);
      const data = await api.request<Record<string, unknown>>(`/sp/${entity}/list`, profileId, "POST", {
        maxResults: a.maxResults, ...(a.nextToken ? { nextToken: a.nextToken } : {}), stateFilter: { include: a.states },
        ...(a.campaignIds ? { campaignIdFilter: { include: a.campaignIds } } : {}),
      }, `application/vnd.${media}.v3+json`);
      return ok({ accountId: profileId, adProduct: "SPONSORED_PRODUCTS", ...data, partial: Boolean(data.nextToken) });
    });

  register(c, "amazon_ads_create_report", "Request an asynchronous Amazon performance report: Sponsored Products campaigns, ad groups, placements, search terms or advertised products; Brands campaigns, ads or search terms; Display campaigns or products. Brands legacy campaign reports exclude multi-ad-group campaigns. Does not change advertising or budgets. Choose the attribution window explicitly, keep jobToken and call amazon_ads_get_report later. No polling loop, no cross-platform attribution and no automatic sums.", {
    ...account,
    startDate: date.describe("First day of the report, YYYY-MM-DD, in the profile timezone."),
    endDate: date.describe("Last day of the report, YYYY-MM-DD, at most 30 days after startDate."),
    reportType: reportType.prefault("spCampaigns").describe("Native report type. sp* reports cover Sponsored Products, sb* Sponsored Brands and sd* Sponsored Display."),
    attributionDays: z.enum(["1", "7", "14", "30"]).describe("Native click attribution window in days for purchases and sales. Brands and Display accept 14 only. Never compare different windows as equivalent."),
    timeUnit: z.enum(["DAILY", "SUMMARY"]).prefault("DAILY").describe("Daily rows, or one aggregate row per grouping over the requested range."),
  }, async a => {
    const days = (Date.parse(a.endDate) - Date.parse(a.startDate)) / 86_400_000;
    if (days < 0 || days >= 31) throw new Error("Choose an ordered range of at most 31 days; Amazon also enforces report retention.");
    const { api, profileId } = scoped(rt, a.accountId);
    const configuration = reportConfiguration(a.reportType, a.attributionDays, a.timeUnit);
    const { columns } = configuration;
    const result = await api.request<{ reportId: string }>("/reporting/reports", profileId, "POST", {
      name: `amazon-ads-mcp ${a.reportType} ${a.startDate} ${a.endDate}`, startDate: a.startDate, endDate: a.endDate,
      configuration,
    }, "application/vnd.createasyncreportrequest.v3+json");
    if (typeof result.reportId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(result.reportId)) throw new Error("Amazon returned an invalid report ID.");
    const jobToken = rt.sealer.seal("report", { profileId, reportId: result.reportId, reportType: a.reportType, timeUnit: a.timeUnit, startDate: a.startDate, endDate: a.endDate, attributionDays: a.attributionDays, expires: Date.now() + 7 * 86_400_000 });
    return ok({ status: "PENDING", jobToken, accountId: profileId, columns, nextAction: { tool: "amazon_ads_get_report", retryAfterSeconds: 30 } });
  });
  register(c, "amazon_ads_get_report", "Check an Amazon report once and, when complete, read its native rows. Use only the jobToken returned by amazon_ads_create_report for this profile. Downloads are bounded; pagination returns row offsets and marks partial results. Expired reports must be requested again.", {
    ...account,
    jobToken: z.string().min(1).max(8192).describe("Opaque job token returned by amazon_ads_create_report for this profile. Valid for seven days."),
    offset: z.number().int().min(0).max(1_000_000).prefault(0).describe("Zero-based index of the first row to return. Use nextOffset from the previous call."),
    limit: z.number().int().min(1).max(1000).prefault(500).describe("Maximum rows returned by this call, up to 1000."),
  }, async a => {
    const { api, profileId } = scoped(rt, a.accountId);
    const job = rt.sealer.unseal("report", a.jobToken) as { profileId?: string; reportId?: string; expires?: number; startDate?: string; endDate?: string; attributionDays?: string; reportType?: ReportType; timeUnit?: string } | null;
    if (!job) throw new Error("Invalid Amazon report job token.");
    if (job.profileId !== profileId || !Number.isFinite(job.expires) || Number(job.expires) < Date.now() || !/^[a-zA-Z0-9-]{1,100}$/.test(String(job.reportId))) throw new Error("Amazon report does not belong to this profile or has expired. Request it again.");
    const report = await api.request<{ status: string; url?: string; failureReason?: string }>(`/reporting/reports/${job.reportId}`, profileId);
    if (report.status !== "COMPLETED") return ok({ status: report.status, accountId: profileId,
      ...(report.status === "FAILED" ? { failed: true, message: "Amazon could not generate this report. Check dates and account eligibility." } : { jobToken: a.jobToken, nextAction: { tool: "amazon_ads_get_report", retryAfterSeconds: 30 } }) });
    if (!report.url) throw new Error("Amazon report is complete but has no download URL.");
    const rows = await downloadReport(report.url);
    let currency: string | null = null, timezone: string | null = null;
    try { const p = await rt.profile(profileId); currency = p.currencyCode ?? null; timezone = p.timezone ?? null; } catch { /* the rows remain valid without profile metadata */ }
    return ok({ status: "COMPLETED", accountId: profileId, startDate: job.startDate, endDate: job.endDate,
      reportType: job.reportType ?? "spCampaigns", timeUnit: job.timeUnit ?? "DAILY", attributionDays: job.attributionDays, monetaryUnit: "Profile currency (not micros)", currency, timezone,
      rows: rows.slice(a.offset, a.offset + a.limit), totalRows: rows.length, partial: a.offset > 0 || a.offset + a.limit < rows.length,
      nextOffset: a.offset + a.limit < rows.length ? a.offset + a.limit : null });
  });
}

const MAX_REPORT_GZIP = 10 * 1024 * 1024;
const MAX_REPORT_JSON = 50 * 1024 * 1024;

/**
 * Downloads a completed report from the signed URL Amazon returned. The URL
 * is data: it must pass assertSafeProviderUrl, the request carries no Amazon
 * credential and no redirect is followed.
 */
export async function downloadReport(rawUrl: string): Promise<unknown[]> {
  const url = assertSafeProviderUrl(rawUrl, "report download");
  let response: Response;
  try {
    response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new Error("Amazon report download failed; request a fresh report status before retrying.");
  }
  refuseRedirect(response, "Amazon report storage");
  if (!response.ok || !response.body) throw new Error("Amazon report download failed; request a fresh report status before retrying.");
  let decoded: Buffer;
  try {
    const compressed = await readBounded(response, MAX_REPORT_GZIP);
    decoded = gunzipSync(compressed, { maxOutputLength: MAX_REPORT_JSON });
  } catch (error) {
    throw new Error(error instanceof ResponseTooLargeError || (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE"
      ? "Amazon report exceeds the download limit. Request a shorter date range." : "Amazon report download could not be decoded.");
  }
  const rows = parseAmazonJson(decoded.toString("utf8"));
  if (!Array.isArray(rows)) throw new Error("Amazon report is not a row array.");
  return rows;
}

export function registerAmazonWrites(c: Collector, rt: AmazonRuntime): void {
  registerAmazonManagement(c, rt);
  registerAmazonNativeManagement(c, rt);
  registerAmazonAssetUploads(c, rt);
  registerAmazonRenames(c, rt);
  register(c, "amazon_ads_update_campaign_status", "Pause or enable one Amazon Sponsored Products campaign. Enabling can spend money. Preview first, then confirm with expectedStatus from the preview. Amazon enforces profile membership; archived campaigns cannot be restored.", {
    ...account,
    campaignId: id.describe("Sponsored Products campaign ID in the selected profile."),
    status: z.enum(["ENABLED", "PAUSED"]).describe("ENABLED starts delivery and can spend; PAUSED stops delivery."),
    expectedStatus: states.optional().describe("Current state from the preview, required when confirming."),
    confirm: z.boolean().prefault(false).describe("False previews. True applies the exact change explicitly approved by the user."),
  }, async a => {
    const before = await campaign(rt, a.accountId, a.campaignId);
    const { api, profileId } = scoped(rt, a.accountId);
    const change = { accountId: profileId, campaignId: a.campaignId, name: before.name, currentStatus: before.state, newStatus: a.status, activationMaySpend: a.status === "ENABLED" };
    if (!a.confirm) return ok({ applied: false, change, message: "Preview only. Repeat with confirm:true and expectedStatus after explicit user approval." });
    if (before.state === "ARCHIVED") throw new Error("Archived campaigns cannot be restored.");
    if (!a.expectedStatus || a.expectedStatus !== before.state) throw new Error("Expected status is missing or stale. Preview again.");
    if (before.state === a.status) return ok({ applied: false, unchanged: true, change });
    const result = await api.request<{ campaigns?: { success?: { campaignId: string }[]; error?: unknown[] } }>("/sp/campaigns", profileId, "PUT", { campaigns: [{ campaignId: a.campaignId, state: a.status }] }, "application/vnd.spCampaign.v3+json");
    if (result.campaigns?.error?.length || !result.campaigns?.success?.some(s => String(s.campaignId) === a.campaignId)) return failed({ applied: false, change, result, message: "Amazon did not acknowledge a successful campaign update. Read the campaign before retrying." });
    try { const after = await campaign(rt, a.accountId, a.campaignId); return ok({ applied: true, change, observedStatus: after.state, verified: after.state === a.status }); }
    catch { return ok({ applied: true, change, verified: false, message: "Update acknowledged. Read campaign status before retrying." }); }
  });
}

