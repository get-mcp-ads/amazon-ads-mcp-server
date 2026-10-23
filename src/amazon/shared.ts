/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
import { z } from "zod";
import type { AmazonRegion } from "../core/hosts.js";
import type { Sealer } from "../core/sealed.js";
import type { AmazonAdsClient, AmazonProfile } from "./client.js";

export type ToolShape = Record<string, z.ZodTypeAny>;
export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
export type Collector = {
  tool(name: string, description: string, shape: ToolShape, handler: (args: Record<string, unknown>) => Promise<unknown>): void;
};

/** Everything a tool needs at run time. Built once from the validated configuration. */
export type AmazonRuntime = {
  region: AmazonRegion;
  allowedProfileIds: readonly string[];
  api: AmazonAdsClient;
  sealer: Sealer;
  profile(profileId: string): Promise<AmazonProfile>;
};

export const account = {
  accountId: z.string().regex(/^(?:(NA|EU|FE):)?[1-9]\d{0,19}$/).describe("Advertising profile ID listed in AMAZON_ADS_PROFILE_IDS, such as 1234567890. The region-qualified form used by hosted getmcpads, such as EU:1234567890, is accepted when its region matches AMAZON_ADS_REGION."),
};
export const id = z.string().regex(/^[1-9]\d{0,19}$/);
export const states = z.enum(["ENABLED", "PAUSED", "ARCHIVED"]);
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s, "Use a real calendar date.");

export const pageSize = z.number().int().min(1).max(100).default(100).describe("Maximum entities in this page, up to 100. Follow the returned continuation value for the rest.");
export const nextToken = z.string().min(1).max(8192).optional().describe("Opaque continuation token from the previous page for this same profile and filters. Omit on the first request.");
export const stateFilter = z.array(states).min(1).max(3).default(["ENABLED", "PAUSED", "ARCHIVED"]).describe("Delivery states to include. Defaults to every state, archived included.");
export const campaignIds = z.array(id).min(1).max(100).optional().describe("Restrict results to these campaign IDs, as decimal strings.");
export const adGroupIds = z.array(id).min(1).max(100).optional().describe("Restrict results to these ad group IDs, as decimal strings.");
export const startIndex = z.number().int().min(0).max(100000).default(0).describe("Zero-based offset of the first entity. Use nextStartIndex from the previous page.");

export const ok = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
export const failed = (value: unknown): ToolResult => ({ ...ok(value), isError: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Args = Record<string, any>;

/** Strict registration: unknown arguments are refused before any request. */
export function register(c: Collector, name: string, description: string, shape: ToolShape, handler: (args: Args) => Promise<unknown>): void {
  const schema = z.object(shape).strict();
  c.tool(name, description, shape, async args => handler(schema.parse(args)));
}

const ACCOUNT_ID = /^(?:(NA|EU|FE):)?([1-9]\d{0,19})$/;

/**
 * Resolves an accountId to an allowlisted profile in the configured region.
 * Runs before every request, so a profile outside AMAZON_ADS_PROFILE_IDS is
 * never sent to Amazon.
 */
export function scoped(rt: AmazonRuntime, accountId: string): { api: AmazonAdsClient; profileId: string; region: AmazonRegion } {
  const match = String(accountId).match(ACCOUNT_ID);
  if (!match) throw new Error("Use an advertising profile ID from AMAZON_ADS_PROFILE_IDS, such as 1234567890.");
  if (match[1] && match[1] !== rt.region) throw new Error(`This profile is qualified for region ${match[1]}, but this server is configured for ${rt.region}. Regions cannot be interchanged.`);
  if (!rt.allowedProfileIds.includes(match[2])) throw new Error("This Amazon Ads profile is not selected. Add it to AMAZON_ADS_PROFILE_IDS to use it.");
  return { api: rt.api, profileId: match[2], region: rt.region };
}
