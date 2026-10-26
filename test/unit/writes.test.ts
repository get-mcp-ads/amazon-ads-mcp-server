import { afterEach, describe, expect, it, vi } from "vitest";
import { collect, data, mockAmazon, mutations, reply, toolkit, type Call } from "./helpers.js";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const accountId = "123", assetId = "amzn1.assetlibrary.asset1.image";
// Zod 4 keeps a description on the schema that received it, so read through optional and default wrappers.
function describedAs(schema: unknown): string | undefined {
  for (let current: any = schema; current; current = current._zod?.def?.innerType ?? current._zod?.def?.in) if (current.description) return current.description;
  return undefined;
}
async function confirm(name: string, args: Record<string, unknown>, get = toolkit()) {
  const preview = data(await get(name).handler(args));
  return get(name).handler({ ...args, confirm: true, previewToken: preview.previewToken });
}

describe("write tool contract", () => {
  it("gives every write a confirm flag that defaults to preview", () => {
    const writes = collect().filter(t => t.write);
    expect(writes).toHaveLength(77);
    for (const tool of writes) expect(tool.shape.confirm.parse(undefined), tool.name).toBe(false);
  });

  it("gives every parameter an explicit description", () => {
    for (const tool of collect()) for (const [key, schema] of Object.entries(tool.shape)) expect(describedAs(schema), `${tool.name}.${key}`).toBeTruthy();
  });

  it("refuses incomplete or unselected calls on every write before any request", async () => {
    const { fetcher } = mockAmazon(() => reply({}));
    for (const tool of collect().filter(t => t.write)) {
      await expect(tool.handler({ accountId: "456" }), tool.name).rejects.toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("Sponsored Products status", () => {
  const args = { accountId, campaignId: "7", status: "PAUSED" };
  const current = { campaigns: [{ campaignId: "7", name: "Test", state: "ENABLED" }] };

  it("previews only and refuses stale confirmation", async () => {
    const { calls } = mockAmazon(() => reply(current));
    expect(data(await toolkit()("update_campaign_status").handler(args))).toMatchObject({ applied: false, change: { currentStatus: "ENABLED", activationMaySpend: false } });
    await expect(toolkit()("update_campaign_status").handler({ ...args, confirm: true, expectedStatus: "PAUSED" })).rejects.toThrow("stale");
    expect(mutations(calls)).toHaveLength(0);
  });

  it("flags activation as able to spend", async () => {
    mockAmazon(() => reply({ campaigns: [{ campaignId: "7", name: "Test", state: "PAUSED" }] }));
    expect(data(await toolkit()("update_campaign_status").handler({ ...args, status: "ENABLED" })).change.activationMaySpend).toBe(true);
  });

  it("treats 207 item errors as failures", async () => {
    let n = 0;
    mockAmazon(() => n++ === 0 ? reply(current) : reply({ campaigns: { error: [{ code: "FORBIDDEN" }], success: [] } }, 207));
    const result = await toolkit()("update_campaign_status").handler({ ...args, confirm: true, expectedStatus: "ENABLED" });
    expect(result).toHaveProperty("isError", true);
    expect(data(result).applied).toBe(false);
  });

  it("writes once and verifies readback", async () => {
    const replies = [reply(current), reply({ campaigns: { success: [{ campaignId: "7" }], error: [] } }, 207), reply({ campaigns: [{ campaignId: "7", state: "PAUSED" }] })];
    const { calls } = mockAmazon(() => replies.shift()!);
    expect(data(await toolkit()("update_campaign_status").handler({ ...args, confirm: true, expectedStatus: "ENABLED" }))).toMatchObject({ applied: true, verified: true });
    expect(calls[1]).toMatchObject({ method: "PUT", path: "/sp/campaigns", body: { campaigns: [{ campaignId: "7", state: "PAUSED" }] } });
  });

  it("rejects foreign campaigns", async () => {
    mockAmazon(() => reply({ campaigns: [{ campaignId: "8" }] }));
    await expect(toolkit()("update_campaign_status").handler(args)).rejects.toThrow("not accessible");
  });
});

describe("Sponsored Products management", () => {
  const create = { accountId, name: "New", targetingType: "MANUAL", dailyBudget: 20, startDate: "2026-09-20" };

  it("previews without HTTP, creates paused only after the exact confirmation, and checks HTTP 207 items", async () => {
    const { calls, fetcher } = mockAmazon(() => reply({ campaigns: { success: [{ campaignId: "7", index: 0 }], error: [] } }, 207));
    const get = toolkit();
    const preview = data(await get("create_campaign").handler(create));
    expect(fetcher).not.toHaveBeenCalled();
    expect(preview.change.proposed.state).toBe("PAUSED");
    expect(preview.activationMaySpend).toBe(false);
    await expect(get("create_campaign").handler({ ...create, dailyBudget: 21, confirm: true, previewToken: preview.previewToken })).rejects.toThrow("changed");
    await expect(get("create_campaign").handler({ ...create, confirm: true })).rejects.toThrow("preview token");
    await expect(toolkit({ clientSecret: "other-secret" })("create_campaign").handler({ ...create, confirm: true, previewToken: preview.previewToken })).rejects.toThrow("preview token");
    expect(data(await get("create_campaign").handler({ ...create, confirm: true, previewToken: preview.previewToken }))).toMatchObject({ applied: true, entityId: "7" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "POST", path: "/sp/campaigns", headers: { "content-type": "application/vnd.spCampaign.v3+json" } });
    expect(calls[0].body.campaigns[0]).toMatchObject({ state: "PAUSED", budget: { budgetType: "DAILY", budget: 20 } });
  });

  it("refuses an expired preview", async () => {
    mockAmazon(() => reply({}));
    const get = toolkit();
    const preview = data(await get("create_campaign").handler(create));
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 11 * 60_000);
    await expect(get("create_campaign").handler({ ...create, confirm: true, previewToken: preview.previewToken })).rejects.toThrow("expired");
  });

  it("refuses stale budget previews before any mutation", async () => {
    let budget = 20;
    const { calls } = mockAmazon(() => reply({ campaigns: [{ campaignId: "7", state: "ENABLED", budget: { budgetType: "DAILY", budget } }] }));
    const args = { accountId, campaignId: "7", dailyBudget: 30 };
    const preview = data(await toolkit()("update_campaign_budget").handler(args));
    budget = 25;
    await expect(toolkit()("update_campaign_budget").handler({ ...args, confirm: true, previewToken: preview.previewToken })).rejects.toThrow("changed");
    expect(mutations(calls)).toHaveLength(0);
  });

  it("refuses an ad group from a different campaign and a product without one ASIN or SKU", async () => {
    mockAmazon(call => call.path.includes("adGroups") ? reply({ adGroups: [{ adGroupId: "8", campaignId: "99", state: "PAUSED" }] }) : reply({ campaigns: [{ campaignId: "7", state: "PAUSED", targetingType: "MANUAL" }] }));
    await expect(toolkit()("create_keyword").handler({ accountId, campaignId: "7", adGroupId: "8", keywordText: "shoe", matchType: "EXACT", bid: 1 })).rejects.toThrow("does not belong");
    await expect(toolkit()("create_product_ad").handler({ accountId, campaignId: "7", adGroupId: "8" })).rejects.toThrow("exactly one");
  });

  it("does not treat item-level errors in a 207 as success or retry them", async () => {
    const { calls } = mockAmazon(() => reply({ campaigns: { success: [], error: [{ index: 0, errors: [{ errorType: "invalidValue" }] }] } }, 207));
    const result = await confirm("create_campaign", create);
    expect(result).toHaveProperty("isError", true);
    expect(calls).toHaveLength(1);
  });

  it("supports category refinements and never sends an ASIN shortcut together with expressions", async () => {
    mockAmazon(call => call.path.includes("adGroups") ? reply({ adGroups: [{ adGroupId: "8", campaignId: "7", state: "PAUSED" }] }) : reply({ campaigns: [{ campaignId: "7", state: "PAUSED", targetingType: "MANUAL" }] }));
    const args = { accountId, campaignId: "7", adGroupId: "8", bid: 0.3, expression: [{ type: "ASIN_CATEGORY_SAME_AS", value: "123" }, { type: "ASIN_PRICE_LESS_THAN", value: "25" }] };
    const preview = data(await toolkit()("create_target").handler(args));
    expect(preview.change.proposed).toMatchObject({ expression: args.expression, expressionType: "MANUAL", state: "PAUSED" });
    await expect(toolkit()("create_target").handler({ ...args, asin: "B0018OFKJS" })).rejects.toThrow("exactly one");
  });

  it("flags enabling a keyword as able to spend, and negatives as not", async () => {
    mockAmazon(call => reply(call.path.startsWith("/sp/keywords") ? { keywords: [{ keywordId: "5", state: "PAUSED", bid: 1 }] } : { negativeKeywords: [{ keywordId: "6", state: "ENABLED" }] }));
    expect(data(await toolkit()("update_keyword").handler({ accountId, entityId: "5", state: "ENABLED" })).activationMaySpend).toBe(true);
    expect(data(await toolkit()("update_negative_keyword").handler({ accountId, entityId: "6", state: "ENABLED" })).activationMaySpend).toBe(false);
  });

  it("refuses to change archived entities", async () => {
    mockAmazon(() => reply({ adGroups: [{ adGroupId: "8", state: "ARCHIVED" }] }));
    await expect(toolkit()("update_ad_group").handler({ accountId, entityId: "8", state: "ENABLED" })).rejects.toThrow("Archived");
  });
});

describe("Sponsored Brands and Display contracts", () => {
  it.each(["sb", "sd"])("previews %s campaign creation, rejects enabled creates and binds scope and payload", async family => {
    const payload = family === "sb" ? { name: "Test", budget: 2, budgetType: "DAILY", state: "PAUSED" } : { name: "Test", budget: 2, budgetType: "daily", state: "paused", tactic: "T00030" };
    const { calls, fetcher } = mockAmazon(() => reply(family === "sb" ? { campaigns: { success: [{ campaignId: "7" }], error: [] } } : [{ code: "SUCCESS", campaignId: 7 }], 207));
    const name = `create_${family}_campaign`, args = { accountId, payload };
    const get = toolkit();
    const preview = data(await get(name).handler(args));
    expect(fetcher).not.toHaveBeenCalled();
    await expect(get(name).handler({ ...args, accountId: "NA:123" })).rejects.toThrow("Regions");
    await expect(get(name).handler({ ...args, payload: { ...payload, state: family === "sb" ? "ENABLED" : "enabled" } })).rejects.toThrow();
    await expect(get(name).handler({ ...args, payload: { ...payload, unknownField: 1 } })).rejects.toThrow();
    await expect(get(name).handler({ ...args, payload: { ...payload, budget: 99 }, confirm: true, previewToken: preview.previewToken })).rejects.toThrow("changed");
    expect(data(await confirm(name, args, get))).toMatchObject({ applied: true, entityId: "7" });
    expect(calls).toHaveLength(1);
  });

  it("requires the exact Display parent and preserves native int64 wire IDs", async () => {
    const large = "123456789012345678";
    const { calls } = mockAmazon(call => call.method === "GET" ? reply({ campaignId: large, state: "paused" }) : reply([{ code: "SUCCESS", adGroupId: 8 }], 207));
    expect(data(await confirm("create_sd_ad_group", { accountId, payload: { campaignId: large, name: "Group", state: "paused" } }))).toMatchObject({ applied: true, entityId: "8" });
    expect(String(mutations(calls)[0].init.body)).toContain(`"campaignId":${large}`);
    await expect(toolkit()("create_sd_ad_group").handler({ accountId, payload: { campaignId: 123456789012345678, name: "Group", state: "paused" } })).rejects.toThrow();
  });

  it("preserves Display audience expressions and combined creative properties", async () => {
    mockAmazon(call => call.path.includes("adGroups") ? reply({ adGroupId: 8, campaignId: 7, state: "paused" }) : reply({ campaignId: 7, state: "paused" }));
    const target = data(await toolkit()("create_sd_target").handler({ accountId, payload: { adGroupId: "8", state: "paused", expressionType: "manual", expression: [{ type: "asinSameAs", value: "B0018OFKJS" }], bid: 0.3 } }));
    expect(target.change.proposed.expression).toEqual([{ type: "asinSameAs", value: "B0018OFKJS" }]);
    const properties = { headline: "Test", brandLogo: { assetId, assetVersion: "_v1" } };
    expect(data(await toolkit()("create_sd_creative").handler({ accountId, payload: { adGroupId: "8", properties } })).change.proposed.properties).toEqual(properties);
    await expect(toolkit()("create_sd_creative").handler({ accountId, payload: { adGroupId: "8", properties: { unknown: "bad" } } })).rejects.toThrow();
  });

  it("refuses cross-campaign creation and state-less creation under enabled parents", async () => {
    mockAmazon(call => call.path.includes("adGroups") ? reply({ adGroups: [{ adGroupId: "8", campaignId: "7", state: "ENABLED" }] }) : reply({ campaigns: [{ campaignId: "7", state: "ENABLED" }] }));
    await expect(toolkit()("create_sb_keyword").handler({ accountId, payload: { adGroupId: "8", campaignId: "9", keywordText: "test", matchType: "exact" } })).rejects.toThrow("does not belong");
    await expect(toolkit()("create_sb_keyword").handler({ accountId, payload: { adGroupId: "8", campaignId: "7", keywordText: "test", matchType: "exact" } })).rejects.toThrow("Pause its parent");
  });

  it("does not treat a native item error as success and never retries it", async () => {
    const { calls } = mockAmazon(() => reply([{ code: "INVALID_ARGUMENT", description: "Bad campaign" }], 207));
    const result = await confirm("create_sd_campaign", { accountId, payload: { name: "Test", budget: 2, budgetType: "daily", state: "paused", tactic: "T00030" } });
    expect(result).toHaveProperty("isError", true);
    expect(calls).toHaveLength(1);
  });

  it("sends a Brands video ad as a bulk envelope and its creative revision as a single object", async () => {
    const { calls } = mockAmazon(call => {
      if (call.path === "/sb/v4/adGroups/list") return reply({ adGroups: [{ adGroupId: "8", campaignId: "7", state: "PAUSED" }] });
      if (call.path === "/sb/v4/campaigns/list") return reply({ campaigns: [{ campaignId: "7", state: "PAUSED" }] });
      if (call.path === "/sb/v4/ads/list") return reply({ ads: [{ adId: "9", adGroupId: "8", campaignId: "7", state: "PAUSED" }] });
      if (call.path === "/sb/ads/creatives/list") return reply({ creatives: [] });
      return reply(call.path === "/sb/v4/ads/video" ? { ads: { success: [{ adId: "9" }], error: [] } } : { adId: "9", creativeVersion: "version-2" });
    });
    const creative = { asins: ["B0018OFKJS"], videoAssetIds: [assetId] };
    expect(data(await confirm("create_sb_ad_video", { accountId, payload: { adGroupId: "8", name: "Video", state: "PAUSED", creative } })).applied).toBe(true);
    expect(data(await confirm("update_sb_ad_creative_video", { accountId, payload: { adId: "9", creative: { videoAssetIds: [assetId] } } })).applied).toBe(true);
    const writes = mutations(calls);
    expect(writes[0].body).toEqual({ ads: [{ adGroupId: "8", name: "Video", state: "PAUSED", creative }] });
    expect(writes[1].body).toEqual({ adId: "9", creative: { videoAssetIds: [assetId] } });
    expect(writes[1].headers.accept).toBe("application/vnd.sbAdCreativeResource.v4+json");
  });

  it("archives only the exact previewed Brands entity", async () => {
    let state = "PAUSED";
    const { calls } = mockAmazon(call => call.path.endsWith("/list") ? reply({ ads: [{ adId: "9", state }] }) : reply({ ads: { success: [{ adId: "9" }], error: [] } }));
    const args = { accountId, entityId: "9" };
    const preview = data(await toolkit()("archive_sb_ad").handler(args));
    expect(preview).toMatchObject({ applied: false, irreversible: true });
    state = "ENABLED";
    await expect(toolkit()("archive_sb_ad").handler({ ...args, confirm: true, previewToken: preview.previewToken })).rejects.toThrow("changed");
    state = "PAUSED";
    expect(data(await confirm("archive_sb_ad", args)).applied).toBe(true);
    const mutation = calls.find(c => c.path.endsWith("/delete"))!;
    expect(mutation.body).toEqual({ adIdFilter: { include: ["9"] } });
  });

  it("archives a Display entity with DELETE on its own path", async () => {
    const { calls } = mockAmazon(call => call.method === "GET" ? reply({ targetId: 5, state: "enabled" }) : reply({ targetId: 5, code: "SUCCESS" }));
    expect(data(await confirm("archive_sd_target", { accountId, entityId: "5" })).applied).toBe(true);
    expect(mutations(calls)[0]).toMatchObject({ method: "DELETE", path: "/sd/targets/5" });
  });
});

describe("renames", () => {
  it("previews with the current name, then sends the name only", async () => {
    const { calls } = mockAmazon(call => call.path.endsWith("/list") ? reply({ campaigns: [{ campaignId: "7", name: "Old", state: "ENABLED" }] }) : reply({ campaigns: { success: [{ campaignId: "7" }], error: [] } }, 207));
    const args = { accountId, adProduct: "SPONSORED_PRODUCTS", campaignId: "7", name: "New" };
    expect(data(await toolkit()("rename_campaign").handler(args))).toMatchObject({ applied: false, change: { currentName: "Old", newName: "New" } });
    expect(mutations(calls)).toHaveLength(0);
    expect(data(await toolkit()("rename_campaign").handler({ ...args, confirm: true }))).toMatchObject({ applied: true });
    expect(mutations(calls)[0].body).toEqual({ campaigns: [{ campaignId: "7", name: "New" }] });
  });
});

describe("media uploads", () => {
  const upload = "https://uploads.s3.eu-west-1.amazonaws.com/asset.png?X-Amz-Signature=test";
  it("binds S3 upload URLs to the profile, sends no credentials to S3 and rejects untrusted upload hosts", async () => {
    const { calls } = mockAmazon(call => {
      if (call.path === "/assets/upload") return reply({ url: upload });
      if (call.url === upload) return new Response(null, { status: 200 });
      return reply({ assetId, versionId: "_v1", failedSpecChecks: [] });
    });
    const get = toolkit({ allowedProfileIds: ["123", "456"] });
    const prepared = data(await confirm("prepare_asset_upload", { accountId, fileName: "test.png", contentType: "image/png" }, get));
    expect(prepared).toMatchObject({ method: "PUT", headers: { "content-type": "image/png" }, uploadUrl: upload });
    await expect(get("register_uploaded_asset").handler({ accountId: "456", uploadToken: prepared.uploadToken, name: "test" })).rejects.toThrow("another profile");
    const bytes = Buffer.from([137, 80, 78, 71, 1, 2, 3]).toString("base64");
    const preview = data(await get("upload_asset_bytes").handler({ accountId, uploadToken: prepared.uploadToken, bytesBase64: bytes }));
    expect(preview).toMatchObject({ applied: false, change: { byteLength: 7 } });
    expect(calls.some(c => c.url === upload)).toBe(false);
    expect(data(await get("upload_asset_bytes").handler({ accountId, uploadToken: prepared.uploadToken, bytesBase64: bytes, confirm: true, previewToken: preview.previewToken }))).toMatchObject({ applied: true, byteLength: 7 });
    const put = calls.find(c => c.url === upload)!;
    expect(put.method).toBe("PUT");
    expect(put.init.redirect).toBe("error");
    expect(Object.keys(put.headers).map(k => k.toLowerCase())).toEqual(["content-type"]);
    expect(data(await confirm("register_uploaded_asset", { accountId, uploadToken: prepared.uploadToken, name: "test" }, get))).toMatchObject({ applied: true, assetId });
    mockAmazon(() => reply({ url: "https://evil.example/file" }));
    await expect(confirm("prepare_asset_upload", { accountId, fileName: "test.png", contentType: "image/png" })).rejects.toThrow("upload host");
  });

  it("refuses a mismatched extension and content type before HTTP", async () => {
    const { fetcher } = mockAmazon(() => reply({}));
    await expect(toolkit()("prepare_asset_upload").handler({ accountId, fileName: "test.png", contentType: "video/mp4" })).rejects.toThrow("agree");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("previews never change the account", () => {
  const sp = (call: Call) => {
    if (call.path.startsWith("/sp/campaigns")) return reply({ campaigns: [{ campaignId: "7", name: "C", state: "PAUSED", targetingType: "MANUAL", budget: { budgetType: "DAILY", budget: 10 }, startDate: "2026-09-01" }] });
    if (call.path.startsWith("/sp/adGroups")) return reply({ adGroups: [{ adGroupId: "8", campaignId: "7", state: "PAUSED", defaultBid: 1 }] });
    if (call.path.startsWith("/sp/keywords")) return reply({ keywords: [{ keywordId: "5", state: "PAUSED", bid: 1 }] });
    if (call.path.startsWith("/sp/targets")) return reply({ targetingClauses: [{ targetId: "5", state: "PAUSED", bid: 1 }] });
    if (call.path.startsWith("/sp/productAds")) return reply({ productAds: [{ adId: "5", state: "PAUSED" }] });
    return reply({});
  };
  const cases: [string, Record<string, unknown>][] = [
    ["create_campaign", { name: "C", targetingType: "AUTO", dailyBudget: 5, startDate: "2026-09-20" }],
    ["update_campaign", { campaignId: "7", name: "D" }],
    ["update_campaign_budget", { campaignId: "7", dailyBudget: 11 }],
    ["update_campaign_status", { campaignId: "7", status: "ENABLED" }],
    ["create_ad_group", { campaignId: "7", name: "G", defaultBid: 1 }],
    ["update_ad_group", { entityId: "8", bid: 2 }],
    ["create_product_ad", { campaignId: "7", adGroupId: "8", sku: "SKU-1" }],
    ["update_product_ad", { entityId: "5", state: "ENABLED" }],
    ["create_keyword", { campaignId: "7", adGroupId: "8", keywordText: "shoe", matchType: "EXACT", bid: 1 }],
    ["update_keyword", { entityId: "5", bid: 2 }],
    ["create_target", { campaignId: "7", adGroupId: "8", asin: "B0018OFKJS", bid: 1 }],
    ["update_target", { entityId: "5", state: "PAUSED" }],
    ["create_negative_keyword", { campaignId: "7", adGroupId: "8", keywordText: "free", matchType: "NEGATIVE_EXACT" }],
    ["rename_ad_group", { adProduct: "SPONSORED_PRODUCTS", adGroupId: "8", name: "New" }],
    ["prepare_asset_upload", { fileName: "a.png", contentType: "image/png" }],
  ];
  it.each(cases)("%s previews without a mutating request", async (name, args) => {
    const { calls } = mockAmazon(sp);
    const result = data(await toolkit()(name).handler({ accountId, ...args }));
    expect(result.applied).toBe(false);
    expect(mutations(calls)).toEqual([]);
    const before = calls.length;
    await expect(toolkit()(name).handler({ accountId: "456", ...args })).rejects.toThrow("not selected");
    expect(calls).toHaveLength(before);
  });
});
