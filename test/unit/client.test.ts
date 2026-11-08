import { afterEach, describe, expect, it, vi } from "vitest";
import { AmazonAdsClient, AmazonAuth } from "../../src/amazon/client.js";
import { AmazonInteger, parseAmazonJson, stringifyAmazonJson } from "../../src/core/json.js";
import { ACCESS, REFRESH, SECRET, mockAmazon, reply, toolkit } from "./helpers.js";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const credentials = { clientId: "amzn1.application-oa2-client.test", clientSecret: SECRET, refreshToken: REFRESH, region: "EU" as const };
const client = () => new AmazonAdsClient(new AmazonAuth(credentials), credentials.clientId, "EU");

describe("Login with Amazon refresh", () => {
  it("uses the regional token URL, refuses redirects and shares one refresh between concurrent calls", async () => {
    const { calls, tokenCalls } = mockAmazon(() => reply([]));
    const api = client();
    await Promise.all([api.request("/v2/profiles"), api.request("/v2/profiles"), api.request("/v2/profiles")]);
    await api.request("/v2/profiles");
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0].url).toBe("https://api.amazon.co.uk/auth/o2/token");
    expect(tokenCalls[0].init.redirect).toBe("error");
    const form = new URLSearchParams(String(tokenCalls[0].body));
    expect(Object.fromEntries(form)).toEqual({ grant_type: "refresh_token", client_id: credentials.clientId, client_secret: SECRET, refresh_token: REFRESH });
    expect(calls).toHaveLength(4);
    expect(calls[0].headers).toMatchObject({ authorization: `Bearer ${ACCESS}`, "Amazon-Advertising-API-ClientId": credentials.clientId });
    expect(calls[0].init.redirect).toBe("error");
  });

  it("keeps a rotated refresh token in memory only", async () => {
    let n = 0;
    const tokenBodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (String(url).endsWith("/auth/o2/token")) { tokenBodies.push(String(init.body)); return reply({ access_token: `Atza|a${++n}`, expires_in: 1, refresh_token: "Atzr|rotated" }); }
      return reply([]);
    }));
    const api = client();
    await api.request("/v2/profiles");
    await api.request("/v2/profiles");
    expect(new URLSearchParams(tokenBodies[1]).get("refresh_token")).toBe("Atzr|rotated");
  });

  it("explains a rejected refresh token without echoing any secret", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: "invalid_grant", error_description: `bad ${REFRESH} ${SECRET}` }, 400)));
    const error = await client().request("/v2/profiles").catch(e => e as Error);
    expect(error.message).toContain("AMAZON_ADS_REFRESH_TOKEN");
    expect(error.message).not.toContain(REFRESH);
    expect(error.message).not.toContain(SECRET);
  });

  it("rejects an incomplete token response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ access_token: "", expires_in: 3600 })));
    await expect(client().request("/v2/profiles")).rejects.toThrow("invalid token response");
  });
});

describe("Amazon Ads requests", () => {
  it("renews once and repeats a read after HTTP 401", async () => {
    let first = true;
    const { calls, tokenCalls } = mockAmazon(() => { if (first) { first = false; return reply({ code: "UNAUTHORIZED" }, 401); } return reply([{ profileId: 123 }]); });
    expect(await client().request("/v2/profiles")).toEqual([{ profileId: 123 }]);
    expect(calls).toHaveLength(2);
    expect(tokenCalls).toHaveLength(2);
  });

  it("never repeats a change, even after HTTP 401", async () => {
    const { calls } = mockAmazon(() => reply({ code: "UNAUTHORIZED" }, 401));
    await expect(client().request("/sp/campaigns", "123", "PUT", { campaigns: [] })).rejects.toThrow("Nothing was applied");
    expect(calls).toHaveLength(1);
  });

  it("maps rate limits with Retry-After and does not retry", async () => {
    const { calls } = mockAmazon(() => reply({ code: "TOO_MANY_REQUESTS", details: "Slow down" }, 429, { "retry-after": "7" }));
    const error = await client().request("/sp/campaigns/list", "123", "POST", {}).catch(e => e);
    expect(error).toMatchObject({ status: 429, retryAfter: "7", code: "TOO_MANY_REQUESTS" });
    expect(error.message).toContain("Retry after 7 seconds");
    expect(calls).toHaveLength(1);
  });

  it("marks a failed or interrupted change as having an unknown outcome", async () => {
    const { calls } = mockAmazon(() => reply({}, 502));
    await expect(client().request("/sp/campaigns", "123", "POST", {})).rejects.toThrow("outcome of this change is unknown");
    expect(calls).toHaveLength(1);
    let count = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).endsWith("/auth/o2/token")) return reply({ access_token: ACCESS, expires_in: 3600 });
      count++; throw new Error(`socket closed ${ACCESS}`);
    }));
    const error = await client().request("/sp/campaigns", "123", "PUT", {}).catch(e => e as Error);
    expect(error.message).toContain("outcome of this change is unknown");
    expect(error.message).not.toContain(ACCESS);
    expect(count).toBe(1);
  });

  it("passes provider error codes and details, with tokens redacted", async () => {
    mockAmazon(() => reply({ code: "INVALID_ARGUMENT", details: `budget too low for Atza|someone-elses-token and ${ACCESS}` }, 400));
    const error = await client().request("/sp/campaigns/list", "123", "POST", {}).catch(e => e as Error);
    expect(error.message).toContain("INVALID_ARGUMENT");
    expect(error.message).toContain("budget too low");
    expect(error.message).not.toMatch(/Atza\|/);
  });

  it("refuses redirects without disclosing their target", async () => {
    mockAmazon(() => new Response(null, { status: 302, headers: { location: "https://evil.example/?token=x" } }));
    const error = await client().request("/v2/profiles").catch(e => e as Error);
    expect(error.message).toContain("302");
    expect(error.message).not.toContain("evil.example");
  });

  it("only calls allowlisted endpoints and queries", async () => {
    const { calls } = mockAmazon(() => reply([]));
    for (const path of ["/v2/profiles/../admin", "/sp/campaigns?x=1", "/v3/anything", "/sp/campaigns#x", "https://evil.example/v2/profiles"]) await expect(client().request(path)).rejects.toThrow("Unsupported");
    await expect(client().request("/sp/campaigns/list", "0123")).rejects.toThrow("profile");
    expect(calls).toHaveLength(0);
  });

  it("bounds response size", async () => {
    mockAmazon(() => new Response("[" + "1,".repeat(6 * 1024 * 1024) + "1]"));
    await expect(client().request("/v2/profiles")).rejects.toThrow("10 MB");
  });

  it("round-trips large integer IDs without changing quoted text, money or exponents", async () => {
    const parsed = parseAmazonJson('{"id":123456789012345678,"text":"id 123456789012345678 \\"quoted\\"","cost":1.23,"scientific":1e2}') as Record<string, unknown>;
    expect(parsed).toEqual({ id: "123456789012345678", text: 'id 123456789012345678 "quoted"', cost: 1.23, scientific: 100 });
    expect(stringifyAmazonJson({ id: new AmazonInteger(parsed.id as string), cost: 1.23 })).toBe('{"id":123456789012345678,"cost":1.23}');
    expect(() => stringifyAmazonJson({ id: 123456789012345678 })).toThrow("Unsafe");
    mockAmazon(() => new Response('{"creativeId":123456789012345678}'));
    expect(await client().request("/sd/creatives", "123")).toEqual({ creativeId: "123456789012345678" });
  });
});

describe("profile discovery", () => {
  it("lists only allowlisted profiles in the configured region and names the missing ones", async () => {
    const { calls } = mockAmazon(() => reply([
      { profileId: 123, countryCode: "FR", currencyCode: "EUR", timezone: "Europe/Paris", accountInfo: { name: "Allowed", type: "seller" } },
      { profileId: 999, countryCode: "DE", currencyCode: "EUR", timezone: "Europe/Berlin", accountInfo: { name: "Private other advertiser" } },
    ]));
    const result = JSON.parse((await toolkit({ allowedProfileIds: ["123", "456"] })("list_profiles").handler({})).content[0].text);
    expect(result.profiles).toEqual([expect.objectContaining({ profileId: "123", currencyCode: "EUR", accountInfo: expect.objectContaining({ name: "Allowed" }) })]);
    expect(result.missingProfileIds).toEqual(["456"]);
    expect(JSON.stringify(result)).not.toContain("Private other advertiser");
    expect(JSON.stringify(result)).not.toContain("999");
    expect(calls[0].url).toBe("https://advertising-api-eu.amazon.com/v2/profiles");
    expect(calls[0].headers).not.toHaveProperty("Amazon-Advertising-API-Scope");
  });

  it("verifies the profile it reads", async () => {
    mockAmazon(() => reply({ profileId: 999 }));
    await expect(toolkit()("get_profile").handler({ accountId: "123" })).rejects.toThrow("mismatch");
  });
});
