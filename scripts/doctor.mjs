#!/usr/bin/env node
/**
 * Checks the local configuration without contacting Amazon and without
 * printing any value. Exit code 0 when the server can start.
 */
const required = ["AMAZON_ADS_CLIENT_ID", "AMAZON_ADS_CLIENT_SECRET", "AMAZON_ADS_REFRESH_TOKEN", "AMAZON_ADS_REGION", "AMAZON_ADS_PROFILE_IDS"];
const optional = ["AMAZON_ADS_ENABLE_WRITES"];
const present = (name) => typeof process.env[name] === "string" && process.env[name].trim().length > 0;

let configuration = { ok: false, message: "Run npm run build first, so the configuration check can load." };
let runtimeWarning = null;
try {
  const { loadConfig, nodeRuntimeWarning } = await import("../dist/index.js");
  runtimeWarning = nodeRuntimeWarning() ?? null;
  try {
    const config = loadConfig();
    configuration = { ok: true, region: config.region, profiles: config.allowedProfileIds.length, writesEnabled: config.enableWrites };
  } catch (error) {
    configuration = { ok: false, message: error instanceof Error ? error.message : "Invalid configuration." };
  }
} catch {
  // dist/ is missing; the presence report below still helps.
}

const result = {
  package: "@getmcpads/amazon-ads-mcp-server",
  node: process.versions.node,
  runtimeWarning,
  ok: configuration.ok,
  configuration,
  variables: [...required.map((name) => ({ name, required: true, present: present(name) })), ...optional.map((name) => ({ name, required: false, present: present(name) }))],
};
if (runtimeWarning) process.stderr.write(`${runtimeWarning}\n`);
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
