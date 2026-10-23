import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadReport } from "../../src/amazon/tools.js";
import { amazonAsset, amazonMediaUrl } from "../../src/amazon/assets.js";
import { reportConfiguration } from "../../src/amazon/reports.js";
import { data, mockAmazon, reply, toolkit } from "./helpers.js";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
// Changes a fully used character of the authentication tag.
const tamper = (token: string) => { const parts = token.split("."); parts[1] = (parts[1][0] === "A" ? "B" : "A") + parts[1].slice(1); return parts.join("."); };

describe("profile scope", () => {
  it("sends the exact scope to the fixed regional host and preserves pagination", async () => {
    const { calls } = mockAmazon(() => reply({ campaigns: [{ campaignId: "7" }], nextToken: "next" }));
    expect(data(await toolkit()("get_campaigns").handler({ accountId: "123", nextToken: "previous" }))).toMatchObject({ partial: true, nextToken: "next", accountId: "123" });
    expect(calls[0].url).toBe("https://advertising-api-eu.amazon.com/sp/campaigns/list");
    expect(calls[0]).toMatchObject({ method: "POST", headers: { "Amazon-Advertising-API-Scope": "123", accept: "application/vnd.spCampaign.v3+json" } });
    expect(calls[0].body).toMatchObject({ nextToken: "previous", maxResults: 100, stateFilter: { include: ["ENABLED", "PAUSED", "ARCHIVED"] } });
  });

  it("accepts the region-qualified form only for the configured region", async () => {
    const { calls } = mockAmazon(() => reply({ campaigns: [] }));
    await toolkit()("get_campaigns").handler({ accountId: "EU:123" });
    expect(calls[0].headers["Amazon-Advertising-API-Scope"]).toBe("123");
    await expect(toolkit()("get_campaigns").handler({ accountId: "NA:123" })).rejects.toThrow("Regions cannot be interchanged");
  });

  it("rejects unselected profiles, malformed IDs and extra arguments before HTTP", async () => {
    const { fetcher } = mockAmazon(() => reply({}));
    const tool = toolkit()("get_campaigns");
    for (const accountId of ["456", "EU:456", "0123", "EU:../123", "123/../456"]) await expect(tool.handler({ accountId })).rejects.toThrow();
    await expect(tool.handler({ accountId: "123", profileId: "456" })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("checks the allowlist on every read tool", async () => {
    const { fetcher } = mockAmazon(() => reply({}));
    const get = toolkit();
    for (const name of ["get_profile", "get_brands", "get_sb_campaigns", "get_sd_campaigns", "get_sb_keywords", "list_creative_assets", "get_product_metadata"]) {
      await expect(get(name).handler({ accountId: "456" })).rejects.toThrow("not selected");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("Brands and Display reads", () => {
  it("uses startIndex pagination for Display and marks full pages partial", async () => {
    const { calls } = mockAmazon(() => reply([{ campaignId: 1 }, { campaignId: 2 }]));
    expect(data(await toolkit()("get_sd_campaigns").handler({ accountId: "123", count: 2 }))).toMatchObject({ partial: true, nextStartIndex: 2, adProduct: "SPONSORED_DISPLAY" });
    expect(calls[0].url).toBe("https://advertising-api-eu.amazon.com/sd/campaigns?startIndex=0&count=2");
  });

  it("uses versioned Brands media types and native lower-case states", async () => {
    const { calls } = mockAmazon(() => reply([]));
    const get = toolkit();
    await get("get_brands").handler({ accountId: "123" });
    expect(calls[0].headers.accept).toBe("application/vnd.brand.v3+json");
    await get("get_sb_negative_keywords").handler({ accountId: "123" });
    expect(calls[1].url).toContain("stateFilter=enabled%2Carchived");
    await expect(get("get_sb_negative_keywords").handler({ accountId: "123", states: ["paused"] })).rejects.toThrow();
  });

  it("filters Brands ads by ID and follows the cursor", async () => {
    const { calls } = mockAmazon(() => reply({ ads: [{ adId: "9" }], nextToken: "n2" }));
    expect(data(await toolkit()("get_sb_ads").handler({ accountId: "123", adIds: ["9"] }))).toMatchObject({ partial: true, nextToken: "n2", adProduct: "SPONSORED_BRANDS" });
    expect(calls[0].body).toMatchObject({ adIdFilter: { include: ["9"] } });
    expect(calls[0].headers.accept).toBe("application/vnd.sbadresource.v4+json");
  });
});

describe("reports", () => {
  const args = { accountId: "123", startDate: "2026-09-01", endDate: "2026-09-03", attributionDays: "7" };
  const signed = "https://reports.s3.eu-west-1.amazonaws.com/file?X-Amz-Signature=private-signature";

  it("creates a bound job, polls once and downloads without credentials", async () => {
    let status = 0;
    const { calls } = mockAmazon(call => {
      if (call.path === "/reporting/reports") return reply({ reportId: "job-1" });
      if (call.path === "/reporting/reports/job-1") return reply(status++ === 0 ? { status: "PENDING" } : { status: "COMPLETED", url: signed });
      if (call.path === "/v2/profiles/123") return reply({ profileId: 123, currencyCode: "EUR", timezone: "Europe/Paris" });
      return new Response(gzipSync('[{"cost":12.5,"sales7d":100,"campaignId":123456789012345678},{"cost":20}]'));
    });
    const get = toolkit();
    const job = data(await get("create_report").handler(args));
    expect(job.jobToken).not.toContain("job-1");
    expect(calls[0].body.configuration).toMatchObject({ reportTypeId: "spCampaigns", groupBy: ["campaign"], format: "GZIP_JSON", columns: expect.arrayContaining(["sales7d", "purchases7d"]) });
    expect(calls[0].headers["content-type"]).toBe("application/vnd.createasyncreportrequest.v3+json");
    expect(data(await get("get_report").handler({ accountId: "123", jobToken: job.jobToken })).status).toBe("PENDING");
    expect(calls).toHaveLength(2);
    const report = data(await get("get_report").handler({ accountId: "123", jobToken: job.jobToken, limit: 1 }));
    expect(report).toMatchObject({ rows: [{ cost: 12.5, sales7d: 100, campaignId: "123456789012345678" }], partial: true, nextOffset: 1, totalRows: 2, attributionDays: "7", currency: "EUR", timezone: "Europe/Paris", monetaryUnit: "Profile currency (not micros)" });
    const download = calls.find(c => c.url === signed)!;
    expect(download.init.headers).toBeUndefined();
    expect(download.init.redirect).toBe("error");
    expect(JSON.stringify(report)).not.toContain("private-signature");
  });

  it("rejects tampered tokens, other profiles and other configurations before HTTP", async () => {
    const { calls } = mockAmazon(() => reply({ reportId: "job-1" }));
    const { jobToken } = data(await toolkit({ allowedProfileIds: ["123", "456"] })("create_report").handler(args));
    calls.length = 0;
    await expect(toolkit({ allowedProfileIds: ["123", "456"] })("get_report").handler({ accountId: "456", jobToken })).rejects.toThrow("does not belong");
    await expect(toolkit()("get_report").handler({ accountId: "123", jobToken: tamper(jobToken) })).rejects.toThrow("Invalid");
    await expect(toolkit({ clientSecret: "another-secret" })("get_report").handler({ accountId: "123", jobToken })).rejects.toThrow("Invalid");
    await expect(toolkit({ region: "NA" })("get_report").handler({ accountId: "123", jobToken })).rejects.toThrow("Invalid");
    expect(calls).toHaveLength(0);
  });

  it("rejects invalid ranges and windows before HTTP", async () => {
    const { calls } = mockAmazon(() => reply({}));
    for (const endDate of ["2026-08-31", "2026-10-02", "2026-02-30"]) await expect(toolkit()("create_report").handler({ ...args, endDate })).rejects.toThrow();
    await expect(toolkit()("create_report").handler({ ...args, reportType: "sbCampaigns" })).rejects.toThrow("native 14-day");
    expect(calls).toHaveLength(0);
  });

  it("refuses unsafe download hosts, redirected downloads and missing report IDs", async () => {
    const { calls } = mockAmazon(() => new Response(null, { status: 302 }));
    for (const url of ["http://reports.s3.amazonaws.com/f", "https://127.0.0.1/f", "https://reports.s3.amazonaws.com.evil.org/f", "https://user@reports.s3.amazonaws.com/f", "https://169.254.169.254/f"]) await expect(downloadReport(url)).rejects.toThrow("not allowed");
    expect(calls).toHaveLength(0);
    await expect(downloadReport("https://reports.s3.amazonaws.com/f")).rejects.toThrow("redirect");
    mockAmazon(() => reply({}));
    await expect(toolkit()("create_report").handler(args)).rejects.toThrow("invalid report ID");
  });

  it("uses native dimensions and refuses invented Brands attribution windows", () => {
    expect(reportConfiguration("spAdvertisedProduct", "7", "SUMMARY")).toMatchObject({ reportTypeId: "spAdvertisedProduct", groupBy: ["advertiser"], columns: expect.arrayContaining(["advertisedAsin", "adId", "sales7d"]) });
    expect(reportConfiguration("spPlacements", "14", "DAILY")).toMatchObject({ reportTypeId: "spCampaigns", groupBy: ["campaign", "campaignPlacement"] });
    expect(reportConfiguration("sbSearchTerm", "14", "SUMMARY").columns).toContain("salesClicks");
    expect(() => reportConfiguration("sbCampaigns", "7", "SUMMARY")).toThrow("native 14-day");
  });
});

describe("visual inventory", () => {
  const assetId = "amzn1.assetlibrary.asset1.123abc";
  const image = "https://m.media-amazon.com/images/I/product.jpg";
  const asset = { assetId, assetType: "IMAGE", name: "Logo", fileMetadata: { width: 400, height: 400 }, storageLocationUrls: { defaultUrl: image } };

  it("uses the native asset search cursor and distinct request and response media types", async () => {
    const { calls } = mockAmazon(() => reply({ assetList: [asset], token: "next", totalRecords: 2 }));
    const result = data(await toolkit()("list_creative_assets").handler({ accountId: "123", nextToken: "previous", assetType: "IMAGE", limit: 8 }));
    expect(result).toMatchObject({ partial: true, nextToken: "next", assets: [{ platform: "amazon_ads", nativeAssetId: assetId, thumbnail: image }] });
    expect(calls[0].body).toMatchObject({ pageCriteria: { size: 8, identifier: { token: "previous" } }, filterCriteria: { valueFilters: [{ valueField: "ASSET_TYPE", values: ["IMAGE"] }] } });
    expect(calls[0].headers).toMatchObject({ "content-type": "application/json", accept: "application/vnd.creativeassetssearchassetsresponse.v3+json", "Amazon-Advertising-API-Scope": "123" });
  });

  it("rejects mismatched assets and invalid native IDs", async () => {
    const { calls } = mockAmazon(() => reply({ assetGlobal: { assetId: "wrong" }, assetVersionList: [] }));
    await expect(toolkit()("get_creative_asset").handler({ accountId: "123", assetId })).rejects.toThrow("mismatch");
    calls.length = 0;
    await expect(toolkit()("get_creative_asset").handler({ accountId: "123", assetId: "../../secret" })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("keeps native video variants and refuses foreign media hosts", () => {
    const video = amazonAsset({ ...asset, assetType: "VIDEO", storageLocationUrls: { defaultUrl: "https://m.media-amazon.com/images/S/video.mov", processedUrls: { MP4_720: "https://m.media-amazon.com/images/S/video.mp4" } } });
    expect(video).toMatchObject({ kind: "video", thumbnail: null, video: "https://m.media-amazon.com/images/S/video.mp4" });
    for (const url of ["https://m.media-amazon.com.evil.test/image.png", "http://m.media-amazon.com/image.png", "https://user:password@m.media-amazon.com/image.png", "https://127.0.0.1/image.png"]) expect(amazonMediaUrl(url)).toBeNull();
  });

  it("requests product images, metadata and eligibility with conservative pagination", async () => {
    const { calls } = mockAmazon(() => reply({ ProductMetadataList: [{ asin: "B0018OFKJS", imageUrl: image, title: "Product" }] }));
    const result = data(await toolkit()("get_product_metadata").handler({ accountId: "123", asins: ["B0018OFKJS"], limit: 1 }));
    expect(result).toMatchObject({ partial: true, nextPageIndex: 1, assets: [{ nativeAssetId: "B0018OFKJS", name: "Product", thumbnail: image }] });
    expect(calls[0].body).toMatchObject({ checkItemDetails: true, checkEligibility: true, pageIndex: 0, pageSize: 1 });
    await expect(toolkit()("get_product_metadata").handler({ accountId: "123", asins: ["B0018OFKJS"], search: "shoe" })).rejects.toThrow("not both");
  });
});
