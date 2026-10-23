/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
import operations from "./contracts/operations.json";
import { approve, confirmation, startsDelivery } from "./approval.js";
import { account, failed, id, ok, register, scoped, type Args, type AmazonRuntime, type Collector } from "./shared.js";
import { nativeSchema, nativeWire, type NativeSchema } from "./native-schema.js";

export type Operation = { family: string; path: string; entity: string; id: string; method: string; action: string; media: string; accept: string; wrap: string; key: string; schema: NativeSchema };
export const OPERATIONS = operations as unknown as Operation[];

const snake = (s: string) => s.replace(/[A-Z]/g, ch => `_${ch.toLowerCase()}`);
const names: Record<string, string> = { campaigns: "campaign", adGroups: "ad_group", ads: "ad", productAds: "product_ad", keywords: "keyword", negativeKeywords: "negative_keyword", targets: "target", negativeTargets: "negative_target", creatives: "creative", adCreatives: "ad_creative" };
const legacyMedia: Record<string, string> = { keywords: "sbkeyword", negativeKeywords: "sbnegativekeyword", targets: "sbtarget", negativeTargets: "sbnegativetarget" };
const entityIds: Record<string, string> = { campaigns: "campaignId", adGroups: "adGroupId", ads: "adId", productAds: "adId", keywords: "keywordId", negativeKeywords: "keywordId", targets: "targetId", negativeTargets: "targetId", creatives: "creativeId" };
const media: Record<string, string> = { campaigns: "sbcampaignresource", adGroups: "sbadgroupresource", ads: "sbadresource" };

/** Tool name of a pinned contract operation, as in the hosted gateway. */
function suffixOf(op: Operation): string {
  return op.entity === "ads" && op.action === "create" || op.entity === "adCreatives" ? `_${snake(op.path.split("/").pop()!)}` : "";
}
export function operationToolName(op: Operation): string {
  return `amazon_ads_${op.entity === "adCreatives" ? "update" : op.action}_${op.family}_${names[op.entity]}${suffixOf(op)}`;
}

/** Reads one Sponsored Brands or Display entity and refuses archived ones. */
export async function readNative(rt: AmazonRuntime, accountId: string, family: string, entity: string, entityId: string, adGroupId?: string): Promise<Args> {
  const { api, profileId } = scoped(rt, accountId);
  const key = entityIds[entity];
  let row: Args | undefined;
  if (family === "sb" && media[entity]) {
    const r = await api.request<Args>(`/sb/v4/${entity}/list`, profileId, "POST", { [`${key}Filter`]: { include: [entityId] }, maxResults: 1, stateFilter: { include: ["ENABLED", "PAUSED", "ARCHIVED"] } }, "application/json", `application/vnd.${media[entity]}.v4+json`);
    row = r[entity]?.find((x: Args) => String(x[key]) === entityId);
  } else if (entity === "creatives") {
    if (!adGroupId) throw new Error("adGroupId is required to verify the Display creative's ownership.");
    const r = await api.request<Args[]>(`/sd/creatives?${new URLSearchParams({ adGroupIdFilter: adGroupId })}`, profileId);
    row = Array.isArray(r) ? r.find(x => String(x.creativeId) === entityId && String(x.adGroupId) === adGroupId) : undefined;
  } else {
    row = await api.request<Args>(`/${family}/${entity}/${entityId}`, profileId, "GET", undefined, "application/json", family === "sb" ? `application/vnd.${legacyMedia[entity]}.v3+json` : "application/json");
  }
  if (!row || String(row[key] ?? row.negativeTargetId) !== entityId) throw new Error("Entity is not accessible in the selected Amazon profile.");
  if (String(row.state).toUpperCase() === "ARCHIVED") throw new Error("Archived Amazon entities cannot be modified or receive children.");
  return row;
}

/** Adds the runtime rules to a pinned contract: parent IDs, single entity, paused creation. */
function contract(op: Operation): NativeSchema {
  const s = structuredClone(op.schema), required = new Set(s.required ?? []);
  if (op.action === "update" || op.entity === "adCreatives") required.add(op.id);
  if (op.action === "create" && op.entity !== "adCreatives") {
    if (op.entity === "campaigns") ["name", "budget", "budgetType", "state", ...(op.family === "sd" ? ["tactic"] : [])].forEach(k => required.add(k));
    if (op.path.startsWith("/sb/") && !op.path.includes("/v4/")) {
      ["campaignId", "adGroupId", ...(op.entity.toLowerCase().includes("keyword") ? ["keywordText", "matchType"] : ["expressions"])].forEach(k => required.add(k));
    }
  }
  if (op.action === "create" && s.properties?.state) required.add("state");
  s.required = [...required];
  if (op.action === "create" && s.properties?.state) s.properties.state = { ...s.properties.state, enum: [op.family === "sb" && op.path.includes("/v4/") ? "PAUSED" : "paused"] };
  return s;
}

async function context(rt: AmazonRuntime, a: Args, op: Operation, p: Args) {
  scoped(rt, a.accountId);
  const before: Args = {};
  let current: Args | undefined;
  if (op.action === "update" || op.entity === "adCreatives") {
    current = await readNative(rt, a.accountId, op.family, op.entity === "adCreatives" ? "ads" : op.entity, p[op.id], a.adGroupId);
    before.entity = current;
    if (op.entity === "adCreatives") {
      const { api, profileId } = scoped(rt, a.accountId);
      before.creatives = await api.request("/sb/ads/creatives/list", profileId, "POST", { adId: p.adId }, "application/json", "application/vnd.sbAdCreativeResource.v4+json");
    }
    for (const k of ["campaignId", "adGroupId"]) if (k !== op.id && p[k] && current[k] && String(p[k]) !== String(current[k])) throw new Error("An existing entity cannot be moved to a different campaign or ad group.");
  }
  const groupId = p.adGroupId ?? current?.adGroupId ?? a.adGroupId;
  let campaignId = p.campaignId ?? current?.campaignId;
  if (groupId && op.entity !== "adGroups") {
    const group = await readNative(rt, a.accountId, op.family, "adGroups", String(groupId));
    if (campaignId && String(group.campaignId) !== String(campaignId)) throw new Error("Ad group does not belong to the selected campaign.");
    campaignId = group.campaignId;
    before.adGroup = { adGroupId: group.adGroupId, campaignId: group.campaignId, state: group.state };
  }
  if (campaignId && op.entity !== "campaigns") {
    const parent = await readNative(rt, a.accountId, op.family, "campaigns", String(campaignId));
    before.campaign = { campaignId: parent.campaignId, state: parent.state };
  }
  if (op.action === "create" && op.entity !== "campaigns" && op.entity !== "adCreatives" && !groupId && !campaignId) throw new Error("A parent campaign or ad group is required.");
  if (op.action === "create" && !op.schema.properties?.state && op.entity !== "adCreatives" &&
    ![before.adGroup?.state, before.campaign?.state].some(s => String(s).toUpperCase() === "PAUSED")) throw new Error("This endpoint cannot create a paused entity. Pause its parent before creation.");
  return before;
}

/** One acknowledged entity, or null. A 207 with any item error is not success. */
export function acknowledged(result: unknown, key: string, idKey: string): string | null {
  const container = result as Args | null | undefined;
  const body = container?.[key] ?? container;
  if (Array.isArray(body)) return body.length === 1 && ["SUCCESS", "200", "201", "202"].includes(String(body[0]?.code).toUpperCase()) && body[0][idKey] !== undefined ? String(body[0][idKey]) : null;
  if (Array.isArray(body?.success)) return body.success.length === 1 && !body.error?.length && !body.errors?.length && body.success[0][idKey] !== undefined ? String(body.success[0][idKey]) : null;
  return null;
}

export function registerAmazonNativeManagement(c: Collector, rt: AmazonRuntime): void {
  for (const op of OPERATIONS) {
    const schema = contract(op), creative = op.entity === "adCreatives";
    const name = operationToolName(op), suffix = suffixOf(op);
    const format = suffix.slice(1).replaceAll("_", " ");
    const subject = creative ? `Replace the creative of one Sponsored Brands ${format} ad`
      : op.entity === "ads" && op.action === "create" ? `Create one Sponsored Brands ${format} ad`
      : `${op.action === "create" ? "Create" : "Update"} one Sponsored ${op.family === "sb" ? "Brands" : "Display"} ${names[op.entity].replaceAll("_", " ")}`;
    register(c, name, `${subject}. Validated against the pinned Amazon contract, single entity. Creates with a state field require PAUSED; state-less creates require a paused parent. Native brand and product eligibility and moderation apply. Preview binds current entity and parent state; confirmation can change spend. Amounts are in profile currency. No automatic retries.`, {
      ...account,
      payload: nativeSchema(schema).describe("Native fields for one entity, without Amazon's bulk wrapper. Integer identifiers must be decimal strings. Only documented fields are accepted."),
      ...(op.entity === "creatives" && op.action === "update" ? { adGroupId: id.describe("Sponsored Display ad group that owns the creative. Used to verify ownership before the update.") } : {}),
      ...confirmation,
    }, async a => {
      const p = a.payload;
      if (op.action === "update" && Object.keys(p).every(k => [op.id, "campaignId", "adGroupId"].includes(k))) throw new Error("Provide at least one field to change.");
      if (op.entity === "productAds" && op.action === "create" && [p.asin, p.sku, p.landingPageURL].filter(Boolean).length !== 1) throw new Error("Provide exactly one ASIN, SKU or off-Amazon landingPageURL.");
      const before = await context(rt, a, op, p);
      const { api, profileId } = scoped(rt, a.accountId);
      const change = { operation: name, accountId: profileId, before, proposed: p };
      const preview = approve(rt, a, change, { activationMaySpend: startsDelivery(p) && !op.entity.startsWith("negative") });
      if (preview) return preview;
      const wire = nativeWire(p, schema), body = op.wrap === "array" ? [wire] : op.wrap === "key" ? { [op.key]: [wire] } : wire;
      const result = await api.request<Args>(op.path, profileId, op.method, body, op.media, op.accept);
      const entityId = creative && op.wrap === "single" && String(result.adId) === String(p.adId) && result.creativeVersion ? String(result.adId) : acknowledged(result, op.key, op.id);
      const value = { applied: Boolean(entityId), entityId, change, result, verified: false,
        message: entityId ? "Amazon acknowledged the change. Read it back to verify state and creative moderation." : "Amazon did not acknowledge the complete change. Inspect inventory before any retry; a 207 response alone is not success." };
      return entityId ? ok(value) : failed(value);
    });
  }
  for (const family of ["sb", "sd"]) for (const entity of (family === "sb" ? ["campaigns", "adGroups", "ads", "keywords", "negativeKeywords", "targets", "negativeTargets"] : ["campaigns", "adGroups", "productAds", "targets", "negativeTargets"])) {
    const key = entityIds[entity];
    register(c, `amazon_ads_archive_${family}_${names[entity]}`, `Permanently archive one Sponsored ${family === "sb" ? "Brands" : "Display"} ${names[entity].replaceAll("_", " ")}. Irreversible. Preview and explicit confirmation of this exact entity are required.`, {
      ...account, entityId: id.describe(`ID of the Sponsored ${family === "sb" ? "Brands" : "Display"} ${names[entity].replaceAll("_", " ")} to archive, in the selected profile.`), ...confirmation,
    }, async a => {
      const before = await readNative(rt, a.accountId, family, entity, a.entityId);
      const { api, profileId } = scoped(rt, a.accountId);
      const change = { operation: `archive_${family}_${entity}`, accountId: profileId, before, proposed: { [key]: a.entityId, state: "ARCHIVED" } };
      const preview = approve(rt, a, change, { irreversible: true });
      if (preview) return preview;
      const v4 = family === "sb" && Boolean(media[entity]);
      const result = await api.request<Args>(v4 ? `/sb/v4/${entity}/delete` : `/${family}/${entity}/${a.entityId}`, profileId, v4 ? "POST" : "DELETE", v4 ? { [`${key}Filter`]: { include: [a.entityId] } } : undefined,
        v4 ? `application/vnd.${media[entity]}.v4+json` : "application/json",
        v4 ? `application/vnd.${media[entity]}.v4+json` : family === "sb" ? `application/vnd.${entity === "negativeKeywords" ? "sbkeywordresponse" : entity === "negativeTargets" ? "sbnegativetarget" : legacyMedia[entity] + "response"}.v3+json` : "application/json");
      const applied = v4 ? acknowledged(result, entity, key) === a.entityId : String(result[key] ?? result.negativeTargetId) === a.entityId && ["SUCCESS", "200"].includes(String(result.code).toUpperCase());
      return applied ? ok({ applied, change, result, verified: false }) : failed({ applied, change, result, verified: false, message: "Amazon did not acknowledge the archive. Read the entity before any retry." });
    });
  }
}
