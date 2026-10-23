/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

/**
 * Opaque tokens for preview approvals, report jobs and asset uploads.
 *
 * The hosted gateway encrypts these with a workspace key. Here the key is
 * derived in memory from the Login with Amazon client secret with HKDF, so a
 * report token survives a restart of the server and stays bound to the same
 * application. Nothing is written to disk. Each token names its purpose and
 * the configuration it belongs to (client ID and region), and AES-256-GCM
 * rejects any modified token.
 */
export type SealPurpose = "preview" | "report" | "upload";

export class Sealer {
  private readonly key: Buffer;
  readonly scope: string;

  constructor(clientSecret: string, clientId: string, region: string) {
    this.key = Buffer.from(hkdfSync("sha256", clientSecret, "getmcpads/amazon-ads-mcp-server", "sealed-tokens/v1", 32));
    this.scope = createHash("sha256").update(`${clientId}\n${region}`).digest("base64url").slice(0, 22);
  }

  seal(purpose: SealPurpose, payload: Record<string, unknown>): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(purpose));
    const body = Buffer.concat([cipher.update(JSON.stringify({ ...payload, scope: this.scope }), "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), body].map(part => part.toString("base64url")).join(".");
  }

  /** Returns the payload, or null when the token is malformed, tampered or not ours. */
  unseal(purpose: SealPurpose, token: unknown): Record<string, unknown> | null {
    if (typeof token !== "string" || token.length > 16_000) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    try {
      const [iv, tag, body] = parts.map(part => Buffer.from(part, "base64url"));
      if (iv.length !== 12 || tag.length !== 16) return null;
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAAD(Buffer.from(purpose));
      decipher.setAuthTag(tag);
      const value = JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8"));
      return value && typeof value === "object" && value.scope === this.scope ? value : null;
    } catch {
      return null;
    }
  }
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
