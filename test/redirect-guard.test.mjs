/**
 * Every outbound call carries a bearer token or a client secret, or goes to a
 * signed URL. Following a redirect would forward it to whatever host the
 * redirect names, so no fetch in this codebase may omit `redirect: "error"`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

function sourceFiles(dir = "src", acc = []) {
  for (const entry of readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
    if (entry.isDirectory()) sourceFiles(`${dir}/${entry.name}`, acc);
    else if (entry.name.endsWith(".ts")) acc.push(`${dir}/${entry.name}`);
  }
  return acc;
}

test("every fetch refuses to follow redirects and has a timeout", () => {
  const offenders = [];
  let count = 0;
  for (const file of sourceFiles()) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    let index = text.indexOf("fetch(");
    while (index !== -1) {
      count++;
      // The options object of a fetch call ends at the first `});` that follows.
      const tail = text.slice(index, index + 1200);
      const end = tail.indexOf("});");
      const call = end === -1 ? tail : tail.slice(0, end);
      if (!call.includes('redirect: "error"') || !call.includes("signal: AbortSignal.timeout(")) offenders.push(`${file}:${text.slice(0, index).split("\n").length}`);
      index = text.indexOf("fetch(", index + 1);
    }
  }
  assert.ok(count >= 4, "expected the API, token, report and upload fetch calls");
  assert.deepEqual(offenders, [], `These fetch calls may follow a redirect or hang without a timeout: ${offenders.join(", ")}`);
});

test("the only hosts this server can reach are Amazon's API and token hosts", () => {
  // Documentation links and the server icon are not call targets.
  const DOCUMENTATION = new Set(["advertising.amazon.com", "www.getmcpads.com", "mcp.getmcpads.com"]);
  const hosts = new Set();
  for (const file of sourceFiles()) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const match of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const host = match[1].replace(/\.$/, "").toLowerCase();
      if (DOCUMENTATION.has(host)) continue;
      hosts.add(`${file === "src/core/hosts.ts" ? "" : `${file}:`}${host}`);
    }
  }
  assert.deepEqual(
    [...hosts].sort(),
    ["advertising-api-eu.amazon.com", "advertising-api-fe.amazon.com", "advertising-api.amazon.com", "api.amazon.co.jp", "api.amazon.co.uk", "api.amazon.com"],
    "A new outbound host appeared, or a host is defined outside src/core/hosts.ts. That is a deliberate decision, not an accident.",
  );
});

test("credentials are never written to disk", () => {
  for (const file of sourceFiles()) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /from "node:fs"|from "fs"|writeFile|appendFile|createWriteStream/, `${file} must not write files`);
  }
});
