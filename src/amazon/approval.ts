/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
import { z } from "zod";
import { canonical } from "../core/json.js";
import { sha256Hex } from "../core/sealed.js";
import { ok, type Args, type AmazonRuntime, type ToolResult } from "./shared.js";

export const PREVIEW_TTL_MS = 10 * 60_000;

export const confirmation = {
  confirm: z.boolean().default(false).describe("False previews only. True applies the exact change shown in the preview, after the user approved it."),
  previewToken: z.string().max(16000).optional().describe("Token returned by the preview of this exact change. Required with confirm:true; expires after ten minutes."),
};

/** True when a proposed state starts delivery of something that spends. */
export function startsDelivery(proposed: unknown): boolean {
  const state = proposed && typeof proposed === "object" ? (proposed as Record<string, unknown>).state : undefined;
  return typeof state === "string" && state.toUpperCase() === "ENABLED";
}

/**
 * Preview and confirmation in one place. The preview hashes the change, which
 * includes the entity as read from Amazon, and seals that hash with a ten
 * minute expiry. Confirmation recomputes the hash from a fresh read, so a
 * stale preview, a changed request or a token from another configuration is
 * refused before anything is sent.
 */
export function approve(rt: AmazonRuntime, args: Args, change: unknown, notes: Record<string, unknown> = {}, message?: string): ToolResult | null {
  const hash = sha256Hex(canonical(change));
  if (!args.confirm) {
    return ok({ applied: false, change, ...notes, previewToken: rt.sealer.seal("preview", { hash, expires: Date.now() + PREVIEW_TTL_MS }),
      message: message ?? "Preview only. Confirm this exact change after the user approves it. Never retry a creation automatically after an uncertain response; inspect inventory first." });
  }
  const token = rt.sealer.unseal("preview", args.previewToken);
  if (!token) throw new Error("A valid Amazon preview token from this server is required. Preview first, then confirm with the returned previewToken.");
  if (token.hash !== hash || !Number.isFinite(token.expires) || Number(token.expires) < Date.now()) throw new Error("Amazon preview expired, or the profile, request or entity changed since the preview. Preview again.");
  return null;
}
