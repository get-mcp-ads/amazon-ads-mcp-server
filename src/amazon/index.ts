/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
import type { ValidAmazonConfig } from "../config.js";
import { Sealer } from "../core/sealed.js";
import { AmazonAdsClient, AmazonAuth, type AmazonProfile } from "./client.js";
import type { AmazonRuntime } from "./shared.js";

export { registerAmazonReads, registerAmazonWrites } from "./tools.js";
export { registerAmazonResources } from "./resources.js";
export type { AmazonRuntime, Collector } from "./shared.js";

/** Builds the per-process runtime. Tokens live in memory only. */
export function createRuntime(config: ValidAmazonConfig): AmazonRuntime {
  const auth = new AmazonAuth({ clientId: config.clientId, clientSecret: config.clientSecret, refreshToken: config.refreshToken, region: config.region });
  const api = new AmazonAdsClient(auth, config.clientId, config.region);
  const profiles = new Map<string, Promise<AmazonProfile>>();
  return {
    region: config.region,
    allowedProfileIds: Object.freeze([...config.allowedProfileIds]),
    api,
    sealer: new Sealer(config.clientSecret, config.clientId, config.region),
    profile(profileId: string) {
      if (!config.allowedProfileIds.includes(profileId)) return Promise.reject(new Error("This Amazon Ads profile is not selected."));
      let cached = profiles.get(profileId);
      if (!cached) {
        cached = api.request<AmazonProfile>(`/v2/profiles/${profileId}`, profileId).then(profile => {
          if (String(profile?.profileId) !== profileId) throw new Error("Amazon profile mismatch.");
          return profile;
        });
        // Only successful reads are kept, so a transient failure is retried on the next call.
        cached.catch(() => profiles.delete(profileId));
        profiles.set(profileId, cached);
      }
      return cached;
    },
  };
}
