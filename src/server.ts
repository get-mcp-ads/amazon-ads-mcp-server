/**
 * amazon-ads-mcp-server: an open-source MCP server for the Amazon Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { installToolQuality } from "./tool-quality.js";
import { validateConfig, type AmazonConfig } from "./config.js";
import { createRuntime, registerAmazonReads, registerAmazonResources, registerAmazonWrites } from "./amazon/index.js";

export const PACKAGE_VERSION = "1.0.0";

export function createServer(input: AmazonConfig): McpServer {
  const config = validateConfig(input);
  const server = new McpServer(
    { name: "amazon-ads-mcp", version: PACKAGE_VERSION, title: "Amazon Ads", websiteUrl: "https://www.getmcpads.com/tools/amazon-ads", icons: [{ src: "https://mcp.getmcpads.com/icon.svg", mimeType: "image/svg+xml" }] },
    { capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } } },
  );
  installToolQuality(server);
  const runtime = createRuntime(config);
  registerAmazonReads(server as never, runtime);
  if (config.enableWrites) registerAmazonWrites(server as never, runtime);
  registerAmazonResources(server);
  return server;
}
