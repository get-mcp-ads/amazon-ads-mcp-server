/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
import { z } from "zod";

// Verified against Amazon Reporting v3 campaign, search-term and advertised-product contracts.
export const reportType = z.enum(["spCampaigns", "spAdGroups", "spPlacements", "spSearchTerm", "spAdvertisedProduct", "sbCampaigns", "sbAds", "sbSearchTerm", "sdCampaigns", "sdAdvertisedProduct"]);
export type ReportType = z.infer<typeof reportType>;
export function reportConfiguration(type: ReportType, days: string, timeUnit: "DAILY" | "SUMMARY") {
  const sp = type.startsWith("sp"), sb = type.startsWith("sb");
  if (!sp && days !== "14") throw new Error("Brands and Display use their native 14-day attribution. Select attributionDays:14; their click and view metrics are not equivalent to Sponsored Products.");
  const extra: Record<ReportType, string[]> = {
    spCampaigns: [], spAdGroups: ["adGroupId", "adGroupName"], spPlacements: ["placementClassification"],
    spSearchTerm: ["adGroupId", "adGroupName", "keywordId", "keyword", "matchType", "targeting", "searchTerm"],
    spAdvertisedProduct: ["adGroupId", "adGroupName", "adId", "advertisedAsin", "advertisedSku"],
    sbCampaigns: [], sbAds: ["adGroupId", "adGroupName", "adId"], sbSearchTerm: ["adGroupId", "keywordId", "keywordText", "matchType", "searchTerm"],
    sdCampaigns: [], sdAdvertisedProduct: ["adGroupId", "adGroupName", "adId", "promotedAsin", "promotedSku"],
  };
  const groupBy = type === "sbAds" ? ["ads"] : type.endsWith("AdvertisedProduct") ? ["advertiser"] : type.endsWith("SearchTerm") ? ["searchTerm"] :
    type === "spAdGroups" ? ["campaign", "adGroup"] : type === "spPlacements" ? ["campaign", "campaignPlacement"] : ["campaign"];
  return { adProduct: sp ? "SPONSORED_PRODUCTS" : sb ? "SPONSORED_BRANDS" : "SPONSORED_DISPLAY", groupBy,
    columns: ["campaignId", "campaignName", ...extra[type], "impressions", "clicks", "cost",
      ...(sp ? [`purchases${days}d`, `sales${days}d`] : ["purchases", "sales", "purchasesClicks", "salesClicks"]),
      ...(timeUnit === "DAILY" ? ["date"] : ["startDate", "endDate"])],
    reportTypeId: type === "spAdGroups" || type === "spPlacements" ? "spCampaigns" : type, timeUnit, format: "GZIP_JSON" };
}
