/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
import { z } from "zod";
import { AMAZON_REGIONS, type AmazonRegion } from "./core/hosts.js";

const printable = /^[\x21-\x7e]+$/;
const schema = z.object({
  clientId: z.string().min(1).max(256).regex(printable),
  clientSecret: z.string().min(1).max(512).regex(printable),
  refreshToken: z.string().min(6).max(4096).regex(printable).refine(v => v.startsWith("Atzr|")),
  region: z.enum(AMAZON_REGIONS),
  allowedProfileIds: z.array(z.string().regex(/^[1-9]\d{0,19}$/)).min(1).max(200),
  enableWrites: z.boolean().prefault(false),
}).strict();

export type AmazonConfig = z.input<typeof schema>;
export type ValidAmazonConfig = z.output<typeof schema> & { region: AmazonRegion };

const RULES: Record<string, string> = {
  clientId: "AMAZON_ADS_CLIENT_ID must be the client ID of your Login with Amazon security profile.",
  clientSecret: "AMAZON_ADS_CLIENT_SECRET must be the client secret of that security profile.",
  refreshToken: "AMAZON_ADS_REFRESH_TOKEN must be a Login with Amazon refresh token, which starts with Atzr|. An access token (Atza|) expires after an hour and is not accepted.",
  region: "AMAZON_ADS_REGION must be NA, EU or FE, the region of the advertising profiles you list.",
  allowedProfileIds: "AMAZON_ADS_PROFILE_IDS must list 1 to 200 advertising profile IDs, separated by commas, such as 1234567890,2345678901.",
  enableWrites: "AMAZON_ADS_ENABLE_WRITES must be true or false.",
};

/**
 * Validates a configuration. The error names the variables to fix and never
 * repeats a value, so a secret cannot end up in a log.
 */
export function validateConfig(value: unknown): ValidAmazonConfig {
  const result = schema.safeParse(value);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map(issue => String(issue.path[0] ?? "")))];
    const messages = keys.map(key => RULES[key] ?? "Remove unsupported configuration fields.");
    throw new Error(`Amazon Ads MCP server configuration is incomplete. ${messages.join(" ")}`);
  }
  return { ...result.data, allowedProfileIds: [...new Set(result.data.allowedProfileIds)] };
}

/** Reads AMAZON_ADS_* variables. There is no OAuth browser flow and nothing is persisted. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ValidAmazonConfig {
  const flag = (env.AMAZON_ADS_ENABLE_WRITES ?? "false").trim();
  if (!["true", "false", ""].includes(flag)) throw new Error(RULES.enableWrites);
  return validateConfig({
    clientId: (env.AMAZON_ADS_CLIENT_ID ?? "").trim(),
    clientSecret: (env.AMAZON_ADS_CLIENT_SECRET ?? "").trim(),
    refreshToken: (env.AMAZON_ADS_REFRESH_TOKEN ?? "").trim(),
    region: (env.AMAZON_ADS_REGION ?? "").trim().toUpperCase(),
    allowedProfileIds: (env.AMAZON_ADS_PROFILE_IDS ?? "").split(",").map(v => v.trim()).filter(Boolean),
    enableWrites: flag === "true",
  });
}
