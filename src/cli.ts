#!/usr/bin/env node
/**
 * amazon-ads-mcp-server: an open-source MCP server for the Amazon Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 *
 * stdout is the MCP channel. Every diagnostic goes to stderr.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { nodeRuntimeWarning } from "./runtime-check.js";
import { createServer } from "./server.js";

const warning = nodeRuntimeWarning();
if (warning) process.stderr.write(`[amazon-ads-mcp] ${warning}\n`);

try {
  await createServer(loadConfig()).connect(new StdioServerTransport());
} catch (error) {
  process.stderr.write(`[amazon-ads-mcp] ${error instanceof Error ? error.message : "The Amazon Ads MCP server failed to start."}\n`);
  process.exitCode = 1;
}
