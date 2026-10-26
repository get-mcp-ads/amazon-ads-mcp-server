/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
import { z } from "zod";
import { AmazonInteger } from "../core/json.js";
import { account, failed, id, ok, register, scoped, type Args, type AmazonRuntime, type Collector } from "./shared.js";
import { acknowledged, readNative } from "./native-management.js";
import { read } from "./management.js";

type Level = "campaign" | "ad_group" | "ad";
const products = { SPONSORED_PRODUCTS: "sp", SPONSORED_BRANDS: "sb", SPONSORED_DISPLAY: "sd" } as const;
const adProduct = z.enum(Object.keys(products) as [keyof typeof products, ...(keyof typeof products)[]]).describe("Ad product of the entity. Names are per product: Sponsored Products, Brands or Display.");
const entities = { campaign: "campaigns", ad_group: "adGroups", ad: "ads" } as const;
const ids = { campaign: "campaignId", ad_group: "adGroupId", ad: "adId" } as const;
// Sponsored Brands v4 media types; Products v3 uses its own, Display plain JSON.
const sbMedia = { campaign: "sbcampaignresource", ad_group: "sbadgroupresource", ad: "sbadresource" } as const;
const spMedia = { campaign: "spCampaign", ad_group: "spAdGroup" } as const;

/** Where each level can be renamed, and why the profile cannot. Served by the amazon-ads://guide resource. */
export const RENAME_MATRIX = [
  { level: "account", native: "profile", tool: null, reason: "The profile name (accountInfo.name) is read-only; profile updates only change the daily budget.", doc: "https://advertising.amazon.com/API/docs/en-us/reference/2/profiles" },
  { level: "campaign", native: "campaign", tool: "amazon_ads_rename_campaign", params: ["accountId", "adProduct", "campaignId"], limits: "Sponsored Products, Brands or Display. Display names must be unique across SP, SB and SD." },
  { level: "ad_group", native: "ad group", tool: "amazon_ads_rename_ad_group", params: ["accountId", "adProduct", "adGroupId"] },
  { level: "ad", native: "ad", tool: "amazon_ads_rename_ad", params: ["accountId", "adId"], limits: "Sponsored Brands ads only. Sponsored Products and Sponsored Display product ads have no name." },
] as const;

function renamePreview(action: string, target: string, newName: string, details: Record<string, unknown>) {
  return { applied: false, action, change: { target, newName, ...details },
    message: "Preview only, nothing was changed. Repeat the same call with confirm: true to apply this rename to the live account." };
}

/**
 * Name-only PUTs. Amazon updates are partial: the entity's ID and its new
 * name are all that is sent, so state, bids and budgets cannot move with it.
 * Product ads (Products and Display) have no name; only Brands ads do.
 */
async function rename(rt: AmazonRuntime, a: Args, level: Level, family: "sp" | "sb" | "sd") {
  const key = ids[level], entity = entities[level], target = String(a[key]);
  const tool = `amazon_ads_rename_${level}`;
  const { api, profileId } = scoped(rt, a.accountId);
  const current = family === "sp" ? await read(rt, a.accountId, level as "campaign" | "ad_group", target) : await readNative(rt, a.accountId, family, entity, target);
  if (!a.confirm) return ok(renamePreview(tool, target, a.name, { accountId: profileId, adProduct: a.adProduct ?? "SPONSORED_BRANDS", currentName: current.name ?? null }));
  const change = family === "sd" ? { [key]: new AmazonInteger(target), name: a.name } : { [key]: target, name: a.name };
  const path = family === "sp" ? `/sp/${entity}` : family === "sb" ? `/sb/v4/${entity}` : `/sd/${entity}`;
  const mediaType = family === "sp" ? `application/vnd.${spMedia[level as "campaign" | "ad_group"]}.v3+json` : family === "sb" ? `application/vnd.${sbMedia[level]}.v4+json` : "application/json";
  const result = await api.request<Args>(path, profileId, "PUT", family === "sd" ? [change] : { [entity]: [change] }, mediaType);
  const applied = acknowledged(result, entity, key) === target;
  const value = { applied, action: tool, change: { target, from: current.name ?? null, newName: a.name }, result, verified: false,
    message: applied ? "Amazon acknowledged the rename. Read the entity to verify it." : "Amazon did not acknowledge the rename. Read the entity before retrying; HTTP 207 alone is not success." };
  return applied ? ok(value) : failed(value);
}

export function registerAmazonRenames(c: Collector, rt: AmazonRuntime): void {
  const confirm = { confirm: z.boolean().prefault(false).describe("False previews only. True applies the exact rename explicitly approved by the user.") };
  for (const level of ["campaign", "ad_group"] as const) {
    register(c, `amazon_ads_rename_${level}`, `Rename one Amazon Sponsored Products, Brands or Display ${level.replace("_", " ")}. The name is the only thing that changes. Previews by default; archived entities cannot be renamed.`, {
      ...account, adProduct, [ids[level]]: id.describe(`ID of the ${level.replace("_", " ")} to rename, in the selected profile.`),
      name: z.string().trim().min(1).max(level === "campaign" ? 128 : 255).describe(`New ${level.replace("_", " ")} name. This is the only thing the call changes.`), ...confirm,
    }, a => rename(rt, a, level, products[a.adProduct as keyof typeof products]));
  }
  register(c, "amazon_ads_rename_ad", "Rename one Amazon Sponsored Brands ad. Sponsored Products and Display product ads have no name. The name is the only thing that changes. Previews by default.", {
    ...account, adId: id.describe("ID of the Sponsored Brands ad to rename, in the selected profile."),
    name: z.string().trim().min(1).max(255).describe("New ad name. This is the only thing the call changes."), ...confirm,
  }, a => rename(rt, a, "ad", "sb"));
}
