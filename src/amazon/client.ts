/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
import { AMAZON_API_HOSTS, AMAZON_TOKEN_URLS, type AmazonRegion } from "../core/hosts.js";
import { discard, readBoundedText, redact, refuseRedirect, ResponseTooLargeError } from "../core/http.js";
import { parseAmazonJson, stringifyAmazonJson } from "../core/json.js";

const API_TIMEOUT_MS = 30_000;
const MAX_API_BYTES = 10 * 1024 * 1024;
const MAX_ERROR_BYTES = 16 * 1024;
const MAX_TOKEN_BYTES = 64 * 1024;

export type AmazonProfile = {
  profileId: number | string; countryCode?: string; currencyCode?: string; timezone?: string; dailyBudget?: number;
  accountInfo?: { id?: string; name?: string; type?: string; marketplaceStringId?: string; validPaymentMethod?: boolean };
};

export class AmazonAdsError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter: string | null = null, readonly code: string | null = null) {
    super(message);
    this.name = "AmazonAdsError";
  }
}

type Credentials = { clientId: string; clientSecret: string; refreshToken: string; region: AmazonRegion };

/**
 * Login with Amazon refresh, in memory only. The access token is renewed a
 * minute before it expires; concurrent calls share one refresh. A new refresh
 * token returned by Amazon replaces the old one in memory and is never written.
 */
export class AmazonAuth {
  private refreshToken: string;
  private current?: { value: string; expiresAt: number };
  private pending?: Promise<string>;

  constructor(private readonly credentials: Credentials) {
    this.refreshToken = credentials.refreshToken;
  }

  /** Values to remove from any text that leaves this process. */
  secrets(): string[] {
    return [this.credentials.clientSecret, this.refreshToken, this.credentials.refreshToken, this.current?.value ?? ""];
  }

  async accessToken(): Promise<string> {
    if (this.current && this.current.expiresAt - 60_000 > Date.now()) return this.current.value;
    this.pending ??= this.refresh().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  /** Forgets a token Amazon rejected, unless a newer one already replaced it. */
  invalidate(token: string): void {
    if (this.current?.value === token) this.current = undefined;
  }

  private async refresh(): Promise<string> {
    let response: Response;
    try {
      response = await fetch(AMAZON_TOKEN_URLS[this.credentials.region], {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(API_TIMEOUT_MS),
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({ grant_type: "refresh_token", client_id: this.credentials.clientId, client_secret: this.credentials.clientSecret, refresh_token: this.refreshToken }),
      });
    } catch {
      throw new AmazonAdsError("Login with Amazon did not answer the token refresh. Check the network connection and try again.", 0);
    }
    refuseRedirect(response, "Login with Amazon");
    let text: string;
    try { text = await readBoundedText(response, MAX_TOKEN_BYTES); } catch { throw new AmazonAdsError("Login with Amazon returned an unreadable token response.", response.status); }
    let value: Record<string, unknown> = {};
    try { value = JSON.parse(text) as Record<string, unknown>; } catch { /* handled below */ }
    if (!response.ok) {
      const code = typeof value.error === "string" ? value.error.slice(0, 64) : null;
      const hint = code === "invalid_grant" ? " The refresh token was revoked, expired or issued to another client. Authorize again and update AMAZON_ADS_REFRESH_TOKEN."
        : code === "invalid_client" || code === "unauthorized_client" ? " Check AMAZON_ADS_CLIENT_ID and AMAZON_ADS_CLIENT_SECRET."
        : " Check the Login with Amazon credentials and AMAZON_ADS_REGION.";
      throw new AmazonAdsError(redact(`Login with Amazon refused the token refresh (HTTP ${response.status}${code ? `, ${code}` : ""}).${hint}`, this.secrets()), response.status, null, code);
    }
    const expiresIn = value.expires_in;
    if (typeof value.access_token !== "string" || !value.access_token || typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new AmazonAdsError("Login with Amazon returned an invalid token response.", response.status);
    }
    if (typeof value.refresh_token === "string" && value.refresh_token.startsWith("Atzr|")) this.refreshToken = value.refresh_token;
    this.current = { value: value.access_token, expiresAt: Date.now() + expiresIn * 1000 };
    return value.access_token;
  }
}

// Endpoint allowlist from the hosted gateway: only the native paths that tools use.
const ALLOWED_PATH = /^\/(v2\/profiles(?:\/[1-9]\d*)?|sp\/(campaigns|adGroups|productAds|keywords|targets|negativeKeywords|negativeTargets|campaignNegativeKeywords|campaignNegativeTargets)(\/list)?|sb\/v4\/(campaigns|adGroups|ads)(\/(list|delete|productCollection|productCollectionExtended|video|brandVideo|storeSpotlight|autoCollection|manualCollection))?|sb\/ads\/creatives\/(list|productCollection|productCollectionExtended|video|brandVideo|storeSpotlight|autoCollection|manualCollection)|sb\/(keywords|negativeKeywords|targets|negativeTargets)(\/(list|[1-9]\d*))?|brands|sd\/(campaigns|adGroups|productAds|targets|negativeTargets|creatives)(\/[1-9]\d*)?|assets(?:\/(search|upload|register))?|product\/metadata|reporting\/reports(?:\/[a-zA-Z0-9-]+)?)$/;
const QUERY_PATH = /^\/(assets|brands|sd\/(campaigns|adGroups|productAds|targets|negativeTargets|creatives)|sb\/(keywords|negativeKeywords))$/;
// POST endpoints that read or prepare data without changing advertising.
const READ_POST = /(\/list|^\/assets\/search|^\/product\/metadata|^\/reporting\/reports)$/;

function providerDetail(text: string): { code: string | null; detail: string } {
  try {
    const body = parseAmazonJson(text) as Record<string, unknown>;
    const code = [body.code, body.errorCode, body.error].find(v => typeof v === "string") as string | undefined;
    const detail = [body.details, body.message, body.description, body.error_description].find(v => typeof v === "string") as string | undefined;
    return { code: code?.slice(0, 80) ?? null, detail: (detail ?? "").replace(/\s+/g, " ").slice(0, 300) };
  } catch {
    return { code: null, detail: "" };
  }
}

function statusMessage(status: number, mutation: boolean, retryAfter: string | null): string {
  if (status === 400 || status === 422) return `Amazon Ads rejected the request (HTTP ${status}).${mutation ? " Nothing was applied." : ""}`;
  if (status === 401) return `Amazon Ads rejected the authorization (HTTP 401). Check that AMAZON_ADS_REFRESH_TOKEN was granted to AMAZON_ADS_CLIENT_ID.${mutation ? " Nothing was applied; the confirmed call can be repeated." : ""}`;
  if (status === 403) return "Amazon Ads denied access (HTTP 403). Check that this profile granted the application access and that the ad product is available for it.";
  if (status === 404) return "Amazon Ads did not find this resource in the selected profile (HTTP 404).";
  if (status === 429) return `Amazon Ads rate limit reached (HTTP 429).${retryAfter ? ` Retry after ${retryAfter.slice(0, 20)} seconds.` : " Wait before retrying."} This server does not retry automatically.`;
  if (status >= 500) return `Amazon Ads returned HTTP ${status}.${mutation ? " The outcome of this change is unknown. Read the entity before any retry." : " Try again later."}`;
  return `Amazon Ads request failed (HTTP ${status}).${mutation ? " Read the entity before any retry." : ""}`;
}

/**
 * Calls the Amazon Ads API for one region fixed at startup. The profile scope
 * is always explicit, paths are allowlisted, redirects are refused, responses
 * are bounded and large integer IDs survive parsing.
 */
export class AmazonAdsClient {
  constructor(private readonly auth: AmazonAuth, private readonly clientId: string, readonly region: AmazonRegion) {}

  secrets(): string[] { return this.auth.secrets(); }

  async request<T>(path: string, profileId?: string, method = "GET", body?: unknown, mediaType = "application/json", acceptType = mediaType): Promise<T> {
    const pathname = path.split("?")[0];
    if (path.includes("#") || !ALLOWED_PATH.test(pathname)) throw new Error("Unsupported Amazon Ads endpoint.");
    if (path.includes("?") && !QUERY_PATH.test(pathname)) throw new Error("Unsupported Amazon Ads query.");
    if (profileId !== undefined && !/^[1-9]\d{0,19}$/.test(profileId)) throw new Error("Invalid Amazon profile ID.");
    const mutation = method !== "GET" && !READ_POST.test(pathname);
    const payload = body !== undefined ? stringifyAmazonJson(body) : undefined;

    for (let attempt = 0; ; attempt++) {
      const token = await this.auth.accessToken();
      let response: Response;
      try {
        response = await fetch(`${AMAZON_API_HOSTS[this.region]}${path}`, {
          method, redirect: "error", signal: AbortSignal.timeout(API_TIMEOUT_MS),
          headers: {
            authorization: `Bearer ${token}`, "Amazon-Advertising-API-ClientId": this.clientId,
            ...(profileId ? { "Amazon-Advertising-API-Scope": profileId } : {}), accept: acceptType,
            ...(payload !== undefined ? { "content-type": mediaType } : {}),
          },
          ...(payload !== undefined ? { body: payload } : {}),
        });
      } catch {
        throw new AmazonAdsError(mutation
          ? "Amazon Ads request did not complete. The outcome of this change is unknown; read the entity before retrying."
          : "Amazon Ads request did not complete. Check the network connection and try again.", 0);
      }
      refuseRedirect(response, "Amazon Ads");
      if (response.status === 401 && !mutation && attempt === 0) {
        // A rejected token on a read: renew once and repeat. Changes are never repeated.
        await discard(response);
        this.auth.invalidate(token);
        continue;
      }
      if (!response.ok) {
        const retryAfter = response.headers.get("retry-after");
        let text = "";
        try { text = await readBoundedText(response, MAX_ERROR_BYTES); } catch { /* body is optional */ }
        const { code, detail } = providerDetail(text);
        const message = `${statusMessage(response.status, mutation, retryAfter)}${code ? ` Code: ${code}.` : ""}${detail ? ` Detail: ${detail}` : ""}`;
        throw new AmazonAdsError(redact(message, this.secrets()), response.status, retryAfter, code);
      }
      if (response.status === 204) { await discard(response); return {} as T; }
      let text: string;
      try { text = await readBoundedText(response, MAX_API_BYTES); }
      catch (error) {
        throw new AmazonAdsError(error instanceof ResponseTooLargeError
          ? "Amazon Ads response exceeds 10 MB. Request a smaller page or a narrower filter."
          : `Amazon Ads response was interrupted.${mutation ? " The outcome of this change is unknown; read the entity before retrying." : ""}`, response.status);
      }
      try { return parseAmazonJson(redact(text, this.secrets())) as T; }
      catch { throw new AmazonAdsError(`Amazon Ads returned an invalid JSON response.${mutation ? " Read the entity before retrying." : ""}`, response.status); }
    }
  }

  /** Profiles visible to these credentials in the configured region. */
  async profiles(): Promise<AmazonProfile[]> {
    const profiles = await this.request<AmazonProfile[]>("/v2/profiles");
    if (!Array.isArray(profiles)) throw new Error("Invalid Amazon profile response.");
    for (const profile of profiles) {
      if (typeof profile.profileId === "number" && !Number.isSafeInteger(profile.profileId)) throw new Error("Amazon returned an unsafe numeric profile ID.");
    }
    return profiles;
  }
}
