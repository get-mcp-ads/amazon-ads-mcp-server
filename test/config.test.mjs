import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { loadConfig, validateConfig } from "../src/config.ts";

const valid = { AMAZON_ADS_CLIENT_ID: "amzn1.application-oa2-client.abc", AMAZON_ADS_CLIENT_SECRET: "private-secret-value", AMAZON_ADS_REFRESH_TOKEN: "Atzr|private-refresh", AMAZON_ADS_REGION: "eu", AMAZON_ADS_PROFILE_IDS: "123, 456,123" };

test("a complete environment loads, read-only by default", () => {
  const config = loadConfig(valid);
  assert.equal(config.region, "EU");
  assert.deepEqual(config.allowedProfileIds, ["123", "456"]);
  assert.equal(config.enableWrites, false);
  assert.equal(loadConfig({ ...valid, AMAZON_ADS_ENABLE_WRITES: "true" }).enableWrites, true);
});

test("writes need the exact value true", () => {
  for (const flag of ["1", "yes", "TRUE", "on"]) assert.throws(() => loadConfig({ ...valid, AMAZON_ADS_ENABLE_WRITES: flag }), /AMAZON_ADS_ENABLE_WRITES/);
  assert.equal(loadConfig({ ...valid, AMAZON_ADS_ENABLE_WRITES: "false" }).enableWrites, false);
});

test("configuration errors name the variable and never repeat a secret", () => {
  const cases = [
    [{ ...valid, AMAZON_ADS_CLIENT_ID: "" }, /AMAZON_ADS_CLIENT_ID/],
    [{ ...valid, AMAZON_ADS_CLIENT_SECRET: "" }, /AMAZON_ADS_CLIENT_SECRET/],
    [{ ...valid, AMAZON_ADS_REFRESH_TOKEN: "Atza|private-access-token" }, /AMAZON_ADS_REFRESH_TOKEN.*Atza/],
    [{ ...valid, AMAZON_ADS_REGION: "US" }, /AMAZON_ADS_REGION/],
    [{ ...valid, AMAZON_ADS_REGION: undefined }, /AMAZON_ADS_REGION/],
    [{ ...valid, AMAZON_ADS_PROFILE_IDS: "" }, /AMAZON_ADS_PROFILE_IDS/],
    [{ ...valid, AMAZON_ADS_PROFILE_IDS: "EU:123" }, /AMAZON_ADS_PROFILE_IDS/],
    [{ ...valid, AMAZON_ADS_PROFILE_IDS: "../123" }, /AMAZON_ADS_PROFILE_IDS/],
  ];
  for (const [env, pattern] of cases) {
    assert.throws(() => loadConfig(env), error => pattern.test(error.message) && !error.message.includes("private-secret-value") && !error.message.includes("private-refresh") && !error.message.includes("private-access-token"));
  }
  assert.throws(() => validateConfig({}), /AMAZON_ADS_CLIENT_ID/);
  assert.throws(() => validateConfig({ ...loadConfig(valid), extra: true }), /unsupported/);
});

test("the CLI reports configuration errors on stderr only and exits non-zero", () => {
  const env = { PATH: process.env.PATH, AMAZON_ADS_CLIENT_SECRET: "private-secret-value", AMAZON_ADS_REFRESH_TOKEN: "Atzr|private-refresh" };
  const run = spawnSync(process.execPath, ["dist/cli.js"], { env, input: "", encoding: "utf8", timeout: 15000 });
  assert.equal(run.status, 1);
  assert.equal(run.stdout, "", "stdout is the MCP channel");
  assert.match(run.stderr, /AMAZON_ADS_CLIENT_ID/);
  assert.doesNotMatch(run.stderr, /private-secret-value|private-refresh/);
});
