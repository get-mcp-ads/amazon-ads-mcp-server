/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
export const AMAZON_REPORT_CATALOG = {
  metrics: [
    "impressions",
    "clicks",
    "cost",
    "purchases",
    "sales",
    "purchasesClicks",
    "salesClicks",
    ...[1, 7, 14, 30].flatMap((days) => [`purchases${days}d`, `sales${days}d`]),
  ].map((key) => ({
    key,
    description:
      "Native Amazon report field. Availability depends on report type: purchasesXd/salesXd are Sponsored Products click windows; unsuffixed purchases/sales and purchasesClicks/salesClicks retain Brands/Display native attribution. Cost and sales use profile currency.",
  })),
  dimensions: [
    "campaignId",
    "adGroupId",
    "adId",
    "date",
    "placementClassification",
    "searchTerm",
    "keywordId",
    "advertisedAsin",
    "advertisedSku",
    "promotedAsin",
    "promotedSku",
  ].map((key) => ({
    key,
    description:
      "Native grouping field, available only in compatible report types. Date is present in DAILY reports; SUMMARY covers the requested range. ASINs identify products, not uploaded creative assets.",
  })),
};
