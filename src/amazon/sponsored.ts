/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
import { z } from "zod";
import { account, adGroupIds, campaignIds, id, nextToken, ok, pageSize, register, scoped, startIndex, stateFilter, type AmazonRuntime, type Collector } from "./shared.js";

export function registerAmazonSponsored(c: Collector, rt: AmazonRuntime): void {
  for (const [name, entity, media] of [["campaigns", "campaigns", "sbcampaignresource"], ["ad_groups", "adGroups", "sbadgroupresource"], ["ads", "ads", "sbadresource"]]) {
    register(c, `amazon_ads_get_sb_${name}`, `Read one page of Sponsored Brands ${name.replaceAll("_", " ")}. Requires Brands eligibility in this profile. Includes all states by default; follow nextToken. Configuration is not performance.`, {
      ...account, maxResults: pageSize, nextToken,
      ...(entity === "ads" ? { adIds: z.array(id).min(1).max(100).optional().describe("Restrict results to these Sponsored Brands ad IDs, as decimal strings.") } : {}),
      states: stateFilter, campaignIds,
    }, async a => {
      const { api, profileId } = scoped(rt, a.accountId);
      const response = await api.request<Record<string, unknown>>(`/sb/v4/${entity}/list`, profileId, "POST", {
        maxResults: a.maxResults, stateFilter: { include: a.states }, ...(a.nextToken ? { nextToken: a.nextToken } : {}),
        ...(a.campaignIds ? { campaignIdFilter: { include: a.campaignIds } } : {}),
        ...(a.adIds ? { adIdFilter: { include: a.adIds } } : {}),
      }, "application/json", `application/vnd.${media}.v4+json`);
      return ok({ ...response, accountId: profileId, adProduct: "SPONSORED_BRANDS", partial: Boolean(response.nextToken) });
    });
  }
  register(c, "amazon_ads_get_sb_ad_creatives", "Read native Sponsored Brands creative versions for one ad: headline, ASINs, brand logo and image or video asset references. Resolve asset IDs with amazon_ads_get_creative_asset and ASINs with amazon_ads_get_product_metadata. Requires Brands eligibility; no retail scraping.", {
    ...account, adId: id.describe("Sponsored Brands ad ID in the selected profile."), nextToken, maxResults: pageSize,
  }, async a => {
    const { api, profileId } = scoped(rt, a.accountId);
    const result = await api.request<Record<string, unknown>>("/sb/ads/creatives/list", profileId, "POST", { adId: a.adId, maxResults: a.maxResults, ...(a.nextToken ? { nextToken: a.nextToken } : {}) }, "application/json", "application/vnd.sbAdCreativeResource.v4+json");
    return ok({ ...result, accountId: profileId, adId: a.adId, partial: Boolean(result.nextToken) });
  });
  for (const [name, entity] of [["campaigns", "campaigns"], ["ad_groups", "adGroups"], ["product_ads", "productAds"], ["targets", "targets"], ["negative_targets", "negativeTargets"], ["creatives", "creatives"]]) {
    register(c, `amazon_ads_get_sd_${name}`, `Read one page of Sponsored Display ${name.replaceAll("_", " ")}. Requires Display eligibility. Pagination uses startIndex, not a cursor; full pages are conservatively marked partial. Creatives include native media references; these records are not performance metrics.`, {
      ...account, startIndex, count: z.number().int().min(1).max(100).default(100).describe("Maximum entities in this page, up to 100."),
      ...(entity === "creatives" ? { adGroupIds: z.array(id).min(1).max(100).describe("Sponsored Display ad group IDs whose creatives to read. Required by Amazon.") } : {}),
    }, async a => {
      const { api, profileId } = scoped(rt, a.accountId);
      const params = new URLSearchParams({ startIndex: String(a.startIndex), count: String(a.count) });
      if (a.adGroupIds) params.set("adGroupIdFilter", a.adGroupIds.join(","));
      const rows = await api.request<unknown[]>(`/sd/${entity}?${params}`, profileId);
      if (!Array.isArray(rows)) throw new Error("Amazon returned an invalid Sponsored Display list.");
      return ok({ accountId: profileId, adProduct: "SPONSORED_DISPLAY", [entity]: rows, partial: rows.length === a.count,
        nextStartIndex: rows.length === a.count ? a.startIndex + rows.length : null });
    });
  }
}

export function registerAmazonTargetingReads(c: Collector, rt: AmazonRuntime): void {
  register(c, "amazon_ads_get_brands", "List brands eligible for Sponsored Brands in this selected profile. Use the returned brandEntityId in campaign and creative configuration; never invent a brand ID.", account, async a => {
    const { api, profileId } = scoped(rt, a.accountId);
    return ok({ accountId: profileId, brands: await api.request("/brands", profileId, "GET", undefined, "application/json", "application/vnd.brand.v3+json") });
  });
  for (const entity of ["keywords", "negativeKeywords", "targets", "negativeTargets"]) {
    const target = entity.includes("Targets") || entity === "targets", name = entity.replace(/[A-Z]/g, ch => `_${ch.toLowerCase()}`);
    const negative = entity.startsWith("negative");
    register(c, `amazon_ads_get_sb_${name}`, `List one page of Sponsored Brands ${name.replaceAll("_", " ")}, including archived entities. Follow the returned cursor or offset; one page is not the whole inventory.`, {
      ...account, campaignIds, adGroupIds,
      states: z.array(negative ? z.enum(["enabled", "archived"]) : z.enum(["enabled", "paused", "archived"])).min(1).max(3).default(negative ? ["enabled", "archived"] : ["enabled", "paused", "archived"])
        .describe(negative ? "States to include, in Amazon's lower case. Negative criteria are enabled or archived." : "States to include, in Amazon's lower case. Defaults to every state."),
      limit: z.number().int().min(1).max(100).default(100).describe("Maximum entities in this page, up to 100."),
      ...(target ? { nextToken } : { startIndex }),
    }, async a => {
      const { api, profileId } = scoped(rt, a.accountId);
      if (target) {
        const filters = [{ filterType: "TARGETING_STATE", values: a.states }, ...(a.campaignIds ? [{ filterType: "CAMPAIGN_ID", values: a.campaignIds }] : []), ...(a.adGroupIds ? [{ filterType: "AD_GROUP_ID", values: a.adGroupIds }] : [])];
        const r = await api.request<Record<string, unknown>>(`/sb/${entity}/list`, profileId, "POST", { filters, maxResults: a.limit, ...(a.nextToken ? { nextToken: a.nextToken } : {}) }, "application/json", entity === "targets" ? "application/vnd.sblisttargetsresponse.v3.2+json" : "application/vnd.sblistnegativetargetsresponse.v3.2+json");
        return ok({ ...r, accountId: profileId, partial: Boolean(r.nextToken) });
      }
      const params = new URLSearchParams({ startIndex: String(a.startIndex), count: String(a.limit), stateFilter: a.states.join(",") });
      if (a.campaignIds) params.set("campaignIdFilter", a.campaignIds.join(","));
      if (a.adGroupIds) params.set("adGroupIdFilter", a.adGroupIds.join(","));
      const rows = await api.request<unknown[]>(`/sb/${entity}?${params}`, profileId, "GET", undefined, "application/json", entity === "keywords" ? "application/vnd.sbkeyword.v3.2+json" : "application/vnd.sbnegativekeyword.v3.2+json");
      if (!Array.isArray(rows)) throw new Error("Amazon returned an invalid keyword list.");
      return ok({ accountId: profileId, [entity]: rows, partial: rows.length === a.limit, nextStartIndex: rows.length === a.limit ? a.startIndex + rows.length : null });
    });
  }
}
