/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
/**
 * Every host this server sends a request to, in one place. A test fails when
 * another https:// host appears anywhere in src/.
 *
 * Regional hosts come from Amazon's documentation: API prefixes in "Make your
 * first call" and token URLs in "Generate access and refresh tokens". The
 * region is fixed at startup from AMAZON_ADS_REGION and never taken from a
 * tool argument.
 */
export const AMAZON_REGIONS = ["NA", "EU", "FE"] as const;
export type AmazonRegion = (typeof AMAZON_REGIONS)[number];

export const AMAZON_API_HOSTS: Readonly<Record<AmazonRegion, string>> = Object.freeze({
  NA: "https://advertising-api.amazon.com",
  EU: "https://advertising-api-eu.amazon.com",
  FE: "https://advertising-api-fe.amazon.com",
});

export const AMAZON_TOKEN_URLS: Readonly<Record<AmazonRegion, string>> = Object.freeze({
  NA: "https://api.amazon.com/auth/o2/token",
  EU: "https://api.amazon.co.uk/auth/o2/token",
  FE: "https://api.amazon.co.jp/auth/o2/token",
});

/**
 * Report downloads and asset uploads use a signed S3 URL that Amazon returns.
 * That URL is data: it must match this pattern and pass assertSafeProviderUrl,
 * and it never receives an Amazon credential.
 */
const AMAZON_S3_HOST = /(^|\.)s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/;

function isPrivateHost(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local") ||
    host.startsWith("[") || host.includes(":") ||
    // Any dotted-decimal literal, which covers loopback, private ranges,
    // link-local and the 169.254.169.254 metadata address.
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^0x[0-9a-f]+$/i.test(host) || /^\d+$/.test(host);
}

/**
 * Validates a URL returned by Amazon before it is fetched. HTTPS only, no
 * embedded credentials or custom port, no IP literal or private name, and an
 * Amazon S3 host. The error never echoes the URL, which carries a signature.
 */
export function assertSafeProviderUrl(raw: unknown, purpose: "report download" | "asset upload"): URL {
  let url: URL;
  try { url = new URL(String(raw)); } catch { throw new Error(`Amazon returned an invalid ${purpose} URL.`); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port || isPrivateHost(host) || !AMAZON_S3_HOST.test(host)) {
    throw new Error(`Amazon returned a ${purpose} host that is not allowed. Only HTTPS Amazon S3 hosts are accepted.`);
  }
  return url;
}
