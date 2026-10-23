import { vi } from "vitest";
import { validateConfig, type AmazonConfig } from "../../src/config.js";
import { createRuntime, registerAmazonReads, registerAmazonWrites } from "../../src/amazon/index.js";

export const ACCESS = "Atza|private-access-token";
export const SECRET = "private-client-secret";
export const REFRESH = "Atzr|private-refresh-token";
export const base: AmazonConfig = { clientId: "amzn1.application-oa2-client.test", clientSecret: SECRET, refreshToken: REFRESH, region: "EU", allowedProfileIds: ["123"], enableWrites: true };

export type Tool = { name: string; description: string; shape: Record<string, any>; handler: (args: any) => Promise<any>; write: boolean };

/** Every tool, reads and writes, registered against one runtime. */
export function collect(overrides: Partial<AmazonConfig> = {}): Tool[] {
  const tools: Tool[] = [];
  const c = { tool(name: string, description: string, shape: any, handler: any) { tools.push({ name, description, shape, handler, write: Object.hasOwn(shape, "confirm") }); } };
  const runtime = createRuntime(validateConfig({ ...base, ...overrides }));
  registerAmazonReads(c, runtime);
  registerAmazonWrites(c, runtime);
  return tools;
}

/** One runtime shared by the returned accessor, so token caching behaves as in production. */
export function toolkit(overrides: Partial<AmazonConfig> = {}) {
  const tools = collect(overrides);
  return (name: string) => {
    const found = tools.find(t => t.name === `amazon_ads_${name}`);
    if (!found) throw new Error(`No tool amazon_ads_${name}`);
    return found;
  };
}

export const data = (result: any) => JSON.parse(result.content[0].text);
export const reply = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });

export type Call = { url: string; path: string; method: string; headers: Record<string, string>; body: any; init: RequestInit };

/**
 * Stubs fetch. Login with Amazon token requests are answered automatically
 * and counted apart; `api` sees every other request.
 */
export function mockAmazon(api: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [], tokenCalls: Call[] = [];
  const fetcher = vi.fn(async (input: any, init: RequestInit = {}) => {
    const url = String(input);
    const parsed = new URL(url);
    const raw = init.body;
    const call: Call = { url, path: parsed.pathname, method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, init,
      body: typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : raw };
    if (parsed.pathname === "/auth/o2/token") { tokenCalls.push(call); return reply({ access_token: ACCESS, expires_in: 3600, token_type: "bearer" }); }
    calls.push(call);
    return api(call);
  });
  vi.stubGlobal("fetch", fetcher);
  return { calls, tokenCalls, fetcher };
}

export const mutations = (calls: Call[]) => calls.filter(c => c.method !== "GET" && !/\/list$|^\/assets\/search$|^\/product\/metadata$|^\/reporting\/reports$/.test(c.path));
