/**
 * The README documents every tool and resource by name. A tool renamed in the
 * code and not in the README is a documentation bug, and this test fails on it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const EXPECTED = { reads: 31, writes: 77, resources: 3 };

async function introspect() {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/cli.js"],
    env: {
      ...process.env,
      AMAZON_ADS_CLIENT_ID: "amzn1.application-oa2-client.listing",
      AMAZON_ADS_CLIENT_SECRET: "listing-placeholder",
      AMAZON_ADS_REFRESH_TOKEN: "Atzr|listing-placeholder",
      AMAZON_ADS_REGION: "NA",
      AMAZON_ADS_PROFILE_IDS: "1",
      AMAZON_ADS_ENABLE_WRITES: "true",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "readme-check", version: "1" }, { capabilities: {} });
  await client.connect(transport);
  const definitions = (await client.listTools()).tools;
  const tools = definitions.map((t) => t.name);
  const resources = (await client.listResources()).resources.map((r) => r.uri);
  await client.close();
  return { tools, resources, definitions };
}

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const listing = introspect();

test("README documents every tool the server exposes, and nothing else", async () => {
  const { tools } = await listing;
  const cited = new Set([...README.matchAll(/`(amazon_ads_[a-z_]+)`/g)].map((m) => m[1]));
  const undocumented = tools.filter((t) => !cited.has(t));
  assert.deepEqual(undocumented, [], `Tools missing from README: ${undocumented.join(", ")}`);
  const invented = [...cited].filter((c) => !tools.includes(c));
  assert.deepEqual(invented, [], `README cites tools that do not exist: ${invented.join(", ")}`);
});

test("README documents every resource the server exposes, and nothing else", async () => {
  const { resources } = await listing;
  const cited = new Set([...README.matchAll(/`(amazon-ads:\/\/[a-z0-9-]+)`/g)].map((m) => m[1]));
  const undocumented = resources.filter((r) => !cited.has(r));
  assert.deepEqual(undocumented, [], `Resources missing from README: ${undocumented.join(", ")}`);
  const invented = [...cited].filter((c) => !resources.includes(c));
  assert.deepEqual(invented, [], `README cites resources that do not exist: ${invented.join(", ")}`);
});

test("README, package.json and server.json counts match reality", async () => {
  const { tools, resources, definitions } = await listing;
  const writes = definitions.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name);
  const reads = tools.filter((t) => !writes.includes(t));

  assert.equal(reads.length, EXPECTED.reads, "read tool count changed, update the README");
  assert.equal(writes.length, EXPECTED.writes, "write tool count changed, update the README");
  assert.equal(resources.length, EXPECTED.resources, "resource count changed, update the README");

  assert.match(README, new RegExp(`\\*\\*${reads.length} read tools\\*\\*`));
  assert.match(README, new RegExp(`\\*\\*${writes.length} write tools\\*\\*`));
  assert.match(README, new RegExp(`<b>${reads.length} read tools</b>`));
  assert.match(README, new RegExp(`<b>${writes.length} write tools</b>`));
  for (const file of ["package.json", "server.json"]) {
    const { description } = JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
    assert.match(description, new RegExp(`${reads.length} read tools, ${writes.length} `), file);
  }
});

test("every environment variable in the code is documented", () => {
  const source = readFileSync(new URL("../src/config.ts", import.meta.url), "utf8");
  const names = [...new Set([...source.matchAll(/AMAZON_ADS_[A-Z_]+/g)].map((m) => m[0]))];
  const server = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));
  const declared = server.packages[0].environmentVariables.map((v) => v.name);
  assert.deepEqual([...names].sort(), [...declared].sort(), "server.json must declare exactly the variables the code reads");
  for (const name of names) assert.ok(README.includes(`\`${name}\``), `README must document ${name}`);
});

test("published prose uses no em dashes", () => {
  const files = ["README.md", "SECURITY.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "CHANGELOG.md", "RELEASING.md", "SOURCE_SYNC.md", "NOTICE", ".env.example", "src/amazon/contracts/README.md"];
  const walk = (dir) => {
    for (const entry of readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}/${entry.name}`);
      else if (entry.name.endsWith(".ts")) files.push(`${dir}/${entry.name}`);
    }
  };
  walk("src");
  const offenders = [];
  for (const file of files) {
    readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split("\n").forEach((line, i) => {
      if (line.includes("—")) offenders.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], `Rewrite these sentences without an em dash: ${offenders.join(", ")}`);
});
