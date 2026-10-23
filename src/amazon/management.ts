/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
import { z } from "zod";
import spExpression from "./contracts/sp-expression.json";
import { nativeSchema } from "./native-schema.js";
import { approve, confirmation, startsDelivery } from "./approval.js";
import { account, date, failed, id, ok, register, scoped, states, type Args, type AmazonRuntime, type Collector } from "./shared.js";

const money = z.number().finite().positive().max(1_000_000).describe("Positive amount in the selected profile currency, not micros. Amazon enforces marketplace-specific limits.");
const name = z.string().trim().min(1).max(128);
const confirm = {
  confirm: confirmation.confirm,
  previewToken: z.string().max(16000).optional().describe("Token from this exact preview. Confirm only the change approved by the user; expires in ten minutes."),
};
const specs = {
  campaign: { path: "campaigns", key: "campaigns", id: "campaignId", media: "spCampaign" },
  ad_group: { path: "adGroups", key: "adGroups", id: "adGroupId", media: "spAdGroup" },
  product_ad: { path: "productAds", key: "productAds", id: "adId", media: "spProductAd" },
  keyword: { path: "keywords", key: "keywords", id: "keywordId", media: "spKeyword" },
  target: { path: "targets", key: "targetingClauses", id: "targetId", media: "spTargetingClause" },
  negative_target: { path: "negativeTargets", key: "negativeTargetingClauses", id: "targetId", media: "spNegativeTargetingClause" },
  campaign_negative_keyword: { path: "campaignNegativeKeywords", key: "campaignNegativeKeywords", id: "keywordId", media: "spCampaignNegativeKeyword" },
  campaign_negative_target: { path: "campaignNegativeTargets", key: "campaignNegativeTargetingClauses", id: "targetId", media: "spCampaignNegativeTargetingClause" },
  negative_keyword: { path: "negativeKeywords", key: "negativeKeywords", id: "keywordId", media: "spNegativeKeyword" },
} as const;
type Kind = keyof typeof specs;

/** Reads one Sponsored Products entity in the selected profile and refuses archived ones. */
export async function read(rt: AmazonRuntime, accountId: string, kind: Kind, entityId: string): Promise<Args> {
  const spec = specs[kind], { api, profileId } = scoped(rt, accountId);
  const filter = kind === "negative_keyword" ? "negativeKeywordId" : kind === "negative_target" ? "negativeTargetId" : kind === "campaign_negative_keyword" ? "campaignNegativeKeywordId" : kind === "campaign_negative_target" ? "campaignNegativeTargetId" : spec.id;
  const response = await api.request<Args>(`/sp/${spec.path}/list`, profileId, "POST", {
    [`${filter}Filter`]: { include: [entityId] }, maxResults: 1,
    stateFilter: { include: ["ENABLED", "PAUSED", "ARCHIVED"] },
  }, `application/vnd.${spec.media}.v3+json`);
  const row = response[spec.key]?.find((r: Args) => String(r[spec.id]) === entityId);
  if (!row) throw new Error("Entity is not accessible in the selected Amazon profile.");
  if (row.state === "ARCHIVED") throw new Error("Archived Amazon entities cannot be modified or receive children.");
  return row;
}

async function mutate(rt: AmazonRuntime, a: Args, operation: string, kind: Kind, method: "POST" | "PUT", entity: Args, before: unknown) {
  const spec = specs[kind], { api, profileId } = scoped(rt, a.accountId);
  const change = { operation, accountId: profileId, before, proposed: entity };
  const preview = approve(rt, a, change, { activationMaySpend: startsDelivery(entity) && !kind.includes("negative") },
    "Preview only. Obtain user approval of this exact change, then repeat with confirm:true and previewToken. Creation retries can create duplicates; inspect inventory after an uncertain result.");
  if (preview) return preview;
  const response = await api.request<Args>(`/sp/${spec.path}`, profileId, method, { [spec.key]: [entity] }, `application/vnd.${spec.media}.v3+json`);
  const result = response[spec.key];
  const success = result?.success;
  if (!Array.isArray(success) || success.length !== 1 || result.error?.length) return failed({ applied: false, change, result,
    message: "Amazon did not acknowledge the entire change. Inspect inventory before retrying; HTTP 207 alone is not success." });
  const createdId = success[0][spec.id] ?? success[0].negativeKeywordId ?? success[0].campaignNegativeKeywordId ?? success[0].campaignNegativeTargetingClauseId;
  return ok({ applied: true, change, result, entityId: createdId ?? entity[spec.id], verified: false,
    message: "Amazon acknowledged this change. Read the entity to verify delivery and eligibility. Never retry a creation automatically." });
}

const campaignId = id.describe("Sponsored Products campaign ID in the selected profile.");
const adGroupId = id.describe("Sponsored Products ad group ID inside campaignId.");
const entityId = id.describe("ID of the Sponsored Products entity to change, in the selected profile.");
const biddingStrategy = z.enum(["LEGACY_FOR_SALES", "AUTO_FOR_SALES", "MANUAL"]);
const keywordText = z.string().trim().min(1).max(80);

export function registerAmazonManagement(c: Collector, rt: AmazonRuntime): void {
  register(c, "amazon_ads_create_campaign", "Create one Sponsored Products campaign in PAUSED state. Preview then confirm the exact name, targeting, dates, daily budget and bidding strategy. Currency is the profile currency. Does not start spend.", {
    ...account,
    name: name.describe("Campaign name, 1 to 128 characters."),
    targetingType: z.enum(["AUTO", "MANUAL"]).describe("AUTO lets Amazon choose keywords and products; MANUAL uses the keywords and targets you add."),
    dailyBudget: money.describe("Daily budget in the profile currency, not micros."),
    startDate: date.describe("First delivery day, YYYY-MM-DD."),
    endDate: date.optional().describe("Optional last delivery day, YYYY-MM-DD, on or after startDate."),
    biddingStrategy: biddingStrategy.default("LEGACY_FOR_SALES").describe("Native dynamic bidding strategy."),
    ...confirm,
  }, async a => {
    if (a.endDate && a.endDate < a.startDate) throw new Error("End date must not precede start date.");
    return mutate(rt, a, "create_campaign", "campaign", "POST", { name: a.name, targetingType: a.targetingType, budget: { budgetType: "DAILY", budget: a.dailyBudget },
      startDate: a.startDate, ...(a.endDate ? { endDate: a.endDate } : {}), dynamicBidding: { strategy: a.biddingStrategy }, state: "PAUSED" }, null);
  });
  register(c, "amazon_ads_update_campaign_budget", "Change one Sponsored Products daily budget in profile currency. Can change spend on enabled campaigns. Preview binds the previous budget and state; confirmation refuses stale previews.", {
    ...account, campaignId, dailyBudget: money.describe("New daily budget in the profile currency, not micros."), ...confirm,
  }, async a => {
    const before = await read(rt, a.accountId, "campaign", a.campaignId);
    if (before.budget?.budgetType !== "DAILY") throw new Error("Only daily campaign budgets are supported by this tool.");
    return mutate(rt, a, "update_campaign_budget", "campaign", "PUT", { campaignId: a.campaignId, budget: { budgetType: "DAILY", budget: a.dailyBudget } }, { budget: before.budget, state: before.state });
  });
  register(c, "amazon_ads_create_ad_group", "Create a PAUSED Sponsored Products ad group with a default bid in profile currency. Checks the selected parent campaign. Preview and confirm before creating.", {
    ...account, campaignId, name: name.describe("Ad group name, 1 to 128 characters."), defaultBid: money.describe("Default bid in the profile currency, not micros."), ...confirm,
  }, async a => {
    const parent = await read(rt, a.accountId, "campaign", a.campaignId);
    return mutate(rt, a, "create_ad_group", "ad_group", "POST", { campaignId: a.campaignId, name: a.name, defaultBid: a.defaultBid, state: "PAUSED" }, { campaignId: parent.campaignId, state: parent.state });
  });
  const definitions: { kind: Kind; shape: Record<string, z.ZodTypeAny>; fields: string[] }[] = [
    { kind: "product_ad", shape: {
      asin: z.string().regex(/^[A-Z0-9]{10}$/).optional().describe("Ten-character Amazon Standard Identification Number in this marketplace, for vendors and authors. Use this or sku."),
      sku: z.string().min(1).max(200).optional().describe("Seller SKU in this advertiser profile, used instead of asin."),
    }, fields: ["asin", "sku"] },
    { kind: "keyword", shape: {
      keywordText: keywordText.describe("Keyword text to bid on."),
      matchType: z.enum(["EXACT", "PHRASE", "BROAD"]).describe("Native keyword match type."),
      bid: money.describe("Keyword bid in the profile currency, not micros."),
    }, fields: ["keywordText", "matchType", "bid"] },
    { kind: "target", shape: {
      asin: z.string().regex(/^[A-Z0-9]{10}$/).optional().describe("Exact-ASIN shortcut; use this or expression."),
      expression: z.array(nativeSchema(spExpression)).min(1).max(100).optional().describe("Native manual product, category or brand refinements. Supply this or asin, never both. Amazon validates compatible predicate combinations."),
      bid: money.describe("Target bid in the profile currency, not micros."),
    }, fields: ["bid"] },
    { kind: "negative_keyword", shape: {
      keywordText: keywordText.describe("Keyword text to exclude; matching traffic is suppressed."),
      matchType: z.enum(["NEGATIVE_EXACT", "NEGATIVE_PHRASE"]).describe("Native negative keyword match type."),
    }, fields: ["keywordText", "matchType"] },
  ];
  for (const def of definitions) register(c, `amazon_ads_create_${def.kind}`,
    `Create one Sponsored Products ${def.kind.replaceAll("_", " ")}. Validates campaign and ad group ownership. Positive ads, targets and keywords start PAUSED; a negative keyword starts ENABLED and can suppress traffic. Product ads require exactly one seller SKU or vendor or author ASIN. Product targeting accepts an exact ASIN or native manual product, category or brand expressions. Preview and confirm.`,
    { ...account, campaignId, adGroupId, ...def.shape, ...confirm }, async a => {
      if (def.kind === "target" && Boolean(a.asin) === Boolean(a.expression)) throw new Error("Provide exactly one ASIN or targeting expression.");
      if (def.kind === "product_ad" && Boolean(a.asin) === Boolean(a.sku)) throw new Error("Provide exactly one ASIN or seller SKU.");
      const [parent, group] = await Promise.all([read(rt, a.accountId, "campaign", a.campaignId), read(rt, a.accountId, "ad_group", a.adGroupId)]);
      if (String(group.campaignId) !== a.campaignId) throw new Error("Ad group does not belong to the selected campaign.");
      if (["keyword", "target"].includes(def.kind) && parent.targetingType !== "MANUAL") throw new Error("Positive keywords and manual product targets require a manual campaign.");
      const entity: Args = { campaignId: a.campaignId, adGroupId: a.adGroupId, state: def.kind === "negative_keyword" ? "ENABLED" : "PAUSED" };
      for (const field of def.fields) if (a[field] !== undefined) entity[field] = a[field];
      if (def.kind === "target") { entity.expressionType = "MANUAL"; entity.expression = a.expression ?? [{ type: "ASIN_SAME_AS", value: a.asin }]; }
      return mutate(rt, a, `create_${def.kind}`, def.kind, "POST", entity, { campaignState: parent.state, adGroupState: group.state, targetingType: parent.targetingType });
    });
  for (const kind of ["ad_group", "product_ad", "keyword", "target"] as const) {
    const spec = specs[kind];
    register(c, `amazon_ads_update_${kind}`, `Update one Sponsored Products ${kind.replaceAll("_", " ")}: state${kind === "product_ad" ? "" : " and bid"}. Enabling may spend; archiving is irreversible. Preview binds current values, and confirm refuses a stale or changed request.`, {
      ...account, entityId, state: states.describe("ENABLED can spend; PAUSED stops this entity; ARCHIVED is irreversible.").optional(),
      ...(kind !== "product_ad" ? { bid: money.optional().describe(kind === "ad_group" ? "New default bid in the profile currency, not micros." : "New bid in the profile currency, not micros.") } : {}), ...confirm,
    }, async a => {
      if (a.state === undefined && a.bid === undefined) throw new Error("Provide a state or bid change.");
      const before = await read(rt, a.accountId, kind, a.entityId);
      const bidField = kind === "ad_group" ? "defaultBid" : "bid";
      return mutate(rt, a, `update_${kind}`, kind, "PUT", { [spec.id]: a.entityId, ...(a.state ? { state: a.state } : {}), ...(a.bid !== undefined ? { [bidField]: a.bid } : {}) },
        { state: before.state, ...(kind !== "product_ad" ? { [bidField]: before[bidField] } : {}) });
    });
  }
  register(c, "amazon_ads_update_campaign", "Update Sponsored Products campaign name, state, dates or bidding strategy. ARCHIVED is irreversible. Preview binds the current campaign; changing bidding on an enabled campaign can change spend. Use amazon_ads_update_campaign_budget for the daily budget.", {
    ...account, campaignId,
    name: name.optional().describe("New campaign name, 1 to 128 characters."),
    state: states.optional().describe("ENABLED can spend; PAUSED stops delivery; ARCHIVED permanently archives the campaign."),
    startDate: date.optional().describe("New first delivery day, YYYY-MM-DD."),
    endDate: date.optional().describe("New last delivery day, YYYY-MM-DD, on or after the start date."),
    biddingStrategy: biddingStrategy.optional().describe("Native dynamic bidding strategy."), ...confirm,
  }, async a => {
    const before = await read(rt, a.accountId, "campaign", a.campaignId);
    if (!a.name && !a.state && !a.startDate && !a.endDate && !a.biddingStrategy) throw new Error("Provide a field to change.");
    if ((a.endDate ?? before.endDate) && (a.endDate ?? before.endDate) < (a.startDate ?? before.startDate)) throw new Error("End date must not precede start date.");
    return mutate(rt, a, "update_campaign", "campaign", "PUT", { campaignId: a.campaignId, ...(a.state ? { state: a.state } : {}), ...(a.name ? { name: a.name } : {}), ...(a.startDate ? { startDate: a.startDate } : {}), ...(a.endDate ? { endDate: a.endDate } : {}), ...(a.biddingStrategy ? { dynamicBidding: { strategy: a.biddingStrategy } } : {}) }, before);
  });
  for (const kind of ["negative_target", "campaign_negative_keyword", "campaign_negative_target"] as const) {
    const keyword = kind.includes("keyword"), group = kind === "negative_target";
    register(c, `amazon_ads_create_${kind}`, `Create one Sponsored Products ${kind.replaceAll("_", " ")}. Negative criteria start ENABLED and suppress matching traffic in their parent scope. Preview and confirm.`, {
      ...account, campaignId, ...(group ? { adGroupId } : {}),
      ...(keyword ? {
        keywordText: keywordText.describe("Exact text to exclude."),
        matchType: z.enum(["NEGATIVE_EXACT", "NEGATIVE_PHRASE"]).describe("Native negative keyword matching."),
      } : {
        expression: z.array(z.object({
          type: z.enum(["ASIN_SAME_AS", "ASIN_BRAND_SAME_AS"]).describe("Exclude one product or one brand."),
          value: z.string().min(1).max(100).describe("ASIN or native brand ID to exclude."),
        }).strict()).min(1).max(10).describe("Native product or brand exclusions. Use exact native identifiers."),
      }), ...confirm,
    }, async a => {
      const parent = await read(rt, a.accountId, "campaign", a.campaignId);
      if (kind === "campaign_negative_target" && parent.targetingType !== "AUTO") throw new Error("Campaign-level negative targets require an AUTO Sponsored Products campaign.");
      let before: Args = { campaignId: parent.campaignId, state: parent.state };
      if (group) {
        const g = await read(rt, a.accountId, "ad_group", a.adGroupId);
        if (String(g.campaignId) !== a.campaignId) throw new Error("Ad group does not belong to the selected campaign.");
        before = { ...before, adGroupId: g.adGroupId, adGroupState: g.state };
      }
      return mutate(rt, a, `create_${kind}`, kind, "POST", { campaignId: a.campaignId, ...(group ? { adGroupId: a.adGroupId } : {}), state: "ENABLED", ...(keyword ? { keywordText: a.keywordText, matchType: a.matchType } : { expression: a.expression }) }, before);
    });
  }
  for (const kind of ["negative_keyword", "negative_target", "campaign_negative_keyword", "campaign_negative_target"] as const) {
    register(c, `amazon_ads_update_${kind}`, `Change the state of a Sponsored Products ${kind.replaceAll("_", " ")}. Enabling suppresses matching traffic; archiving is irreversible. Preview and confirm the exact entity.`, {
      ...account, entityId: id.describe("ID of the negative criterion to change, in the selected profile."),
      state: states.describe("Native state. ENABLED excludes matching traffic; ARCHIVED is irreversible. Amazon validates supported state transitions."), ...confirm,
    }, async a => {
      const before = await read(rt, a.accountId, kind, a.entityId);
      return mutate(rt, a, `update_${kind}`, kind, "PUT", { [specs[kind].id]: a.entityId, state: a.state }, before);
    });
  }
}
